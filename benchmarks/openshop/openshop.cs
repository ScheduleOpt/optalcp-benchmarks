// Open Shop Scheduling: schedule n jobs on m machines where each job has one
// operation per machine. Operations of a job can run in any order but cannot
// overlap. Minimize makespan.

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
    var model = new Model(MakeModelName("openshop", filename));
    int idx = 0;
    int nbJobs = input[idx++];
    int nbMachines = input[idx++];

    // For each machine create an array of operations executed on it:
    var machines = new List<IntervalVar>[nbMachines];
    for (int m = 0; m < nbMachines; m++)
        machines[m] = new List<IntervalVar>();

    // Similarly for each job create an array of its operations:
    var jobs = new List<IntervalVar>[nbJobs];
    for (int j = 0; j < nbJobs; j++)
        jobs[j] = new List<IntervalVar>();

    // End times of all operations:
    var ends = new List<IntExpr>();

    // Longest operation (for symmetry breaking):
    IntervalVar? longest = null;
    int maxLength = 0;

    for (int j = 0; j < nbJobs; j++)
    {
        for (int m = 0; m < nbMachines; m++)
        {
            int duration = input[idx++];
            var operation = model.IntervalVar(
                length: duration,
                name: $"J{j + 1}M{m + 1}");
            machines[m].Add(operation);
            jobs[j].Add(operation);
            ends.Add(operation.End());
            if (maxLength < duration)
            {
                maxLength = duration;
                longest = operation;
            }
        }
    }

    // Tasks on each machine cannot overlap:
    for (int m = 0; m < nbMachines; m++)
        model.NoOverlap(machines[m]);
    // Similarly operations of a job cannot overlap:
    for (int j = 0; j < nbJobs; j++)
        model.NoOverlap(jobs[j]);

    // Minimize the makespan:
    var makespan = model.Max(ends);
    model.Minimize(makespan);

    // Break symmetry.
    // The symmetry is that the backward schedule is a valid solution. So force
    // the longest variable in the first half of the makespan.
    if (longest != null)
        model.Enforce((makespan - longest.Length()) / 2 >= longest.Start());
    // For discussion about symmetry breaking see the following paper:
    // Malapert, Cambazard, Guéret, Jussien, Langevin, Rousseau:
    //   An Optimal Constraint Programming Approach to the Open-Shop Problem

    return model;
}

const string usage = "Usage: dotnet run --project openshop.csproj -- [OPTIONS] INPUT_FILE [INPUT_FILE2] ..";
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
