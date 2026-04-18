// RCPSP/max: Resource-Constrained Project Scheduling Problem with generalized
// precedence constraints (minimum and maximum time lags).

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

static Model DefineModel(string filename)
{
    string inputText = ReadFile(filename);
    // Input files contain characters '[' and ']'. Ignore them and convert the
    // text into an array of numbers:
    inputText = Regex.Replace(inputText, @"[\[\]]", "");
    var input = inputText.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
        .Select(int.Parse).ToArray();

    var model = new Model(MakeModelName("rcpsp-max", filename));
    int idx = 0;

    // Read initial numbers at the beginning of the file:
    int nbRealJobs = input[idx++];
    int nbResources = input[idx++];
    if (input[idx++] != 0) throw new InvalidDataException("expected 0 non-renewable resources");
    if (input[idx++] != 0) throw new InvalidDataException("expected 0 doubly-constrained resources");

    // Create interval variables
    var jobs = new IntervalVar[nbRealJobs];
    // To compute scheduling horizon, it is good to know the maximum delay of
    // precedences starting at the given job:
    var maxDelayAfter = new int[nbRealJobs];
    for (int j = 0; j < nbRealJobs; j++)
    {
        jobs[j] = model.IntervalVar(name: $"T{j + 1}");
        maxDelayAfter[j] = 0;
    }

    // Ignore precedence relations for the dummy source job at the beginning:
    if (input[idx++] != 0) throw new InvalidDataException("dummy source job ID");
    if (input[idx++] != 1) throw new InvalidDataException("dummy source mode ID");
    int nbSuccessors = input[idx++];
    for (int s = 0; s < nbSuccessors; s++) idx++; // successor id
    for (int s = 0; s < nbSuccessors; s++)
        if (input[idx++] != 0) throw new InvalidDataException("dummy source precedence length");

    // Preparation for the makespan: array of end times of the last jobs
    var ends = new List<IntExpr>();

    // Read precedence relations for normal jobs:
    for (int j = 0; j < nbRealJobs; j++)
    {
        if (input[idx++] != j + 1) throw new InvalidDataException($"job ID {j + 1}");
        if (input[idx++] != 1) throw new InvalidDataException($"mode ID for job {j + 1}");
        nbSuccessors = input[idx++];
        bool countInMakespan = false;
        var predecessor = jobs[j];
        var successors = new IntervalVar?[nbSuccessors];
        // First there are IDs of the successors:
        for (int s = 0; s < nbSuccessors; s++)
        {
            int sID = input[idx++];
            if (sID < 1 || sID > nbRealJobs + 1)
                throw new InvalidDataException($"successor ID {sID}");
            if (sID <= nbRealJobs)
                successors[s] = jobs[sID - 1];
            else
            {
                // Successor is the sink dummy job. Include the predecessor in
                // makespan computation:
                countInMakespan = true;
                successors[s] = null;
            }
        }
        // Then read delays and create precedences:
        for (int s = 0; s < nbSuccessors; s++)
        {
            int delay = input[idx++];
            var successor = successors[s];
            if (successor != null)
            {
                predecessor.StartBeforeStart(successor, delay);
            }
            else
            {
                // Delay to the sink equals the job's duration.
                if (predecessor.LengthMin != 0)
                    throw new InvalidDataException("predecessor lengthMin not 0");
                predecessor.LengthMin = delay;
                predecessor.LengthMax = delay;
            }
            maxDelayAfter[j] = Math.Max(maxDelayAfter[j], delay);
        }
        if (countInMakespan)
            ends.Add(predecessor.End());
    }

    // Ignore precedences for the dummy sink job:
    if (input[idx++] != nbRealJobs + 1) throw new InvalidDataException("sink job ID");
    if (input[idx++] != 1) throw new InvalidDataException("sink mode ID");
    if (input[idx++] != 0) throw new InvalidDataException("sink successors count");

    // Read durations and resource usage.
    // First, ignore the dummy source job:
    if (input[idx++] != 0) throw new InvalidDataException("source dur ID");
    if (input[idx++] != 1) throw new InvalidDataException("source dur mode");
    if (input[idx++] != 0) throw new InvalidDataException("source duration");
    for (int r = 0; r < nbResources; r++)
        if (input[idx++] != 0) throw new InvalidDataException("source resource req");

    // Prepare arrays for resources:
    var resources = new List<CumulExpr>[nbResources];
    for (int r = 0; r < nbResources; r++)
        resources[r] = new List<CumulExpr>();

    // We're going to compute rough UB (maximum end time) for all interval vars:
    int horizon = 0;

    // Read durations and resource usage for real jobs
    for (int j = 0; j < nbRealJobs; j++)
    {
        if (input[idx++] != j + 1) throw new InvalidDataException($"job ID in dur section {j + 1}");
        if (input[idx++] != 1) throw new InvalidDataException($"mode ID for job {j + 1}");
        int duration = input[idx++];
        if (jobs[j].LengthMin != 0 && jobs[j].LengthMin != duration)
            throw new InvalidDataException($"duration mismatch for job {j + 1}");
        horizon += Math.Max(duration, maxDelayAfter[j]);
        jobs[j].LengthMin = duration;
        jobs[j].LengthMax = duration;
        for (int r = 0; r < nbResources; r++)
        {
            int requirement = input[idx++];
            resources[r].Add(model.Pulse(jobs[j], requirement));
        }
    }

    // Apply computed horizon:
    for (int j = 0; j < nbRealJobs; j++)
        jobs[j].EndMax = horizon;

    // Ignore resource requirements of the dummy sink job:
    if (input[idx++] != nbRealJobs + 1) throw new InvalidDataException("sink res id");
    if (input[idx++] != 1) throw new InvalidDataException("sink res mode");
    if (input[idx++] != 0) throw new InvalidDataException("sink duration");
    for (int r = 0; r < nbResources; r++)
        if (input[idx++] != 0) throw new InvalidDataException("sink resource usage");

    // Read resource capacities and create cumulative constraints:
    for (int r = 0; r < nbResources; r++)
    {
        int capacity = input[idx++];
        model.Enforce(model.Sum(resources[r]) <= capacity);
    }

    if (idx != input.Length)
        throw new InvalidDataException($"Unexpected data at end: {input.Length - idx} leftover");

    // Minimize makespan:
    model.Minimize(model.Max(ends));

    return model;
}

const string usage = "Usage: dotnet run --project rcpsp-max.csproj -- [OPTIONS] INPUT_FILE [INPUT_FILE2] ..";
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
