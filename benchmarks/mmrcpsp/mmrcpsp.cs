// Multi-Mode Resource-Constrained Project Scheduling Problem (MMRCPSP).
//
// Jobs must be scheduled respecting precedence constraints. Each job has multiple
// execution modes with different durations and resource requirements. Renewable
// resources have per-time-step capacity limits. Non-renewable resources have
// total capacity limits across the entire project.
//
// Objective: minimize non-renewable resource overflow (as penalty), then makespan.

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

static int SkipExpected(int[] arr, int idx, int expected)
{
    if (arr[idx] != expected)
        throw new InvalidDataException($"Expected {expected}, got {arr[idx]} at index {idx}");
    return idx + 1;
}

static Model DefineModel(string filename, bool useRedundantCumuls, bool useGlobalCumul, bool useGlobalNonRenewable)
{
    string inputTxt = ReadFile(filename).Replace("\r\n", "\n");
    var model = new Model(MakeModelName("mmrcpsp", filename));

    bool hasProjectInformation = Regex.IsMatch(inputTxt, @"PROJECT INFORMATION:");

    // Remove text labels from the input file, keeping only numbers:
    inputTxt = Regex.Replace(inputTxt, @"^\*+$", "", RegexOptions.Multiline);
    inputTxt = Regex.Replace(inputTxt, @"file with basedata *: .*", "");
    inputTxt = Regex.Replace(inputTxt, @"initial value random generator: [0-9]*", "");
    inputTxt = Regex.Replace(inputTxt, @"projects +: {2}1", "");
    inputTxt = Regex.Replace(inputTxt, @"jobs *\(incl. supersource/sink \):", "");
    inputTxt = Regex.Replace(inputTxt, @"RESOURCES", "");
    inputTxt = Regex.Replace(inputTxt, @"- renewable *: *([0-9]*) *R", "$1");
    inputTxt = Regex.Replace(inputTxt, @"- nonrenewable *: *([0-9]*) *N", "$1");
    inputTxt = Regex.Replace(inputTxt, @"- doubly constrained *: *0 *D", "");
    inputTxt = Regex.Replace(inputTxt, @"horizon[ \t]*:[ \t]*[0-9]*", "");
    inputTxt = Regex.Replace(inputTxt, @"PROJECT INFORMATION:", "");
    inputTxt = Regex.Replace(inputTxt, @"pronr\. *#jobs rel.date duedate tardcost *MPM-Time", "");
    inputTxt = Regex.Replace(inputTxt, @"PRECEDENCE RELATIONS:", "");
    inputTxt = Regex.Replace(inputTxt, @"jobnr. *#modes *#successors *successors", "");
    inputTxt = Regex.Replace(inputTxt, @"REQUESTS/DURATIONS:?", "");
    inputTxt = Regex.Replace(inputTxt, @"jobnr.[ \t]*mode[ \t]*dur(ation)?[ \t]*[ \tNR0-9]*", "");
    inputTxt = Regex.Replace(inputTxt, @"^-+$", "", RegexOptions.Multiline);
    inputTxt = Regex.Replace(inputTxt, @"RESOURCE ?AVAILABILITIES:?", "");
    inputTxt = Regex.Replace(inputTxt, @"^[\t ]*R 1[\t NR0-9]*$", "", RegexOptions.Multiline);

    if (!Regex.IsMatch(inputTxt, @"^[ \t0-9\r\n]*$"))
    {
        Console.WriteLine("Failed to remove garbage from the input file. Result after replace:");
        Console.WriteLine(inputTxt);
        Environment.Exit(1);
    }

    var input = inputTxt.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
        .Select(int.Parse).ToArray();
    int idx = 0;

    int nbJobs = input[idx++];
    int nbRealJobs = nbJobs - 2;
    int nbResources = input[idx++];
    int nbNonRenewable = input[idx++];

    if (hasProjectInformation)
    {
        int pronr = input[idx++];
        int nbNonDummyJobs = input[idx++];
        int releaseDate = input[idx++];
        idx += 3; // dueDate, tardCost, mpmTime (unused)
        if (pronr != 1 || nbNonDummyJobs != nbRealJobs || releaseDate != 0)
            throw new InvalidDataException("Unexpected project information values");
    }

    // Create main interval variable for each job (mode selection via alternative below):
    var jobs = new IntervalVar[nbRealJobs];
    for (int j = 0; j < nbRealJobs; j++)
        jobs[j] = model.IntervalVar(name: $"J{j + 1}");

    // Skip precedence relations for the dummy source job:
    idx = SkipExpected(input, idx, 1); // job ID
    idx = SkipExpected(input, idx, 1); // number of modes
    int nbSuccessors = input[idx++];
    idx += nbSuccessors;

    var nbModes = new int[nbRealJobs];
    var ends = new List<IntExpr>();

    // Read precedence relations and add EndBeforeStart constraints:
    for (int j = 0; j < nbRealJobs; j++)
    {
        idx = SkipExpected(input, idx, j + 2); // job ID
        nbModes[j] = input[idx++];
        bool isLast = true;
        var predecessor = jobs[j];
        nbSuccessors = input[idx++];
        for (int s = 0; s < nbSuccessors; s++)
        {
            int sID = input[idx++];
            if (sID < 2 || sID > nbJobs)
                throw new InvalidDataException($"Successor ID out of range: {sID}");
            if (sID < nbJobs)
            {
                predecessor.EndBeforeStart(jobs[sID - 2]);
                isLast = false;
            }
        }
        if (isLast)
            ends.Add(predecessor.End());
    }

    // Skip precedence relations of the dummy sink job:
    idx = SkipExpected(input, idx, nbJobs);
    idx = SkipExpected(input, idx, 1);
    idx = SkipExpected(input, idx, 0);

    // Cumulative expressions for renewable resources (per-resource capacity limits):
    var cumuls = new List<CumulExpr>[nbResources];
    var redundantCumuls = new List<CumulExpr>[nbResources];
    for (int r = 0; r < nbResources; r++)
    {
        cumuls[r] = new List<CumulExpr>();
        redundantCumuls[r] = new List<CumulExpr>();
    }
    var globalCumul = new List<CumulExpr>();
    // Integer expressions for non-renewable resources (total usage across project):
    var nonRenewables = new List<IntExpr>[nbNonRenewable];
    for (int n = 0; n < nbNonRenewable; n++)
        nonRenewables[n] = new List<IntExpr>();
    var globalNonRenewable = new List<IntExpr>();

    // Skip duration and resource requirements of dummy source job:
    idx = SkipExpected(input, idx, 1);
    idx = SkipExpected(input, idx, 1);
    idx = SkipExpected(input, idx, 0);
    for (int r = 0; r < nbResources; r++)
        idx = SkipExpected(input, idx, 0);
    for (int n = 0; n < nbNonRenewable; n++)
        idx = SkipExpected(input, idx, 0);

    // Parse job modes with durations and resource requirements:
    for (int j = 0; j < nbRealJobs; j++)
    {
        idx = SkipExpected(input, idx, j + 2); // jobID
        var modes = new IntervalVar[nbModes[j]];
        var renewableRequirements = new int[nbResources][];
        for (int r = 0; r < nbResources; r++)
            renewableRequirements[r] = new int[nbModes[j]];

        for (int a = 0; a < nbModes[j]; a++)
        {
            idx = SkipExpected(input, idx, a + 1); // mode
            int duration = input[idx++];
            var mode = model.IntervalVar(
                length: duration,
                optional: true,
                name: $"J{j + 1}M{a + 1}");
            modes[a] = mode;
            int totalC = 0;
            for (int r = 0; r < nbResources; r++)
            {
                int c = input[idx++];
                renewableRequirements[r][a] = c;
                totalC += c;
            }
            globalCumul.Add(model.Pulse(modes[a], totalC));
            totalC = 0;
            for (int n = 0; n < nbNonRenewable; n++)
            {
                int c = input[idx++];
                nonRenewables[n].Add(mode.Presence() * c);
                totalC += c;
            }
            globalNonRenewable.Add(mode.Presence() * totalC);
        }
        // Add cumulative pulses for renewable resources:
        for (int r = 0; r < nbResources; r++)
        {
            int minC = renewableRequirements[r].Min();
            int maxC = renewableRequirements[r].Max();
            if (maxC == 0)
                continue; // Job doesn't use this resource in any mode
            if (minC == maxC)
            {
                // All modes have the same requirement: use main job interval
                cumuls[r].Add(model.Pulse(jobs[j], minC));
                redundantCumuls[r].Add(model.Pulse(jobs[j], minC));
                continue;
            }
            // Variable requirement: add pulse for each mode interval
            var heights = new List<IntExpr>();
            for (int a = 0; a < nbModes[j]; a++)
            {
                int c = renewableRequirements[r][a];
                heights.Add(modes[a].Presence() * c);
                if (c == 0)
                    continue;
                cumuls[r].Add(model.Pulse(modes[a], c));
            }
            redundantCumuls[r].Add(model.Pulse(jobs[j], model.Sum(heights)));
        }
        // Exactly one mode must be selected for each job:
        model.Alternative(jobs[j], modes);
    }

    // Skip duration and resource requirements of dummy sink job:
    idx = SkipExpected(input, idx, nbJobs);
    idx = SkipExpected(input, idx, 1);
    idx = SkipExpected(input, idx, 0);
    for (int r = 0; r < nbResources; r++)
        idx = SkipExpected(input, idx, 0);
    for (int n = 0; n < nbNonRenewable; n++)
        idx = SkipExpected(input, idx, 0);

    // Renewable resource capacity constraints:
    int globalC = 0;
    for (int r = 0; r < nbResources; r++)
    {
        int c = input[idx++];
        if (c <= 0)
            throw new InvalidDataException($"Non-positive renewable capacity: {c}");
        globalC += c;
        model.Enforce(model.Sum(cumuls[r]) <= c);
        if (useRedundantCumuls)
            model.Enforce(model.Sum(redundantCumuls[r]) <= c);
    }
    if (useGlobalCumul)
        model.Enforce(model.Sum(globalCumul) <= globalC);

    // Non-renewable resource constraints (soft: overflow adds to cost):
    var cost = new List<IntExpr>();
    globalC = 0;
    for (int n = 0; n < nbNonRenewable; n++)
    {
        int c = input[idx++];
        globalC += c;
        var used = model.Sum(nonRenewables[n]);
        var overflow = model.Max2(0, used - c);
        cost.Add(overflow);
    }
    if (useGlobalNonRenewable)
    {
        var used = model.Sum(globalNonRenewable);
        var overflow = model.Max2(0, used - globalC);
        cost.Add(overflow);
    }

    // Objective: minimize overflow penalty (×1000) + makespan (lexicographic-like):
    model.Minimize(model.Sum(cost) * 1000 + model.Max(ends));

    return model;
}

const string usage =
    "Usage: dotnet run --project mmrcpsp.csproj -- [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n" +
    "MMRCPSP options:\n" +
    "  --redundantCumuls     Add redundant cumulative constraints\n" +
    "  --globalCumul         Add global cumulative constraint\n" +
    "  --globalNonRenewable  Add global non-renewable resource constraint";
var (parameters, restArgs) = Parameters.ParseKnownParameters(args: args, usage: usage);

bool useRedundantCumuls = false;
bool useGlobalCumul = false;
bool useGlobalNonRenewable = false;
var inputFiles = new List<string>();
foreach (var arg in restArgs)
{
    switch (arg)
    {
        case "--redundantCumuls": useRedundantCumuls = true; break;
        case "--globalCumul": useGlobalCumul = true; break;
        case "--globalNonRenewable": useGlobalNonRenewable = true; break;
        default: inputFiles.Add(arg); break;
    }
}

if (inputFiles.Count == 0)
{
    Console.Error.WriteLine(usage);
    Console.Error.WriteLine("Use --help for available options.");
    return 1;
}

foreach (var filename in inputFiles)
    DefineModel(filename, useRedundantCumuls, useGlobalCumul, useGlobalNonRenewable).Solve(parameters);

return 0;
