// Resource-Constrained Project Scheduling Problem with Consumption and Production
// of Resources (RCPSP-CPR). Extends classical RCPSP by introducing storage resources
// (reservoirs) that track cumulative levels based on consumption at activity start
// and production at activity end.

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
    return content.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
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

static Model DefineModel(string filename)
{
    var input = ReadFileAsNumberArray(filename);
    var model = new Model(MakeModelName("rcpsp-cpr", filename));
    int idx = 0;

    // Read problem dimensions:
    int nbJobs = input[idx++];
    int nbRenewables = input[idx++];
    int nbReservoirs = input[idx++];
    int nbRealJobs = nbJobs - 2;

    // Read resource capacities and initial reservoir levels:
    var renewableCapacities = new int[nbRenewables];
    var renewables = new List<CumulExpr>[nbRenewables];
    for (int r = 0; r < nbRenewables; r++)
    {
        renewableCapacities[r] = input[idx++];
        renewables[r] = new List<CumulExpr>();
    }
    var reservoirs = new List<CumulExpr>[nbReservoirs];
    for (int r = 0; r < nbReservoirs; r++)
        reservoirs[r] = new List<CumulExpr> { model.StepAt(Model.IntervalMin, input[idx++]) };

    // Create interval variables:
    var jobs = new IntervalVar[nbRealJobs];
    for (int j = 0; j < nbRealJobs; j++)
        jobs[j] = model.IntervalVar(name: $"T{j + 1}");

    // Skip dummy source job (length must be zero):
    if (input[idx++] != 0)
        throw new InvalidDataException("source job duration != 0");
    for (int r = 0; r < nbRenewables; r++)
    {
        int c = input[idx++];
        // Non-zero requirement is OK because length is zero.
        if (c > 0)
            Console.WriteLine($"Warning: {model.Name} has source job with non-zero renewable requirement.");
    }
    // As noted in README.md, consumption and production of dummy jobs is
    // ignored, because otherwise the number of infeasible instances does not
    // match the results from literature.
    idx += 2 * nbReservoirs;
    int nbSuccessors = input[idx++];
    idx += nbSuccessors; // Skip successor IDs

    // End times of jobs without successors (for makespan):
    var ends = new List<IntExpr>();

    // Read individual jobs:
    int maxMakespan = 0;
    for (int j = 0; j < nbRealJobs; j++)
    {
        int duration = input[idx++];
        jobs[j].LengthMin = duration;
        jobs[j].LengthMax = duration;
        maxMakespan += duration;
        for (int r = 0; r < nbRenewables; r++)
        {
            int requirement = input[idx++];
            renewables[r].Add(model.Pulse(jobs[j], requirement));
        }
        for (int r = 0; r < nbReservoirs; r++)
        {
            int consumption = input[idx++];
            int production = input[idx++];
            if (duration > 0)
            {
                if (consumption != 0)
                    // Using -step instead of negative height for CP Optimizer compatibility:
                    reservoirs[r].Add(-model.StepAtStart(jobs[j], consumption));
                if (production != 0)
                    reservoirs[r].Add(model.StepAtEnd(jobs[j], production));
            }
        }
        nbSuccessors = input[idx++];
        bool isLast = true;
        var predecessor = jobs[j];
        for (int s = 0; s < nbSuccessors; s++)
        {
            int sID = input[idx++];
            if (sID < 2 || sID > nbJobs)
                throw new InvalidDataException($"Successor ID {sID} out of range");
            if (sID < nbJobs)
            {
                predecessor.EndBeforeStart(jobs[sID - 2]);
                isLast = false;
            }
        }
        if (isLast)
            ends.Add(predecessor.End());
    }

    // Skip dummy sink job:
    if (input[idx++] != 0)
        throw new InvalidDataException("sink job length != 0");
    for (int r = 0; r < nbRenewables; r++)
        if (input[idx++] != 0)
            throw new InvalidDataException("sink renewable requirement != 0");
    idx += 2 * nbReservoirs;
    if (input[idx++] != 0)
        throw new InvalidDataException("sink job successors != 0");

    // Renewable resources must not exceed capacity, reservoirs must stay non-negative:
    for (int r = 0; r < nbRenewables; r++)
        model.Enforce(model.Sum(renewables[r]) <= renewableCapacities[r]);
    for (int r = 0; r < nbReservoirs; r++)
        model.Enforce(model.Sum(reservoirs[r]) >= 0);

    // Limit makespan to prevent propagation cycles:
    for (int j = 0; j < nbRealJobs; j++)
        jobs[j].EndMax = maxMakespan;

    model.Minimize(model.Max(ends));

    if (idx != input.Length)
        throw new InvalidDataException($"Unexpected data at end: {input.Length - idx} leftover");

    return model;
}

const string usage = "Usage: dotnet run --project rcpsp-cpr.csproj -- [OPTIONS] INPUT_FILE.rcp [INPUT_FILE2.rcp] ..";
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
