// Capacitated Vehicle Routing Problem (CVRP): a fleet of vehicles with limited
// capacity must serve customers with known demands, minimizing total travel distance.

using System.Text.RegularExpressions;
using Benchmarks.Tsp;
using OptalCP;

bool checkTriangularInequality = false;
int visitDuration = 0;
bool forceCeil = false;
bool checkDirectionSymmetry = false;
bool breakDirectionSymmetry = false;
bool breakVehicleSymmetry = false;
int forcedNbVehicles = 0;
string objective = "path";

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
        CheckTriangularInequality = checkTriangularInequality,
        VisitDuration = visitDuration,
        ForceCeil = forceCeil,
        CheckDirectionSymmetry = checkDirectionSymmetry,
    });

    int nbNodes = result.NbNodes;
    var transitionMatrix = result.TransitionMatrix;
    var demands = result.Demands ?? throw new InvalidDataException("Demands are not defined in the input file");
    int capacity = result.Capacity ?? throw new InvalidDataException("Capacity is not defined in the input file");
    var depots = result.Depots ?? throw new InvalidDataException("Depots are not defined in the input file");
    bool hasDirectionSymmetry = result.HasDirectionSymmetry;

    // The data format supports multiple depots, but we don't have any data files with multiple depots:
    if (depots.Length != 1)
        throw new InvalidDataException("Multiple depots are not supported yet");
    // In the symmetry breaking, we assume that the depot is the first node:
    if (depots[0] != 0)
        throw new InvalidDataException("Depot must be the first node");

    // Try to guess the number of vehicles from the filename name.
    // It may end by kNN.vrp(.gz) where NN is the number of vehicles.
    int nbVehicles = forcedNbVehicles;
    if (nbVehicles == 0)
    {
        var match = Regex.Match(filename, @"k(\d+)\.vrp(\.gz)?$");
        if (match.Success)
            nbVehicles = int.Parse(match.Groups[1].Value);
        else
        {
            Console.Error.WriteLine("Number of vehicles is not defined on the command line and cannot be guessed from the filename");
            Environment.Exit(1);
        }
    }

    int maxDistance = transitionMatrix.SelectMany(row => row).Max();
    // The horizon doesn't seem to be needed. But let's use it anyway:
    int horizon = maxDistance * (nbNodes + nbVehicles);

    // The depot will not be part of noOverlap. It is known to be first and last
    // and so it will be handled separately. Therefore, for the noOverlap, we can
    // make the transition matrix smaller by one row and one column:
    var customerMatrix = new int[nbNodes - 1][];
    for (int i = 0; i < nbNodes - 1; i++)
    {
        customerMatrix[i] = new int[nbNodes - 1];
        for (int j = 0; j < nbNodes - 1; j++)
            customerMatrix[i][j] = transitionMatrix[i + 1][j + 1];
    }
    int nbCustomers = nbNodes - 1;

    var model = new Model(MakeModelName("cvrp", filename));
    var visits = new List<IntervalVar>[nbCustomers];
    for (int i = 0; i < nbCustomers; i++)
        visits[i] = new List<IntervalVar>();
    var endTimes = new List<IntExpr>();
    var maxServed = new List<IntExpr>();
    var vehicleUsage = new List<IntExpr>();

    for (int v = 0; v < nbVehicles; v++)
    {
        var myVisits = new IntervalVar[nbCustomers];
        for (int i = 0; i < nbCustomers; i++)
            myVisits[i] = model.IntervalVar(length: visitDuration, name: $"V_{v + 1}_{i + 2}", optional: true);
        for (int i = 0; i < nbCustomers; i++)
            visits[i].Add(myVisits[i]);

        model.NoOverlap(myVisits, customerMatrix);

        var last = model.IntervalVar(length: 0, name: $"last_{v + 1}", end: (0, horizon));
        for (int i = 0; i < nbCustomers; i++)
        {
            // We don't model the initial depot visit at all. It is known to be at time 0.
            // Instead, we increase startMin of all the visits by the transition matrix value:
            myVisits[i].StartMin = transitionMatrix[0][i + 1];
            myVisits[i].EndBeforeStart(last, transitionMatrix[i + 1][0]);
        }
        endTimes.Add(last.End());

        // Capacity of the vehicle cannot be exceeded:
        var used = model.Sum(myVisits.Select((v, i) => v.Presence() * demands[i + 1]));
        model.Enforce(used <= capacity);
        vehicleUsage.Add(used);

        // Compute the max index of a served customer as:
        //    max_i { (i+1) * myVisits[i].presence() }
        // There is +1 to distinguish between serving no customer (value 0) and
        // serving just the customer with index 0 (value 1).
        var maxServedCustomer = model.Max(myVisits.Select((v, i) => v.Presence() * (i + 1)));
        maxServed.Add(maxServedCustomer);

        if (hasDirectionSymmetry && breakDirectionSymmetry)
        {
            // Let's compute the time of the customer with the max index served:
            //   sum_i { myVisits[i].start() * (maxServedCustomer == i+1) }
            var timeOfMax = model.Sum(myVisits.Select((v, i) => v.Start() * (maxServedCustomer == i + 1)));
            model.Enforce(timeOfMax * 2 <= last.End());
        }
    }

    for (int i = 0; i < nbCustomers; i++)
    {
        // Every customer must be visited exactly once:
        model.Enforce(model.Sum(visits[i].Select(iv => iv.Presence())) == 1);
    }

    // Redundant constraint: total demand served must equal total demand required.
    int totalDemand = demands.Skip(1).Sum();
    model.Enforce(model.Sum(vehicleUsage) == totalDemand);

    if (breakVehicleSymmetry)
    {
        for (int c = 1; c < nbVehicles; c++)
            model.Enforce(maxServed[c - 1] <= model.Max2(maxServed[c], 1));
        for (int i = nbCustomers - 1; i > nbCustomers - nbVehicles; i--)
        {
            int nbPossibleVehicles = nbCustomers - i;
            int nbForbiddenVehicles = nbVehicles - nbPossibleVehicles;
            for (int v = 0; v < nbForbiddenVehicles; v++)
                model.Enforce(!visits[i][v].Presence());
        }
    }

    if (objective == "makespan")
        model.Minimize(model.Max(endTimes));
    else
        model.Minimize(model.Sum(endTimes) - nbCustomers * visitDuration);

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

