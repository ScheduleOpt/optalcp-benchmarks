// Demo: Run OptalCP and a heuristic solver in parallel.
//
// The two processes exchange solutions asynchronously via stdin/stdout.
// OptalCP uses external solutions to prune the search space and improve them
// using Large Neighborhood Search (when searchType=LNS). See README.md.

using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;
using System.Text.RegularExpressions;
using OptalCP;

static int[] ReadFileAsNumberArray(string filename)
{
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
    return content.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).ToArray();
}

static string MakeModelName(string filename)
{
    var instance = filename.Replace('/', '_').Replace('\\', '_');
    instance = Regex.Replace(instance, @"^data_", "");
    instance = Regex.Replace(instance, @"\.gz$", "");
    instance = Regex.Replace(instance, @"\.json$", "");
    instance = Regex.Replace(instance, @"\....?$", "");
    return $"jobshop_{instance}";
}

static Model DefineModel(string filename)
{
    var input = ReadFileAsNumberArray(filename);
    var model = new Model(MakeModelName(filename));
    int idx = 0;
    int nbJobs = input[idx++];
    int nbMachines = input[idx++];

    var machines = new List<IntervalVar>[nbMachines];
    for (int j = 0; j < nbMachines; j++)
        machines[j] = new List<IntervalVar>();

    var ends = new List<IntExpr>();

    for (int i = 0; i < nbJobs; i++)
    {
        IntervalVar? prev = null;
        for (int j = 0; j < nbMachines; j++)
        {
            int machineId = input[idx++];
            int duration = input[idx++];
            var operation = model.IntervalVar(
                length: duration,
                name: $"J{i + 1}O{j + 1}M{machineId + 1}");
            machines[machineId].Add(operation);
            if (prev != null)
                prev.EndBeforeStart(operation);
            prev = operation;
        }
        ends.Add(prev!.End());
    }

    for (int j = 0; j < nbMachines; j++)
        model.NoOverlap(machines[j]);

    model.Minimize(model.Max(ends));
    return model;
}

const string usage = "Usage: dotnet run --project jobshop-hybrid.csproj -- [OPTIONS] INPUT_FILE";
var (parameters, rest) = Parameters.ParseKnownParameters(args: args, usage: usage);
if (rest.Count != 1)
{
    Console.Error.WriteLine(usage);
    return 1;
}

var filename = rest[0];

using var solver = new Solver();
var model = DefineModel(filename);

// Ctrl-C: stop the solver gracefully so we still print the summary.
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    solver.Stop("Interrupted");
};

// Fast lookup from variable name to IntervalVar — used when converting
// incoming heuristic schedules into Solution objects.
var vars = new Dictionary<string, IntervalVar>();
foreach (var v in model.GetIntervalVars())
{
    if (v.Name != null)
        vars[v.Name] = v;
}

// Launch the heuristic solver as a child subprocess.
Console.WriteLine("Starting heuristics subprocess...");
var baseDir = AppContext.BaseDirectory;
// The heuristics .dll sits next to the hybrid .dll in the hybrid project's
// output. We spawn it via `dotnet <path>` so it runs on any platform without
// an apphost.
var heuristicsDll = Path.Combine(baseDir, "jobshop-heuristics.dll");
if (!File.Exists(heuristicsDll))
{
    Console.Error.WriteLine($"Heuristics assembly not found at {heuristicsDll}. Run `dotnet build` to produce it.");
    return 1;
}
var psi = new ProcessStartInfo("dotnet", new[] { heuristicsDll, filename })
{
    RedirectStandardInput = true,
    RedirectStandardOutput = true,
    UseShellExecute = false,
};
var heuristics = Process.Start(psi);
if (heuristics == null)
{
    Console.Error.WriteLine("Failed to start the heuristics subprocess.");
    return 1;
}

// Reader task: each line on the heuristic's stdout is a JSON solution that
// we forward to the solver via SendSolution. The loop exits when the
// heuristic's stdout closes (done in the cleanup `finally` below).
var readerTask = Task.Run(async () =>
{
    try
    {
        string? line;
        while ((line = await heuristics.StandardOutput.ReadLineAsync()) != null)
        {
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;
            var solution = new Solution();
            solution.SetObjective(root.GetProperty("makespan").GetInt64());
            foreach (var t in root.GetProperty("schedule").EnumerateArray())
            {
                var name = t.GetProperty("name").GetString();
                if (name == null || !vars.TryGetValue(name, out var v))
                    throw new InvalidOperationException($"Unknown variable: {name}");
                solution.SetValue(v, t.GetProperty("start").GetInt32(), t.GetProperty("end").GetInt32());
            }
            solver.SendSolution(solution);
        }
    }
    catch (IOException) { }
});

// Forward every OptalCP solution back to the heuristic on its stdin. In the
// preview edition variable values are masked (absent), so we only ship the
// makespan, which is all the heuristic uses anyway.
solver.OnSolution = msg =>
{
    var sol = msg.Solution;
    var schedule = new List<object>();
    foreach (var v in model.GetIntervalVars())
    {
        if (sol.IsAbsent(v)) continue;
        var start = sol.GetStart(v);
        var end = sol.GetEnd(v);
        if (start == null || end == null || v.Name == null) continue;
        schedule.Add(new { name = v.Name, start = start.Value, end = end.Value });
    }
    var payload = JsonSerializer.Serialize(new { makespan = sol.GetObjective(), schedule });
    try
    {
        heuristics.StandardInput.WriteLine(payload);
        heuristics.StandardInput.Flush();
    }
    catch (IOException) { /* heuristic already exited — ignore */ }
    return Task.CompletedTask;
};

try
{
    await solver.Solve(model, parameters);
}
finally
{
    // Closing stdout first discards any partial in-flight JSON line so we
    // don't try to parse half a message after the kill.
    heuristics.StandardOutput.Close();
    try { heuristics.StandardInput.Close(); } catch (IOException) { }
    if (!heuristics.HasExited)
    {
        try { heuristics.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
    }
    heuristics.WaitForExit();
    await readerTask;
}

return 0;
