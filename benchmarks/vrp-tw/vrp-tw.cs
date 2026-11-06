// Vehicle Routing Problem with Time Windows: route capacitated vehicles from
// a depot to serve customers within their time windows.

using System.Globalization;
using System.IO.Compression;
using System.Text.RegularExpressions;
using OptalCP;

string rounding = "ceil";
string objectiveType = "makespan";
bool breakVehicleSymmetry = false;
double scaleFactor = 1.0;
const int bigM = 1_000_000;

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
    instance = Regex.Replace(instance, @"\....?.?$", "");
    return $"{benchmarkName}_{instance}";
}

static void VerifyExpectedLine(string[] lines, int pos, Regex expected)
{
    if (!expected.IsMatch(lines[pos].Trim()))
    {
        Console.Error.WriteLine($"Expected line {pos + 1} to match \"{expected}\", but got \"{lines[pos]}\"");
        Environment.Exit(1);
    }
}

Model DefineModel(string filename)
{
    var lines = ReadFile(filename).Trim().Split('\n');
    // lines[0] is name of the instance — we ignore it and make the name from the filename.
    VerifyExpectedLine(lines, 1, new Regex(@"^$"));
    VerifyExpectedLine(lines, 2, new Regex(@"^VEHICLE$"));
    VerifyExpectedLine(lines, 3, new Regex(@"^NUMBER\s+CAPACITY$"));
    var header = lines[4].Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
        .Select(int.Parse).ToArray();
    int nbVehicles = header[0];
    int capacity = header[1];
    VerifyExpectedLine(lines, 5, new Regex(@"^$"));
    VerifyExpectedLine(lines, 6, new Regex(@"^CUSTOMER$"));
    VerifyExpectedLine(lines, 7, new Regex(@"^CUST NO\.\s+XCOORD\.\s+YCOORD\.\s+DEMAND\s+READY TIME\s+DUE DATE\s+SERVICE\s+TIME$"));
    VerifyExpectedLine(lines, 8, new Regex(@"^$"));

    var nodes = new List<Node>();
    // Due date is the maximum start time, not maximum end time — some nodes have
    // `ready + serviceTime > due`, and we preserve that semantics.
    for (int i = 9; i < lines.Length; i++)
    {
        var parts = lines[i].Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
            .Select(s => double.Parse(s, CultureInfo.InvariantCulture)).ToArray();
        int customerNumber = (int)parts[0];
        if (customerNumber != i - 9)
        {
            Console.Error.WriteLine($"Line {i + 1}: Expected customer number {i - 9}, but got {customerNumber}");
            Environment.Exit(1);
        }
        nodes.Add(new Node
        {
            X = parts[1] * scaleFactor,
            Y = parts[2] * scaleFactor,
            Demand = (int)parts[3],
            Ready = parts[4] * scaleFactor,
            Due = parts[5] * scaleFactor,
            ServiceTime = parts[6] * scaleFactor,
        });
    }

    // Node 0 is the depot:
    if (nodes[0].Demand != 0) throw new InvalidDataException("Depot demand must be 0");
    if (nodes[0].Ready != 0) throw new InvalidDataException("Depot ready must be 0");
    for (int i = 1; i < nodes.Count; i++)
    {
        if (nodes[i].Demand <= 0) throw new InvalidDataException("Customer demand must be positive");
        // ServiceTime must be > 0, otherwise triangular inequality may fail.
        if (nodes[i].ServiceTime <= 0) throw new InvalidDataException("Customer service time must be positive");
    }

    int nbNodes = nodes.Count;
    Func<double, int> roundFunc = rounding == "round"
        ? d => (int)Math.Round(d, MidpointRounding.AwayFromZero)
        : d => (int)Math.Ceiling(d);

    // The depot will not be part of noOverlap. Therefore node 0 is not part of the matrix.
    var customerMatrix = new int[nbNodes - 1][];
    for (int i = 1; i < nbNodes; i++)
    {
        var row = new int[nbNodes - 1];
        for (int j = 1; j < nbNodes; j++)
        {
            double xdist = nodes[i].X - nodes[j].X;
            double ydist = nodes[i].Y - nodes[j].Y;
            row[j - 1] = roundFunc(Math.Sqrt(xdist * xdist + ydist * ydist));
        }
        customerMatrix[i - 1] = row;
    }
    var depotDistances = new int[nbNodes - 1];
    for (int i = 1; i < nbNodes; i++)
    {
        double xdist = nodes[0].X - nodes[i].X;
        double ydist = nodes[0].Y - nodes[i].Y;
        depotDistances[i - 1] = roundFunc(Math.Sqrt(xdist * xdist + ydist * ydist));
    }

    var model = new Model(MakeModelName("vrp-tw", filename));
    int nbCustomers = nbNodes - 1;
    var customerNodes = nodes.GetRange(1, nbCustomers);

    var visits = new List<IntervalVar>[nbCustomers];
    for (int i = 0; i < nbCustomers; i++)
        visits[i] = new List<IntervalVar>();
    var endTimes = new List<IntExpr>();
    var vehicleLoad = new List<IntExpr>();
    var maxServed = new List<IntExpr>();
    var vehicleUsed = new List<IntExpr>();

    for (int v = 0; v < nbVehicles; v++)
    {
        var myVisits = new IntervalVar[nbCustomers];
        for (int i = 0; i < nbCustomers; i++)
        {
            var node = customerNodes[i];
            // Start must be inside the time window and no earlier than
            // depotDistances[i] (minimum time to reach customer if it is first).
            int startLower = Math.Max(depotDistances[i], (int)node.Ready);
            int startUpper = (int)node.Due;
            int endLower = startLower + (int)node.ServiceTime;
            int endUpper = startUpper + (int)node.ServiceTime;
            myVisits[i] = model.IntervalVar(
                name: $"V_{v + 1}_{i + 1}",
                optional: true,
                length: (int)node.ServiceTime,
                start: (startLower, startUpper),
                end: (endLower, endUpper));
        }

        if (objectiveType == "traveltime")
        {
            // Allow the visit to cover waiting time: extend startMin back to
            // depotDistances[i] and lengthMax up to Model.LengthMax.
            for (int i = 0; i < nbCustomers; i++)
            {
                myVisits[i].StartMin = depotDistances[i];
                myVisits[i].LengthMax = Model.LengthMax;
            }
        }

        for (int i = 0; i < nbCustomers; i++)
            visits[i].Add(myVisits[i]);

        model.NoOverlap(myVisits, customerMatrix);

        var last = model.IntervalVar(length: 0, name: $"last_{v + 1}");
        for (int i = 0; i < nbCustomers; i++)
            myVisits[i].EndBeforeStart(last, depotDistances[i]);
        endTimes.Add(last.End());

        vehicleUsed.Add(model.Max(myVisits.Select(v => v.Presence())));

        var used = model.Sum(myVisits.Select((v, i) => v.Presence() * customerNodes[i].Demand));
        model.Enforce(used <= capacity);
        vehicleLoad.Add(used);

        maxServed.Add(model.Max(myVisits.Select((v, i) => v.Presence() * (i + 1))));
    }

    for (int i = 0; i < nbCustomers; i++)
    {
        model.Enforce(model.Sum(visits[i].Select(iv => iv.Presence())) == 1);
    }

    int totalDemand = customerNodes.Sum(n => n.Demand);
    model.Enforce(model.Sum(vehicleLoad) == totalDemand);

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

    if (objectiveType == "makespan")
        model.Minimize(model.Max(endTimes));
    else if (objectiveType == "totaltime")
        model.Minimize(model.Sum(endTimes));
    else if (objectiveType == "nbvehicles")
        model.Minimize(model.Sum(vehicleUsed));
    else if (objectiveType == "path")
    {
        int totalServiceTime = customerNodes.Sum(n => (int)n.ServiceTime);
        var objective = model.Sum(endTimes) - totalServiceTime;
        model.Enforce(objective >= 0);
        model.Minimize(objective);
    }
    else
    {
        // traveltime or nbvehicles,traveltime: subtract visit durations
        // (taking max over alternatives for tighter propagation).
        var visitDurations = visits
            .Select(alts => model.Max(alts.Select(iv => iv.Length())))
            .ToArray();
        IntExpr objective = model.Sum(endTimes) - model.Sum(visitDurations);
        if (objectiveType == "nbvehicles,traveltime")
            objective = model.Sum(vehicleUsed) * bigM + objective;
        model.Enforce(objective >= 0);
        model.Minimize(objective);
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

static string GetStringOption(string name, string defaultValue, List<string> args)
{
    int idx = args.IndexOf(name);
    if (idx == -1)
        return defaultValue;
    if (idx + 1 == args.Count)
    {
        Console.Error.WriteLine($"Missing value for option {name}");
        Environment.Exit(1);
    }
    string value = args[idx + 1];
    args.RemoveRange(idx, 2);
    return value;
}

static double GetFloatOption(string name, double defaultValue, List<string> args)
{
    int idx = args.IndexOf(name);
    if (idx == -1)
        return defaultValue;
    if (idx + 1 == args.Count)
    {
        Console.Error.WriteLine($"Missing value for option {name}");
        Environment.Exit(1);
    }
    double value = double.Parse(args[idx + 1], CultureInfo.InvariantCulture);
    args.RemoveRange(idx, 2);
    return value;
}

const string usage =
    "Usage: dotnet run --project vrp-tw.csproj -- [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n" +
    "VRP-TW options:\n" +
    "  --objective <objective type>   The type of the objective function (default: makespan)\n" +
    "  --scale <number>               Scale the time by a constant factor (default: 1)\n" +
    "  --breakVehicleSymmetry         Order vehicles by the maximum city visited (default: false)\n" +
    "  --rounding <round|ceil>        How to round the distances (default: ceil)\n\n" +
    "Objective types are:\n" +
    "  * makespan: the time the last vehicle returns to the depot\n" +
    "  * traveltime: the total time spent traveling (without waiting and without service times)\n" +
    "  * totaltime: the total time of all vehicles (with traveling, waiting and service times)\n" +
    "  * path: the time not spent at customers (i.e., the total traveling and waiting time)\n" +
    "  * nbvehicles: the minimum number of vehicles used\n" +
    "  * nbvehicles,traveltime: 1000000*nbvehicles + traveltime";
var (parameters, restArgs) = Parameters.ParseKnownParameters(args: args, usage: usage);

objectiveType = GetStringOption("--objective", objectiveType, restArgs);
if (Array.IndexOf(new[] { "path", "traveltime", "totaltime", "makespan", "nbvehicles", "nbvehicles,traveltime" }, objectiveType) == -1)
{
    Console.Error.WriteLine("Invalid value for --objective.");
    return 1;
}
scaleFactor = GetFloatOption("--scale", scaleFactor, restArgs);
breakVehicleSymmetry = GetBoolOption("--breakVehicleSymmetry", restArgs);
rounding = GetStringOption("--rounding", rounding, restArgs);
if (rounding != "round" && rounding != "ceil")
{
    Console.Error.WriteLine("Invalid value for --rounding. Must be 'round' or 'ceil'");
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

internal sealed record Node
{
    public double X { get; init; }
    public double Y { get; init; }
    public int Demand { get; init; }
    public double Ready { get; init; }
    public double Due { get; init; }
    public double ServiceTime { get; init; }
}