static string GetStringOption(string name, string defaultValue, List<string> args)
{
    int idx = args.IndexOf(name);
    if (idx == -1)
        return defaultValue;
    string value = args[idx + 1];
    args.RemoveRange(idx, 2);
    return value;
}

const string usage =
    "Usage: dotnet run --project cvrp.csproj -- [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n" +
    "CVRP options:\n" +
    "  --nbVehicles <number>       Number of vehicles\n" +
    "  --objective <makespan|path> Objective function\n" +
    "  --checkTriangularInequality Warn if triangular inequality is not respected\n" +
    "  --visitDuration <number>    Duration of each visit (the default is 0)\n" +
    "  --forceCeil                 Round up during distance computation\n" +
    "  --checkDirectionSymmetry    Warn if the directions are not symmetrical\n" +
    "  --breakDirectionSymmetry    Break the direction symmetry of the solution\n" +
    "  --breakVehicleSymmetry      Order vehicles by the maximum city visited";
var (parameters, restArgs) = Parameters.ParseKnownParameters(args: args, usage: usage);

checkTriangularInequality = GetBoolOption("--checkTriangularInequality", restArgs);
visitDuration = GetIntOption("--visitDuration", visitDuration, restArgs);
forceCeil = GetBoolOption("--forceCeil", restArgs);
forcedNbVehicles = GetIntOption("--nbVehicles", forcedNbVehicles, restArgs);
checkDirectionSymmetry = GetBoolOption("--checkDirectionSymmetry", restArgs);
breakDirectionSymmetry = GetBoolOption("--breakDirectionSymmetry", restArgs);
breakVehicleSymmetry = GetBoolOption("--breakVehicleSymmetry", restArgs);
objective = GetStringOption("--objective", objective, restArgs);

if (objective != "makespan" && objective != "path")
{
    Console.Error.WriteLine("Invalid value for --objective. Can only be 'makespan' or 'path'");
    return 1;
}

if (restArgs.Count == 0)
{
    Console.Error.WriteLine(usage);
    Console.Error.WriteLine("Use --help for available options.");
    return 1;
}

foreach (var filename in restArgs)
    DefineModel(filename).Solve(parameters);

return 0;
