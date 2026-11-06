// Distributed flowshop: jobs must be processed on machines in a fixed order (flow-shop),
// and each job is assigned to exactly one of multiple factories.
// Permutation variant: jobs are processed in the same order on all machines within a factory.

using System.IO.Compression;
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

static string MakeModelName(string benchmarkName, string filename)
{
    var instance = filename.Replace('/', '_').Replace('\\', '_');
    instance = Regex.Replace(instance, @"^data_", "");
    instance = Regex.Replace(instance, @"\.gz$", "");
    instance = Regex.Replace(instance, @"\.json$", "");
    instance = Regex.Replace(instance, @"\....?.?$", "");
    return $"{benchmarkName}_{instance}";
}

static Model DefineModel(string filename, bool redundantCumul, bool permutation, bool symmetryBreaking)
{
    var input = ReadFileAsNumberArray(filename);
    var model = new Model(MakeModelName("distributed-flowshop", filename));

    int idx = 0;
    int nbJobs = input[idx++];
    int nbMachines = input[idx++];
    int nbFactories = input[idx++];

    // Create interval variables for each job assigned to each factory.
    // operations[f][m][j] = operation of job j on machine m in factory f (optional)
    var operations = new List<IntervalVar>[nbFactories][];
    for (int f = 0; f < nbFactories; f++)
    {
        operations[f] = new List<IntervalVar>[nbMachines];
        for (int m = 0; m < nbMachines; m++)
            operations[f][m] = new List<IntervalVar>();
    }
    // ends[j] = end time of job j (for makespan)
    var ends = new List<IntExpr>();
    // For symmetry breaking: jobNumbers[f][j] = j if job j assigned to factory f, else 0
    var jobNumbers = new List<IntExpr>[nbFactories];
    for (int f = 0; f < nbFactories; f++)
        jobNumbers[f] = new List<IntExpr>();
    // For --redundantCumul: sumMachines[m] = cumulative pulses on machine m
    var sumMachines = new List<CumulExpr>[nbMachines];
    for (int m = 0; m < nbMachines; m++)
        sumMachines[m] = new List<CumulExpr>();

    for (int j = 0; j < nbJobs; j++)
    {
        // Read processing times for this job
        var lengths = new int[nbMachines];
        for (int m = 0; m < nbMachines; m++)
        {
            int machineIdx = input[idx++];
            if (machineIdx != m)
                throw new InvalidDataException($"Expected machine {m}, got {machineIdx}");
            lengths[m] = input[idx++];
        }

        // For --redundantCumul: main[m] = main interval for job j on machine m
        var main = new IntervalVar[nbMachines];
        var alternatives = new List<IntervalVar>[nbMachines];
        if (redundantCumul)
            for (int m = 0; m < nbMachines; m++)
            {
                main[m] = model.IntervalVar(length: lengths[m], name: $"J{j + 1}M{m + 1}");
                alternatives[m] = new List<IntervalVar>();
            }

        // Create operations for this job in each factory
        var presences = new List<BoolExpr>();
        for (int f = 0; f < nbFactories; f++)
        {
            IntervalVar? prev = null;
            IntervalVar? first = null;

            for (int m = 0; m < nbMachines; m++)
            {
                var operation = model.IntervalVar(
                    optional: true,
                    length: lengths[m],
                    name: $"J{j + 1}F{f + 1}M{m + 1}");
                if (redundantCumul)
                    alternatives[m].Add(operation);
                operations[f][m].Add(operation);

                if (prev != null)
                {
                    // Flow-shop: previous machine must finish before next starts
                    model.EndBeforeStart(prev, operation);
                    // All operations of a job in a factory share the same presence
                    model.Enforce(first!.Presence() == operation.Presence());
                }
                else
                {
                    first = operation;
                }
                prev = operation;
            }

            presences.Add(first!.Presence());
            jobNumbers[f].Add(first.Presence() * j);
            if (!redundantCumul)
                ends.Add(prev!.End());

            // Symmetry breaking: last job must be in last factory
            if (symmetryBreaking && j == nbJobs - 1 && f == nbFactories - 1)
                model.Enforce(first.Presence() == 1);
        }

        if (redundantCumul)
        {
            // Alternative: exactly one factory is chosen for each machine
            for (int m = 0; m < nbMachines; m++)
            {
                model.Alternative(main[m], alternatives[m]);
                sumMachines[m].Add(main[m].Pulse(1));
            }
            ends.Add(main[nbMachines - 1].End());
        }
        else
        {
            // Each job must be assigned to exactly one factory
            model.Enforce(model.Sum(presences) == 1);
        }
    }

    // Objective: minimize makespan
    model.Minimize(model.Max(ends));

    // No-overlap: each machine in each factory processes one job at a time
    var machines = new SequenceVar[nbFactories][];
    for (int f = 0; f < nbFactories; f++)
    {
        machines[f] = new SequenceVar[nbMachines];
        for (int m = 0; m < nbMachines; m++)
        {
            machines[f][m] = model.SequenceVar(operations[f][m]);
            model.NoOverlap(machines[f][m]);
        }
    }

    // Permutation: jobs processed in same order on all machines within a factory
    if (permutation)
    {
        for (int f = 0; f < nbFactories; f++)
        {
            // Position variable for each job (same across all machines in this factory)
            var positions = new IntVar[nbJobs];
            for (int j = 0; j < nbJobs; j++)
                positions[j] = model.IntVar(optional: true, name: $"Position_F{f + 1}_J{j + 1}");
            for (int m = 0; m < nbMachines; m++)
                for (int j = 0; j < nbJobs; j++)
                    positions[j].Identity(operations[f][m][j].Position(machines[f][m]));
        }
    }

    // Redundant cumulative: at most nbFactories jobs on each machine simultaneously
    if (redundantCumul)
    {
        for (int m = 0; m < nbMachines; m++)
            model.Enforce(model.Sum(sumMachines[m]) <= nbFactories);
    }

    // Symmetry breaking: order factories by highest job number assigned
    if (symmetryBreaking)
    {
        var maxJobInF = new IntExpr[nbFactories];
        for (int f = 0; f < nbFactories; f++)
            maxJobInF[f] = model.Max(jobNumbers[f]);
        for (int f = 1; f < nbFactories - 1; f++)
            model.Enforce(maxJobInF[f - 1] < maxJobInF[f]);
    }

    return model;
}

const string usage =
    "Usage: dotnet run --project distributed-flowshop.csproj -- [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n" +
    "Distributed flowshop options:\n" +
    "  --redundantCumul      Use alternative() with redundant cumulative\n" +
    "  --no-permutation      Disable permutation constraint\n" +
    "  --no-symmetryBreaking Disable symmetry breaking constraints";
var (parameters, restArgs) = Parameters.ParseKnownParameters(args: args, usage: usage);

bool redundantCumul = false;
bool permutation = true;
bool symmetryBreaking = true;
var inputFiles = new List<string>();
foreach (var arg in restArgs)
{
    if (arg == "--redundantCumul")
        redundantCumul = true;
    else if (arg == "--no-permutation")
        permutation = false;
    else if (arg == "--no-symmetryBreaking")
        symmetryBreaking = false;
    else
        inputFiles.Add(arg);
}

if (inputFiles.Count == 0)
{
    Console.Error.WriteLine(usage);
    Console.Error.WriteLine("Use --help for available options.");
    return 1;
}

foreach (var filename in inputFiles)
    DefineModel(filename, redundantCumul, permutation, symmetryBreaking).Solve(parameters);

return 0;
