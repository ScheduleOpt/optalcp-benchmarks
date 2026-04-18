// Flexible Job Shop Scheduling Problem with Worker Flexibility (FJSSP-W)
//
// FJSSP-W extends the classical Flexible Job Shop Scheduling Problem by adding
// worker flexibility constraints. Each job consists of a sequence of operations
// that must be executed in order. Each operation can be processed on one of
// several eligible machines, and additionally requires a worker to be present.
// The processing time depends on both the machine and worker assignment.
// The goal is to minimize the makespan (total completion time of all jobs).
//
// Constraints:
//   - Operations within a job must be executed sequentially (precedence)
//   - Each machine can process at most one operation at a time (no overlap)
//   - Each worker can work on at most one operation at a time (no overlap)
//   - Each operation must be assigned to exactly one (machine, worker) pair
//
// Reference: Hutter et al. "A Benchmarking Environment for Worker Flexibility
// in Flexible Job Shop Scheduling Problems", arXiv:2501.16159, 2025.

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
    instance = Regex.Replace(instance, @"\....?$", "");
    return $"{benchmarkName}_{instance}";
}

static Model DefineModel(string filename, bool flatAlternatives, bool redundantCumul, bool verbose)
{
    // Read the input file into a string, possibly unzip it if it ends with .gz.
    // The first line may contain 2 or 3 numbers (the optional third wrapped in
    // parentheses is the avg number of machines per operation and is ignored).
    string inputText = ReadFile(filename);
    int firstEol = inputText.IndexOf('\n');
    var firstLineStr = Regex.Replace(inputText[..firstEol], @"[()]", "").Trim();
    var firstLine = firstLineStr
        .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
        .Take(3).Select(int.Parse).ToArray();
    var input = inputText[(firstEol + 1)..].Trim()
        .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
        .Select(int.Parse).ToArray();

    var model = new Model(MakeModelName("flexible-jobshop-w", filename));
    int nbJobs = firstLine[0];
    int nbMachines = firstLine[1];
    int nbWorkers = firstLine[2];
    if (verbose)
        Console.WriteLine($"FJSSP-W with {nbMachines} machines, {nbJobs} jobs and {nbWorkers} workers.");

    // For each machine/worker, an array of operations executed on it:
    var machines = new List<IntervalVar>[nbMachines];
    for (int m = 0; m < nbMachines; m++)
        machines[m] = new List<IntervalVar>();
    var workers = new List<IntervalVar>[nbWorkers];
    for (int w = 0; w < nbWorkers; w++)
        workers[w] = new List<IntervalVar>();

    // End times of each job:
    var ends = new List<IntExpr>();

    // For --redundantCumul: cumulative pulses across all operations
    var allOperations = new List<CumulExpr>();

    int idx = 0;

    for (int i = 0; i < nbJobs; i++)
    {
        int nbOperations = input[idx++];
        IntervalVar? prev = null;
        for (int j = 0; j < nbOperations; j++)
        {
            var operation = model.IntervalVar(name: $"J{i + 1}O{j + 1}");
            if (redundantCumul)
                allOperations.Add(operation.Pulse(1));
            int nbMachineChoices = input[idx++];
            var modes = new List<IntervalVar>();
            var variantsOnWorker = new List<IntervalVar>[nbWorkers];
            for (int w = 0; w < nbWorkers; w++)
                variantsOnWorker[w] = new List<IntervalVar>();
            var variantsOnMachine = new List<IntervalVar>[nbMachines];
            for (int m = 0; m < nbMachines; m++)
                variantsOnMachine[m] = new List<IntervalVar>();

            for (int k = 0; k < nbMachineChoices; k++)
            {
                int machineId = input[idx++];
                int nbWorkerChoices = input[idx++];
                for (int wc = 0; wc < nbWorkerChoices; wc++)
                {
                    int workerId = input[idx++];
                    int duration = input[idx++];
                    var mode = model.IntervalVar(
                        length: duration,
                        optional: true,
                        name: $"J{i + 1}O{j + 1}_M{machineId}W{workerId}");
                    if (flatAlternatives)
                    {
                        // In the input file machines are counted from 1, we count from 0. Same for workers.
                        machines[machineId - 1].Add(mode);
                        workers[workerId - 1].Add(mode);
                    }
                    else
                    {
                        variantsOnMachine[machineId - 1].Add(mode);
                        variantsOnWorker[workerId - 1].Add(mode);
                    }
                    modes.Add(mode);
                }
            }

            if (flatAlternatives)
                model.Alternative(operation, modes);
            else
            {
                var operationsOnMachine = new List<IntervalVar>();
                for (int m = 0; m < nbMachines; m++)
                {
                    if (variantsOnMachine[m].Count > 0)
                    {
                        var subOperation = model.IntervalVar(
                            optional: true,
                            name: $"J{i + 1}O{j + 1}_M{m + 1}");
                        model.Alternative(subOperation, variantsOnMachine[m]);
                        operationsOnMachine.Add(subOperation);
                        machines[m].Add(subOperation);
                    }
                }
                model.Alternative(operation, operationsOnMachine);

                var operationsOnWorker = new List<IntervalVar>();
                for (int w = 0; w < nbWorkers; w++)
                {
                    if (variantsOnWorker[w].Count > 0)
                    {
                        var subOperation = model.IntervalVar(
                            optional: true,
                            name: $"J{i + 1}O{j + 1}_W{w + 1}");
                        model.Alternative(subOperation, variantsOnWorker[w]);
                        operationsOnWorker.Add(subOperation);
                        workers[w].Add(subOperation);
                    }
                }
                model.Alternative(operation, operationsOnWorker);
            }

            if (prev != null)
                prev.EndBeforeStart(operation);
            prev = operation;
        }
        ends.Add(prev!.End());
    }

    // Tasks on each machine cannot overlap:
    for (int m = 0; m < nbMachines; m++)
        model.NoOverlap(machines[m]);
    // Tasks on each worker cannot overlap:
    for (int w = 0; w < nbWorkers; w++)
        model.NoOverlap(workers[w]);

    // Redundant cumulative: at most min(nbMachines, nbWorkers) operations simultaneously
    if (redundantCumul)
        model.Enforce(model.Sum(allOperations) <= Math.Min(nbMachines, nbWorkers));

    // Minimize the makespan:
    model.Minimize(model.Max(ends));

    if (idx != input.Length)
        throw new InvalidDataException($"Unexpected data at end: {input.Length - idx} leftover");

    return model;
}

const string usage =
    "Usage: dotnet run --project flexible-jobshop-w.csproj -- [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n" +
    "FJSSP-W specific options:\n" +
    "  --flatAlternatives  Don't use hierarchical alternative constraints\n" +
    "  --redundantCumul    Add a redundant cumul constraint\n" +
    "  --verbose           Enable verbose output";
var (parameters, restArgs) = Parameters.ParseKnownParameters(args: args, usage: usage);

bool flatAlternatives = false;
bool redundantCumul = false;
bool verbose = false;
var inputFiles = new List<string>();
foreach (var arg in restArgs)
{
    if (arg == "--flatAlternatives")
        flatAlternatives = true;
    else if (arg == "--redundantCumul")
        redundantCumul = true;
    else if (arg == "--verbose")
        verbose = true;
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
    DefineModel(filename, flatAlternatives, redundantCumul, verbose).Solve(parameters);

return 0;
