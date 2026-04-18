// Job shop with operators: each operation requires both a machine and an operator.
// The number of operators is limited, adding a cumulative resource constraint.

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

static string MakeModelName(string filename, int nbOperators)
{
    var instance = filename.Replace('/', '_').Replace('\\', '_');
    instance = Regex.Replace(instance, @"^data_", "");
    instance = Regex.Replace(instance, @"\.gz$", "");
    instance = Regex.Replace(instance, @"\.json$", "");
    instance = Regex.Replace(instance, @"\....?$", "");
    return $"jobshop-operators_{instance}_{nbOperators}opers";
}

static Model DefineModel(string filename, int nbOperators)
{
    var input = ReadFileAsNumberArray(filename);
    var model = new Model(MakeModelName(filename, nbOperators));
    int idx = 0;
    int nbJobs = input[idx++];
    int nbMachines = input[idx++];

    // For each machine, an array of operations executed on it:
    var machines = new List<IntervalVar>[nbMachines];
    for (int j = 0; j < nbMachines; j++)
        machines[j] = new List<IntervalVar>();

    // End times of each job:
    var ends = new List<IntExpr>();

    // Cumulative pulses for operator requirements:
    var operatorRequirements = new List<CumulExpr>();

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
            // Each operation requires an operator:
            operatorRequirements.Add(operation.Pulse(1));
            // Chain with previous operation:
            if (prev != null)
                prev.EndBeforeStart(operation);
            prev = operation;
        }
        ends.Add(prev!.End());
    }

    // Tasks on each machine cannot overlap:
    for (int j = 0; j < nbMachines; j++)
        model.NoOverlap(machines[j]);

    // Limited number of operators:
    model.Enforce(model.Sum(operatorRequirements) <= nbOperators);

    // Minimize the makespan:
    model.Minimize(model.Max(ends));

    return model;
}

static int GetIntOption(string name, int defaultValue, List<string> args)
{
    int idx = args.IndexOf(name);
    if (idx == -1 || idx + 1 >= args.Count || !int.TryParse(args[idx + 1], out int value))
        return defaultValue;
    args.RemoveRange(idx, 2);
    return value;
}

const string usage =
    "Usage: dotnet run --project jobshop-operators.csproj -- --nbOperators <n> [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n" +
    "Jobshop-operators options:\n" +
    "  --nbOperators <number>  Number of available operators (required)";
var (parameters, restArgs) = Parameters.ParseKnownParameters(args: args, usage: usage);

int nbOperators = GetIntOption("--nbOperators", 0, restArgs);

if (nbOperators <= 0)
{
    Console.Error.WriteLine("Missing or invalid --nbOperators argument.");
    return 1;
}

if (restArgs.Count == 0)
{
    Console.Error.WriteLine(usage);
    Console.Error.WriteLine("Use --help for available options.");
    return 1;
}

foreach (var filename in restArgs)
    DefineModel(filename, nbOperators).Solve(parameters);

return 0;
