// Simple heuristic solver for the jobshop scheduling problem.
//
// Generates solutions in JSON format to stdout, one solution per line.
// Format: {"makespan": N, "schedule": [{"name": string, "start": N, "end": N}, ...]}
//
// Also listens to stdin for external solutions in the same format.
// This is just a demo; the heuristic is simplistic and only uses the makespan.

using System.Globalization;
using System.IO.Compression;
using System.Text.Json;

static Data ReadData(string filename)
{
    var instance = Path.GetFileName(filename);
    if (instance.EndsWith(".txt"))
        instance = instance[..^4];

    string content;
    if (filename.EndsWith(".gz"))
    {
        using var fs = File.OpenRead(filename);
        using var gz = new GZipStream(fs, CompressionMode.Decompress);
        using var reader = new StreamReader(gz);
        content = reader.ReadToEnd();
    }
    else
    {
        content = File.ReadAllText(filename);
    }

    var lines = content.Trim().Split('\n');
    var header = lines[0].Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
    int nbJobs = int.Parse(header[0], CultureInfo.InvariantCulture);
    int nbMachines = int.Parse(header[1], CultureInfo.InvariantCulture);

    if (nbJobs <= 0 || nbMachines <= 0)
    {
        Console.Error.WriteLine($"Error in {instance} data");
        Environment.Exit(1);
    }

    var durations = new int[nbJobs][];
    var machines = new int[nbJobs][];
    var preferences = new int[nbJobs][];
    var names = new string[nbJobs][];

    for (int j = 0; j < nbJobs; j++)
    {
        var data = lines[j + 1].Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        int nbTasks = data.Length / 2;
        durations[j] = new int[nbTasks];
        machines[j] = new int[nbTasks];
        preferences[j] = new int[nbTasks];
        names[j] = new string[nbTasks];
        for (int r = 0; r < nbTasks; r++)
        {
            machines[j][r] = int.Parse(data[2 * r], CultureInfo.InvariantCulture);
            durations[j][r] = int.Parse(data[2 * r + 1], CultureInfo.InvariantCulture);
            preferences[j][r] = 0;
            names[j][r] = $"J{j + 1}O{r + 1}M{machines[j][r] + 1}";
        }
    }

    return new Data(instance, nbJobs, nbMachines, durations, machines, names, preferences);
}

static void UpdateCandidates(Machine m)
{
    foreach (var c in m.Candidates)
    {
        c.MinEnd = Math.Max(m.OccupiedUntil + c.Duration, c.MinEnd);
        c.HeuristicValue = c.MinEnd + c.Preference;
    }
    m.Candidates.Sort((a, b) => a.HeuristicValue.CompareTo(b.HeuristicValue));
}

// Heuristic search for a solution. If the solution is better than bestMakespan,
// writes it to stdout in JSON format. Returns the makespan of the produced schedule.
static int Heuristics(Data data, long bestMakespan)
{
    var machines = new Machine[data.NbMachines];
    for (int m = 0; m < data.NbMachines; m++)
        machines[m] = new Machine();

    // Initial candidates are first operations of all jobs.
    for (int j = 0; j < data.NbJobs; j++)
    {
        int duration = data.Durations[j][0];
        int preference = data.Preferences[j][0];
        int m = data.Machines[j][0];
        string name = data.Names[j][0];
        machines[m].Candidates.Add(new Candidate
        {
            HeuristicValue = duration + preference,
            MinEnd = duration,
            Duration = duration,
            Job = j,
            Operation = 0,
            Preference = preference,
            Name = name,
        });
    }
    for (int m = 0; m < data.NbMachines; m++)
        UpdateCandidates(machines[m]);

    var schedule = new List<ScheduleTask>();

    while (true)
    {
        // Find candidate with the smallest heuristic value across all machines.
        int minHeuristicValue = int.MaxValue;
        int chosenMachine = -1;
        for (int m = 0; m < data.NbMachines; m++)
        {
            if (machines[m].Candidates.Count == 0)
                continue;
            var c = machines[m].Candidates[0];
            if (c.HeuristicValue < minHeuristicValue)
            {
                minHeuristicValue = c.HeuristicValue;
                chosenMachine = m;
            }
        }

        if (chosenMachine == -1)
            break;  // No more candidates, everything is scheduled.

        // Schedule the selected candidate.
        var machine = machines[chosenMachine];
        var candidate = machine.Candidates[0];
        machine.Candidates.RemoveAt(0);
        schedule.Add(new ScheduleTask(candidate.MinEnd - candidate.Duration, candidate.MinEnd, candidate.Name));
        machine.OccupiedUntil = candidate.MinEnd;
        UpdateCandidates(machine);

        // Successor of the selected candidate becomes a candidate.
        int job = candidate.Job;
        int nextOperation = candidate.Operation + 1;
        if (nextOperation < data.Durations[job].Length)
        {
            int duration = data.Durations[job][nextOperation];
            int preference = data.Preferences[job][nextOperation];
            string name = data.Names[job][nextOperation];
            int minEnd = candidate.MinEnd + duration;
            int m = data.Machines[job][nextOperation];
            machines[m].Candidates.Add(new Candidate
            {
                HeuristicValue = minEnd + preference,
                MinEnd = minEnd,
                Duration = duration,
                Job = job,
                Operation = nextOperation,
                Preference = preference,
                Name = name,
            });
            UpdateCandidates(machines[m]);
        }
    }

    int makespan = 0;
    foreach (var t in schedule)
        makespan = Math.Max(makespan, t.End);

    if (makespan < bestMakespan)
    {
        var output = new
        {
            makespan,
            schedule = schedule.Select(t => new { name = t.Name, start = t.Start, end = t.End }).ToArray(),
        };
        // One line per solution; Console.Out is line-buffered in interactive mode
        // but fully buffered when stdout is a pipe, so flush explicitly.
        Console.Out.WriteLine(JsonSerializer.Serialize(output));
        Console.Out.Flush();
    }

    return makespan;
}

