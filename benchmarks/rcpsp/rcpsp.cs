// Resource-Constrained Project Scheduling Problem (RCPSP).
//
// Schedule jobs with precedence constraints and limited renewable resources.
// Each job has a fixed duration and resource requirements. Resources have
// per-time-step capacity limits. Objective: minimize makespan.

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

static int[] ReadFileAsNumberArray(string filename)
{
    return ReadFile(filename)
        .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
        .Select(int.Parse).ToArray();
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

static int SkipExpected(int[] arr, int idx, int expected)
{
    if (arr[idx] != expected)
        throw new InvalidDataException($"Expected {expected}, got {arr[idx]} at index {idx}");
    return idx + 1;
}

// Read RCPSP data file in '.rcp' format
static Model DefineModelRCP(string filename)
{
    var input = ReadFileAsNumberArray(filename);
    var model = new Model(MakeModelName("rcpsp", filename));
    int idx = 0;

    // Read initial numbers at the beginning of the file:
    int nbJobs = input[idx++];
    int nbResources = input[idx++];
    int nbRealJobs = nbJobs - 2;

    // Read resource capacities and initialize their cumuls:
    var capacities = new int[nbResources];
    var cumuls = new List<CumulExpr>[nbResources];
    for (int r = 0; r < nbResources; r++)
    {
        capacities[r] = input[idx++];
        cumuls[r] = new List<CumulExpr>();
    }

    // Create interval variables
    var jobs = new IntervalVar[nbRealJobs];
    for (int j = 0; j < nbRealJobs; j++)
        jobs[j] = model.IntervalVar(name: $"T{j + 1}");

    // Skip dummy source job:
    idx = SkipExpected(input, idx, 0); // duration
    for (int r = 0; r < nbResources; r++)
        idx = SkipExpected(input, idx, 0); // resource requirement
    int nbSuccessors = input[idx++];
    idx += nbSuccessors; // successor IDs

    // Preparation for the makespan: array of end times of the last jobs
    var ends = new List<IntExpr>();

    // Read individual jobs
    for (int j = 0; j < nbRealJobs; j++)
    {
        int duration = input[idx++];
        jobs[j].LengthMin = duration;
        jobs[j].LengthMax = duration;
        for (int r = 0; r < nbResources; r++)
        {
            int requirement = input[idx++];
            cumuls[r].Add(model.Pulse(jobs[j], requirement));
        }
        nbSuccessors = input[idx++];
        bool isLast = true;
        var predecessor = jobs[j];
        for (int s = 0; s < nbSuccessors; s++)
        {
            int sID = input[idx++];
            if (sID < 2 || sID > nbJobs)
                throw new InvalidDataException($"Successor ID out of range: {sID}");
            // Ignore sink job:
            if (sID < nbJobs)
            {
                var successor = jobs[sID - 2];
                predecessor.EndBeforeStart(successor);
                isLast = false;
            }
        }
        if (isLast)
            ends.Add(predecessor.End());
    }

    // Skip dummy sink job:
    idx = SkipExpected(input, idx, 0); // duration
    for (int r = 0; r < nbResources; r++)
        idx = SkipExpected(input, idx, 0); // resource requirement
    idx = SkipExpected(input, idx, 0); // number of successors

    // Constraint height of cumuls:
    for (int r = 0; r < nbResources; r++)
        model.Enforce(model.Sum(cumuls[r]) <= capacities[r]);

    // Minimize makespan:
    model.Minimize(model.Max(ends));

    // There shouldn't be anything more in the input:
    if (idx != input.Length)
        throw new InvalidDataException($"Unexpected data at end: {input.Length - idx} leftover");

    return model;
}

// Read RCPSP data file in '.sm' format
static Model DefineModelSM(string filename)
{
    var model = new Model(MakeModelName("rcpsp", filename));

    // Read the whole file into memory and remove text labels:
    string inputTxt = ReadFile(filename).Replace("\r\n", "\n");
    inputTxt = Regex.Replace(inputTxt, @"^\*\**$", "", RegexOptions.Multiline);
    inputTxt = Regex.Replace(inputTxt, @"file with basedata *: .*", "");
    inputTxt = Regex.Replace(inputTxt, @"initial value random generator: [0-9]*", "");
    inputTxt = Regex.Replace(inputTxt, @"projects +: {2}1", "");
    inputTxt = Regex.Replace(inputTxt, @"jobs \(incl. supersource/sink \): ", "");
    inputTxt = Regex.Replace(inputTxt, @"horizon *:", "");
    inputTxt = Regex.Replace(inputTxt, @"RESOURCES", "");
    inputTxt = Regex.Replace(inputTxt, @"- renewable *: *([0-9]*) *R", "$1");
    inputTxt = Regex.Replace(inputTxt, @"- nonrenewable *: *0 *N", "");
    inputTxt = Regex.Replace(inputTxt, @"- doubly constrained *: *0 *D", "");
    inputTxt = Regex.Replace(inputTxt, @"PROJECT INFORMATION:", "");
    inputTxt = Regex.Replace(inputTxt, @"pronr\. *#jobs rel.date duedate tardcost *MPM-Time", "");
    inputTxt = Regex.Replace(inputTxt, @"PRECEDENCE RELATIONS:", "");
    inputTxt = Regex.Replace(inputTxt, @"jobnr. *#modes *#successors *successors", "");
    inputTxt = Regex.Replace(inputTxt, @"REQUESTS/DURATIONS:", "");
    inputTxt = Regex.Replace(inputTxt, @"jobnr. mode duration [ R0-9]*", "");
    inputTxt = Regex.Replace(inputTxt, @"^--*$", "", RegexOptions.Multiline);
    inputTxt = Regex.Replace(inputTxt, @"RESOURCEAVAILABILITIES:", "");
    inputTxt = Regex.Replace(inputTxt, @"^ *R 1 [ R0-9]*$", "", RegexOptions.Multiline);

    // After this preprocessing there should be only numbers:
    if (!Regex.IsMatch(inputTxt, @"^[ 0-9\n\r]*$"))
    {
        Console.WriteLine("Failed to remove garbage from the input file. Result after replace:");
        Console.WriteLine(inputTxt);
        Environment.Exit(1);
    }

    var input = inputTxt.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
        .Select(int.Parse).ToArray();
    int idx = 0;

    // Read initial numbers at the beginning of the file:
    int nbJobs = input[idx++];
    idx++; // horizon (unused)
    int nbResources = input[idx++];
    idx = SkipExpected(input, idx, 1); // pronr
    int nbRealJobs = input[idx++];
    idx = SkipExpected(input, idx, 0); // releaseDate
    idx += 3; // dueDate, tardCost, mpmTime (unused)

    if (nbRealJobs != nbJobs - 2)
        throw new InvalidDataException("nbRealJobs mismatch");

    // Create interval variables
    var jobs = new IntervalVar[nbRealJobs];
    for (int j = 0; j < nbRealJobs; j++)
        jobs[j] = model.IntervalVar(name: $"T{j + 1}");

    // Skip dummy source job:
    idx = SkipExpected(input, idx, 1); // job ID
    idx = SkipExpected(input, idx, 1); // mode
    int nbSuccessors = input[idx++];
    idx += nbSuccessors; // successor IDs

    // Preparation for the makespan: array of end times of the last jobs
    var ends = new List<IntExpr>();

    // Read precedence relations for the real jobs:
    for (int j = 0; j < nbRealJobs; j++)
    {
        idx = SkipExpected(input, idx, j + 2); // job ID
        idx = SkipExpected(input, idx, 1); // number of modes
        bool isLast = true;
        var predecessor = jobs[j];
        nbSuccessors = input[idx++];
        for (int s = 0; s < nbSuccessors; s++)
        {
            int sID = input[idx++];
            if (sID < 2 || sID > nbJobs)
                throw new InvalidDataException($"Successor ID out of range: {sID}");
            // Ignore sink job:
            if (sID < nbJobs)
            {
                var successor = jobs[sID - 2];
                predecessor.EndBeforeStart(successor);
                isLast = false;
            }
        }
        if (isLast)
            ends.Add(predecessor.End());
    }

    // Minimize makespan:
    model.Minimize(model.Max(ends));

    // Skip dummy sink job (precedence):
    idx = SkipExpected(input, idx, nbJobs); // jobID
    idx = SkipExpected(input, idx, 1); // mode
    idx = SkipExpected(input, idx, 0); // number of successors

    // Prepare cumulative resources:
    var cumuls = new List<CumulExpr>[nbResources];
    for (int r = 0; r < nbResources; r++)
        cumuls[r] = new List<CumulExpr>();

    // Skip dummy source job (duration/resources):
    idx = SkipExpected(input, idx, 1); // jobID
    idx = SkipExpected(input, idx, 1); // mode
    idx = SkipExpected(input, idx, 0); // duration
    for (int r = 0; r < nbResources; r++)
        idx = SkipExpected(input, idx, 0); // required capacity

    // Parse job durations and resource requirements
    for (int j = 0; j < nbRealJobs; j++)
    {
        idx = SkipExpected(input, idx, j + 2); // jobID
        idx = SkipExpected(input, idx, 1); // mode
        int duration = input[idx++];
        var job = jobs[j];
        job.LengthMin = duration;
        job.LengthMax = duration;
        for (int r = 0; r < nbResources; r++)
        {
            int c = input[idx++];
            if (c > 0)
                cumuls[r].Add(model.Pulse(job, c));
        }
    }

    // Skip dummy sink job (duration/resources):
    idx = SkipExpected(input, idx, nbJobs); // jobID
    idx = SkipExpected(input, idx, 1); // mode
    idx = SkipExpected(input, idx, 0); // duration
    for (int r = 0; r < nbResources; r++)
        idx = SkipExpected(input, idx, 0); // required capacity

    // Read available resource capacities:
    for (int r = 0; r < nbResources; r++)
    {
        int c = input[idx++];
        if (c <= 0)
            throw new InvalidDataException($"Non-positive resource capacity: {c}");
        model.Enforce(model.Sum(cumuls[r]) <= c);
    }

    if (idx != input.Length)
        throw new InvalidDataException($"Unexpected data at end: {input.Length - idx} leftover");

    return model;
}

static Model DefineModel(string filename)
{
    // There are two different file formats: `.sm` and `.rcp`.
    if (filename.Contains(".rcp"))
        return DefineModelRCP(filename);
    if (filename.Contains(".sm"))
        return DefineModelSM(filename);

    Console.WriteLine($"Unable to guess data format of '{filename}'. Known extensions are .rcp and .sm.");
    Environment.Exit(1);
    return null!;
}

const string usage = "Usage: dotnet run --project rcpsp.csproj -- [OPTIONS] INPUT_FILE [INPUT_FILE2] ..";
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
