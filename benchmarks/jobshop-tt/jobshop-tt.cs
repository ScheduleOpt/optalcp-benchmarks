// Job Shop Scheduling with sequence-dependent transition times: jobs consist of
// operations that must be processed on specific machines in order. Transition
// times between operations on the same machine depend on the operation sequence.

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

// Xorshift32 PRNG for reproducible random numbers. Uses uint to match the 32-bit
// unsigned semantics of the JS and Python reference implementations.
uint randomState = 1;
double NextRandom()
{
    randomState ^= randomState << 13;
    randomState ^= randomState >> 17;
    randomState ^= randomState << 5;
    return (double)randomState / 0xFFFFFFFFu;
}

int maxTT = 20; // Maximum transition time (controls random point spread)

Model DefineModel(string filename)
{
    var input = ReadFileAsNumberArray(filename);
    var model = new Model(MakeModelName("jobshop-tt", filename));
    int idx = 0;
    int nbJobs = input[idx++];
    int nbMachines = input[idx++];

    // Seed the PRNG from instance data for reproducibility. Match JS semantics:
    // JS coerces to 32-bit signed int on bitwise ops, so wrap the sum into 32 bits.
    long seedSum = 0;
    foreach (int v in input) seedSum += v;
    randomState = (uint)(seedSum & 0xFFFFFFFFL);
    if (randomState == 0) randomState = 1;

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
            if (machineId >= nbMachines)
                throw new InvalidDataException($"Invalid machine ID {machineId} (only {nbMachines} machines)");
            var operation = model.IntervalVar(
                length: duration,
                name: $"J{i + 1}O{j + 1}M{machineId + 1}");
            machines[machineId].Add(operation);
            if (prev != null)
                prev.EndBeforeStart(operation);
            prev = operation;
        }
        ends.Add(prev!.End());
    }

    // Tasks on each machine cannot overlap:
    for (int j = 0; j < nbMachines; j++)
    {
        // Create transition times from random 2D points (Euclidean distances).
        // Use AwayFromZero to match JS Math.round (half-to-+inf) for non-negative inputs.
        var xs = new int[nbJobs];
        var ys = new int[nbJobs];
        for (int k = 0; k < nbJobs; k++)
        {
            xs[k] = (int)Math.Round(NextRandom() * maxTT, MidpointRounding.AwayFromZero);
            ys[k] = (int)Math.Round(NextRandom() * maxTT, MidpointRounding.AwayFromZero);
        }
        var matrix = new int[nbJobs][];
        for (int a = 0; a < nbJobs; a++)
        {
            matrix[a] = new int[nbJobs];
            for (int b = 0; b < nbJobs; b++)
            {
                double dx = xs[a] - xs[b];
                double dy = ys[a] - ys[b];
                matrix[a][b] = (int)Math.Round(Math.Sqrt(dx * dx + dy * dy), MidpointRounding.AwayFromZero);
            }
        }
        model.NoOverlap(model.SequenceVar(machines[j]), matrix);
    }

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
    "Usage: dotnet run --project jobshop-tt.csproj -- [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n" +
    "Jobshop-tt options:\n" +
    "  --maxTT <number>  Maximum transition time (default: 20)";
var (parameters, restArgs) = Parameters.ParseKnownParameters(args: args, usage: usage);

maxTT = GetIntOption("--maxTT", maxTT, restArgs);

if (restArgs.Count == 0)
{
    Console.Error.WriteLine(usage);
    Console.Error.WriteLine("Use --help for available options.");
    return 1;
}

foreach (var filename in restArgs)
    DefineModel(filename).Solve(parameters);

return 0;