if (args.Length != 1)
{
    Console.Error.WriteLine("Usage: dotnet run --project jobshop-heuristics.csproj -- <filename>");
    return 1;
}

var jobshopData = ReadData(args[0]);

// Best makespan found so far (by this process or received from the parent solver).
// Shared with the stdin reader thread via Interlocked.
long bestMakespan = long.MaxValue;

// Atomic "min" update: install newValue only if it actually lowers the bound.
static void UpdateBest(ref long bound, long newValue)
{
    long current = Interlocked.Read(ref bound);
    while (newValue < current)
    {
        long original = Interlocked.CompareExchange(ref bound, newValue, current);
        if (original == current) break;
        current = original;
    }
}

// Background stdin reader: each line is a JSON message carrying the latest best
// makespan the parent solver has seen. Malformed lines are silently ignored.
var stdinReader = new Thread(() =>
{
    try
    {
        string? line;
        while ((line = Console.In.ReadLine()) != null)
        {
            try
            {
                using var doc = JsonDocument.Parse(line);
                if (doc.RootElement.TryGetProperty("makespan", out var ms)
                    && ms.TryGetInt64(out var incoming))
                {
                    UpdateBest(ref bestMakespan, incoming);
                }
            }
            catch (JsonException) { }
        }
    }
    catch (IOException) { }
})
{
    IsBackground = true,
};
stdinReader.Start();

// First run without randomization.
int firstMakespan = Heuristics(jobshopData, long.MaxValue);
UpdateBest(ref bestMakespan, firstMakespan);

// Compute maximum duration for randomization scaling.
int maxDuration = 0;
foreach (var job in jobshopData.Durations)
    foreach (var d in job)
        if (d > maxDuration) maxDuration = d;

var rng = new Random();

// Infinite loop — we expect to be killed by the parent process.
while (true)
{
    foreach (var jobPrefs in jobshopData.Preferences)
        for (int i = 0; i < jobPrefs.Length; i++)
            jobPrefs[i] = rng.Next(maxDuration);

    int makespan = Heuristics(jobshopData, Interlocked.Read(ref bestMakespan));
    UpdateBest(ref bestMakespan, makespan);
}

// Input jobshop data as read from a file.
internal sealed record Data(
    string Instance,
    int NbJobs,
    int NbMachines,
    int[][] Durations,
    int[][] Machines,
    string[][] Names,
    int[][] Preferences);

// A candidate task ready to be scheduled on a machine.
internal sealed class Candidate
{
    public int HeuristicValue;   // minEnd + preference — candidates picked smallest first
    public int MinEnd;           // earliest end given job predecessors + machine occupancy
    public int Duration;
    public int Job;
    public int Operation;
    public int Preference;
    public string Name = "";
}

// Machine state during heuristic search.
internal sealed class Machine
{
    public int OccupiedUntil;
    public List<Candidate> Candidates = new();
}

internal sealed record ScheduleTask(int Start, int End, string Name);
