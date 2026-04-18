// Traveling Salesman Problem (TSP): find the shortest cycle visiting all nodes exactly once.

using System.Text.RegularExpressions;
using Benchmarks.Tsp;
using OptalCP;

// Command-line options (set from main):
bool checkDirectionSymmetry = false;
bool checkTriangularInequality = false;
int visitDuration = 0;
bool forceCeil = false;
bool breakDirectionSymmetry = false;

static string MakeModelName(string benchmarkName, string filename)
{
    var instance = filename.Replace('/', '_').Replace('\\', '_');
    instance = Regex.Replace(instance, @"^data_", "");
    instance = Regex.Replace(instance, @"\.gz$", "");
    instance = Regex.Replace(instance, @"\.json$", "");
    instance = Regex.Replace(instance, @"\....?$", "");
    return $"{benchmarkName}_{instance}";
}

Model DefineModel(string filename)
{
    var result = ParseTsp.Parse(filename, new ParseParameters
    {
        CheckDirectionSymmetry = checkDirectionSymmetry,
        CheckTriangularInequality = checkTriangularInequality,
        VisitDuration = visitDuration,
        ForceCeil = forceCeil,
    });
    int nbNodes = result.NbNodes;
    var transitionMatrix = result.TransitionMatrix;
    bool hasDirectionSymmetry = result.HasDirectionSymmetry;

    var model = new Model(MakeModelName("tsp", filename));

    // The times of the visits (named N_1, N_2, ... to match 1-based file numbering):
    var intervals = new IntervalVar[nbNodes];
    for (int i = 0; i < nbNodes; i++)
        intervals[i] = model.IntervalVar(length: visitDuration, name: $"N_{i + 1}");

    // We're looking for a cycle that visits all nodes exactly once. So we can
    // choose which node starts the cycle. Let's choose node 0 (N_1), fixed at time 0.
    intervals[0].StartMin = 0;
    intervals[0].StartMax = 0;

    // The `last` interval marks the return to node 0, handled separately from the sequence:
    var last = model.IntervalVar(length: 0, name: "last");

    // Remaining nodes (1..n-1) must be visited in a sequence with transition times.
    // Trim the matrix to exclude row/column 0 (handled separately for the starting node).
    var trimmedMatrix = new int[nbNodes - 1][];
    for (int i = 0; i < nbNodes - 1; i++)
    {
        trimmedMatrix[i] = new int[nbNodes - 1];
        for (int j = 0; j < nbNodes - 1; j++)
            trimmedMatrix[i][j] = transitionMatrix[i + 1][j + 1];
    }
    var tail = new IntervalVar[nbNodes - 1];
    Array.Copy(intervals, 1, tail, 0, nbNodes - 1);
    var sequence = model.SequenceVar(tail);
    model.NoOverlap(sequence, trimmedMatrix);

    for (int i = 1; i < nbNodes; i++)
    {
        // The first node is not part of the sequence, so we have to propagate
        // the transition matrix manually:
        intervals[0].EndBeforeStart(intervals[i], transitionMatrix[0][i]);
        // The last node must be after all the other nodes, taking into account
        // the transition matrix:
        intervals[i].EndBeforeStart(last, transitionMatrix[i][0]);
    }

    // Minimize total travel distance (subtract visit durations from total time):
    model.Minimize(last.End() - nbNodes * visitDuration);

    if (hasDirectionSymmetry && breakDirectionSymmetry && nbNodes > 2)
    {
        // If we reverse the order of the nodes, the solution will be the same. So,
        // we can break the symmetry by choosing any node and forcing it to be in
        // the first half of the cycle. Let's choose a node with the maximum
        // distance from node 0:
        int maxDistance = 0;
        int maxDistanceNode = 0;
        for (int i = 1; i < nbNodes; i++)
        {
            if (transitionMatrix[0][i] > maxDistance)
            {
                maxDistance = transitionMatrix[0][i];
                maxDistanceNode = i;
            }
        }
        model.Enforce(intervals[maxDistanceNode].End() * 2 <= last.End());
    }

    return model;
}

static bool GetBoolOption(string name, List<string> args)
{
    int idx = args.IndexOf(name);
    if (idx == -1)
        return false;
    args.RemoveAt(idx);
    return true;
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
    "Usage: dotnet run --project tsp.csproj -- [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n" +
    "TSP options:\n" +
    "  --checkTriangularInequality  Warn if triangular inequality is not respected\n" +
    "  --visitDuration <number>     Duration of each visit (the default is 0)\n" +
    "  --forceCeil                  Round up during distance computation\n" +
    "  --checkDirectionSymmetry     Warn if the distance matrix is not symmetrical\n" +
    "  --breakDirectionSymmetry     Break the direction symmetry of the solution";
var (parameters, restArgs) = Parameters.ParseKnownParameters(args: args, usage: usage);

checkTriangularInequality = GetBoolOption("--checkTriangularInequality", restArgs);
visitDuration = GetIntOption("--visitDuration", visitDuration, restArgs);
forceCeil = GetBoolOption("--forceCeil", restArgs);
checkDirectionSymmetry = GetBoolOption("--checkDirectionSymmetry", restArgs);
breakDirectionSymmetry = GetBoolOption("--breakDirectionSymmetry", restArgs);

if (restArgs.Count == 0)
{
    Console.Error.WriteLine(usage);
    Console.Error.WriteLine("Use --help for available options.");
    return 1;
}

foreach (var filename in restArgs)
    DefineModel(filename).Solve(parameters);

return 0;
