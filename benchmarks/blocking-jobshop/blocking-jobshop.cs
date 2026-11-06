// Blocking job shop: a job blocks its machine until the next machine becomes available.
// Modeled by allowing operations (except the last in each job) to have variable duration.

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

static Model DefineModel(string filename)
{
    var input = ReadFileAsNumberArray(filename);
    var model = new Model(MakeModelName("blocking-jobshop", filename));
    int idx = 0;
    int nbJobs = input[idx++];
    int nbMachines = input[idx++];

    // For each machine create an array of operations executed on it:
    var machines = new List<IntervalVar>[nbMachines];
    for (int j = 0; j < nbMachines; j++)
        machines[j] = new List<IntervalVar>();

    // End times of each job:
    var ends = new List<IntExpr>();

    for (int i = 0; i < nbJobs; i++)
    {
        IntervalVar? prev = null;
        for (int j = 0; j < nbMachines; j++)
        {
            int machineId = input[idx++];
            int duration = input[idx++];
            // Variable duration models waiting (blocking) on the machine;
            // last operation doesn't block:
            int maxDuration = j < nbMachines - 1 ? Model.IntervalMax : duration;
            var operation = model.IntervalVar(
                length: (duration, maxDuration),
                name: $"J{i + 1}O{j + 1}M{machineId + 1}");
            machines[machineId].Add(operation);
            // Chain to previous operation:
            if (prev != null)
                prev.EndAtStart(operation);
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

const string usage = "Usage: dotnet run --project blocking-jobshop.csproj -- [OPTIONS] INPUT_FILE [INPUT_FILE2] ..";
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
