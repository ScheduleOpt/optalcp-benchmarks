// Permutation Flowshop Scheduling Problem
// =========================================
//
// The Flowshop Scheduling Problem (FSP) involves scheduling multiple jobs on
// multiple machines. Each job consists of operations that must be processed
// on machines in a fixed order (the same for all jobs). The goal is to
// minimize the makespan: the total time to complete all jobs.
//
// In "permutation flowshop" (this problem), jobs must be processed in the
// same order on all machines. This is more restrictive than "non-permutation
// flowshop" where the order of jobs can differ between machines.
//
// Model
// -----
//
// For each operation, we create an interval variable with a fixed length
// (processing time). Three types of constraints are used:
//
//   1. Precedence: Operations of the same job must be executed in order
//      (job's operation on machine 1 before machine 2, etc.).
//   2. No-overlap: Each machine can process only one operation at a time.
//   3. Same order: Jobs must be processed in the same order on all machines.
//      This is enforced using position variables and sequence variables.
//
// The objective is to minimize the maximum end time across all jobs.
//
// Data formats
// ------------
//
// This solver supports two input formats:
//
//   1. Taillard format: Numbers are arranged by machine, then by job:
//        nbJobs nbMachines
//        J1M1 J2M1 J3M1 ...  (all jobs on machine 1)
//        J1M2 J2M2 J3M2 ...  (all jobs on machine 2)
//        ...
//
//   2. OR-Library format: Each operation includes its machine ID (0-based):
//        nbJobs nbMachines
//        0 J1M1 1 J1M2 2 J1M3 ...  (job 1: machineId duration pairs)
//        0 J2M1 1 J2M2 2 J2M3 ...  (job 2: machineId duration pairs)
//        ...
//      This format is shared with JobShop (flowshop is a special case where
//      all jobs visit machines in the same order: 0, 1, 2, ...).
//
// The solver auto-detects the format by checking if the third number is 0
// (indicating OR-Library format with machine IDs).

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

static string MakeModelName(string filename)
{
    var instance = filename.Replace('/', '_').Replace('\\', '_');
    instance = Regex.Replace(instance, @"^data_", "");
    instance = Regex.Replace(instance, @"\.gz$", "");
    instance = Regex.Replace(instance, @"\.json$", "");
    instance = Regex.Replace(instance, @"\....?.?$", "");
    return $"permutation-flowshop_{instance}";
}

// Adds permutation constraints: all jobs have the same position on all machines.
static void AddPermutationConstraints(
    Model model,
    List<IntervalVar>[] machines,  // machines[machineId][jobId]
    int nbJobs,
    int nbMachines)
{
    // Position variable for each job (same across all machines):
    var positionVars = new List<IntVar>();
    for (int i = 0; i < nbJobs; i++)
        positionVars.Add(model.IntVar(name: $"position{i + 1}"));

    // Create sequence variable for each machine and enforce permutation:
    for (int j = 0; j < nbMachines; j++)
    {
        var seq = model.SequenceVar(machines[j]);
        model.NoOverlap(seq);
        for (int i = 0; i < nbJobs; i++)
            model.Enforce(positionVars[i] == machines[j][i].Position(seq));
    }
}

// Reads Taillard format (durations organized by machine).
static void ReadTaillardFormat(Model model, int[] input)
{
    int idx = 0;
    int nbJobs = input[idx++];
    int nbMachines = input[idx++];

    var machines = new List<IntervalVar>[nbMachines];
    for (int j = 0; j < nbMachines; j++)
        machines[j] = new List<IntervalVar>();
    var last = new IntervalVar?[nbJobs];  // Previous operation of each job

    for (int j = 0; j < nbMachines; j++)
    {
        for (int i = 0; i < nbJobs; i++)
        {
            int duration = input[idx++];
            var operation = model.IntervalVar(length: duration, name: $"J{i + 1}M{j + 1}");
            machines[j].Add(operation);
            // Precedence: operation must start after the previous operation of the same job:
            if (last[i] != null)
                last[i]!.EndBeforeStart(operation);
            last[i] = operation;
        }
    }

    AddPermutationConstraints(model, machines, nbJobs, nbMachines);

    // Objective: minimize the makespan (max end time over all jobs):
    var ends = last.Select(op => op!.End()).ToList();
    model.Minimize(model.Max(ends));

    if (idx != input.Length)
        throw new InvalidDataException($"Unexpected data at end: {input.Length - idx} leftover");
}

// Reads OR-Library format (with machine IDs in input).
static void ReadORLibraryFormat(Model model, int[] input)
{
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
            // Precedence: operation must start after the previous operation of the same job:
            if (prev != null)
                prev.EndBeforeStart(operation);
            prev = operation;
        }
        ends.Add(prev!.End());
    }

    AddPermutationConstraints(model, machines, nbJobs, nbMachines);

    // Objective: minimize the makespan (max end time over all jobs):
    model.Minimize(model.Max(ends));

    if (idx != input.Length)
        throw new InvalidDataException($"Unexpected data at end: {input.Length - idx} leftover");
}

static Model DefineModel(string filename)
{
    var input = ReadFileAsNumberArray(filename);
    var model = new Model(MakeModelName(filename));

    // Detect format: OR-Library format has machine ID (0) as the third number.
    bool isORLibraryFormat = input[2] == 0;

    if (isORLibraryFormat)
        ReadORLibraryFormat(model, input);
    else
        ReadTaillardFormat(model, input);

    return model;
}

const string usage = "Usage: dotnet run --project permutation-flowshop.csproj -- [OPTIONS] INPUT_FILE [INPUT_FILE2] ..";
var (parameters, rest) = Parameters.ParseKnownParameters(args: args, usage: usage);
if (rest.Count == 0)
{
    Console.Error.WriteLine(usage);
    Console.Error.WriteLine("Use --help for available options.");
    return 1;
}

foreach (var filename in rest)
    DefineModel(filename).Solve(parameters);

return 0;
