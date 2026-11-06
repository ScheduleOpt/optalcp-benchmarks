// Job shop scheduling problem.
//
// Each job is a sequence of operations, each requiring a specific machine for
// a given duration. Machines process one operation at a time. Minimize the
// makespan.

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
    return $"jobshop_{instance}";
}

static Model DefineModel(string filename)
{
    var input = ReadFileAsNumberArray(filename);
    var model = new Model(MakeModelName(filename));
    int idx = 0;
    int nbJobs = input[idx++];
    int nbMachines = input[idx++];

    // For each machine, an array of operations executed on it:
    var machines = new List<IntervalVar>[nbMachines];
    for (int j = 0; j < nbMachines; j++)
        machines[j] = new List<IntervalVar>();

    // End times of each job:
    var ends = new List<IntExpr>();

    for (int i = 0; i < nbJobs; i++)
    {
        // Previous task in the job:
        IntervalVar? prev = null;
        for (int j = 0; j < nbMachines; j++)
        {
            int machineId = input[idx++];
            int duration = input[idx++];
            var operation = model.IntervalVar(
                length: duration,
                name: $"J{i + 1}O{j + 1}M{machineId + 1}");
            machines[machineId].Add(operation);
            // Chain with previous operation:
            if (prev != null)
                prev.EndBeforeStart(operation);
            prev = operation;
        }
        // End time of the job is end time of the last operation:
        ends.Add(prev!.End());
    }

    // Tasks on each machine cannot overlap:
    for (int j = 0; j < nbMachines; j++)
        model.NoOverlap(machines[j]);

    // Minimize the makespan:
    model.Minimize(model.Max(ends));

    return model;
}

const string usage = "Usage: dotnet run --project jobshop.csproj -- [OPTIONS] INPUT_FILE [INPUT_FILE2] ..";
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
