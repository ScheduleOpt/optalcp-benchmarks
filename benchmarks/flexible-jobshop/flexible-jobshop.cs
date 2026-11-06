// Flexible Job Shop Scheduling Problem (FJSSP):
// Each job consists of a sequence of operations that must be processed in order.
// Each operation can be processed on one of several machines (flexibility).
// Objective: minimize the makespan (completion time of all jobs).

using System.Globalization;
using System.IO.Compression;
using System.Text.RegularExpressions;
using OptalCP;

static string ReadFile(string filename)
{
    if (filename.EndsWith(".gz"))
    {
        using var fs = File.OpenRead(filename);
        using var gz = new GZipStream(fs, CompressionMode.Decompress);
        using var reader = new StreamReader(gz);
        return reader.ReadToEnd();
    }
    return File.ReadAllText(filename);
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

static Model DefineModel(string filename, bool redundantCumul)
{
    // Parse input file: first line has nbJobs and nbMachines, rest is job data
    string inputText = ReadFile(filename);
    int firstEol = inputText.IndexOf('\n');
    var firstLine = inputText[..firstEol].Trim()
        .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
        .Select(s => double.Parse(s, CultureInfo.InvariantCulture)).ToArray();
    var data = inputText[(firstEol + 1)..].Trim()
        .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
        .Select(int.Parse).ToArray();

    var model = new Model(MakeModelName("flexible-jobshop", filename));
    int nbJobs = (int)firstLine[0];
    int nbMachines = (int)firstLine[1];

    // Operations assigned to each machine (for no-overlap constraints):
    var machines = new List<IntervalVar>[nbMachines];
    for (int m = 0; m < nbMachines; m++)
        machines[m] = new List<IntervalVar>();

    // End times of each job (for makespan calculation):
    var ends = new List<IntExpr>();

    // For --redundantCumul: cumulative pulses across all machines
    var allMachines = new List<CumulExpr>();

    int idx = 0;

    for (int i = 0; i < nbJobs; i++)
    {
        int nbOperations = data[idx++];
        IntervalVar? prev = null;
        for (int j = 0; j < nbOperations; j++)
        {
            // Create operation (master interval for alternative constraint):
            var operation = model.IntervalVar(name: $"J{i + 1}O{j + 1}");
            // Create one optional mode for each machine that can process this operation:
            int nbModes = data[idx++];
            var modes = new List<IntervalVar>();
            for (int k = 0; k < nbModes; k++)
            {
                int machineId = data[idx++];
                int duration = data[idx++];
                var mode = model.IntervalVar(
                    length: duration,
                    optional: true,
                    name: $"J{i + 1}O{j + 1}_M{machineId}");
                machines[machineId - 1].Add(mode); // machines are 1-indexed in input
                modes.Add(mode);
            }
            // Exactly one mode must be selected:
            model.Alternative(operation, modes);
            // Operations within a job must be sequenced:
            if (prev != null)
                prev.EndBeforeStart(operation);
            prev = operation;
            if (redundantCumul)
                allMachines.Add(operation.Pulse(1));
        }
        ends.Add(prev!.End());
    }

    // No-overlap: each machine processes one operation at a time
    for (int m = 0; m < nbMachines; m++)
        model.NoOverlap(machines[m]);

    // Redundant cumulative: at most nbMachines operations simultaneously
    if (redundantCumul)
        model.Enforce(model.Sum(allMachines) <= nbMachines);

    // Minimize makespan (completion time of all jobs):
    model.Minimize(model.Max(ends));

    // Verify all input data was consumed:
    if (idx != data.Length)
        throw new InvalidDataException($"Unexpected data at end: {data.Length - idx} leftover");

    return model;
}

const string usage =
    "Usage: dotnet run --project flexible-jobshop.csproj -- [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n" +
    "Flexible JobShop options:\n" +
    "  --redundantCumul    Add a redundant cumul constraint";
var (parameters, restArgs) = Parameters.ParseKnownParameters(args: args, usage: usage);

bool redundantCumul = false;
var inputFiles = new List<string>();
foreach (var arg in restArgs)
{
    if (arg == "--redundantCumul")
        redundantCumul = true;
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
    DefineModel(filename, redundantCumul).Solve(parameters);

return 0;
