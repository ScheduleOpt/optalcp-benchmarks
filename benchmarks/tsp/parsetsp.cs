// Parser for TSPLIB format files (.tsp, .vrp).
// Supports TSP (Traveling Salesman Problem) and CVRP (Capacitated Vehicle Routing Problem).

using System.IO.Compression;

namespace Benchmarks.Tsp;

internal sealed class ParseParameters
{
    public bool CheckDirectionSymmetry { get; init; }
    public bool CheckTriangularInequality { get; init; }
    public int VisitDuration { get; init; }
    public bool ForceCeil { get; init; }
}

internal sealed class ParseResult
{
    public required string Type { get; init; }
    public required int NbNodes { get; init; }
    public required int[][] TransitionMatrix { get; init; }
    public required bool HasDirectionSymmetry { get; init; }
    // For CVRP:
    public int[]? Demands { get; init; }
    public int? Capacity { get; init; }
    public int[]? Depots { get; init; }
}

internal static class ParseTsp
{
    private static string ReadFile(string filename)
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

    // The GEO algorithm from the TSPLIB spec uses a truncated value of pi (not Math.PI);
    // keeping it as a literal preserves bit-exact parity with the JS/Python reference ports.
    private static double ToRadians(double x)
    {
        double degrees = Math.Truncate(x);
        double minutes = x - degrees;
        const double pi = 3.141592;
        return pi * (degrees + 5.0 * minutes / 3.0) / 180.0;
    }

    public static ParseResult Parse(string filename, ParseParameters? parameters = null)
    {
        parameters ??= new ParseParameters();
        bool checkDirectionSymmetry = parameters.CheckDirectionSymmetry;
        bool checkTriangularInequality = parameters.CheckTriangularInequality;
        int visitDuration = parameters.VisitDuration;
        bool forceCeil = parameters.ForceCeil;

        var lines = ReadFile(filename).Trim().Split('\n');
        int pos = 0;
        int nbNodes = -1;
        string edgeWeightType = "";
        string type = "UNKNOWN";
        int? capacity = null;
        string edgeWeightFormat = "FUNCTION";
        var transitionMatrix = new List<int[]>();
        int[]? demands = null;
        int[]? depots = null;

        while (pos < lines.Length)
        {
            var line = lines[pos];
            var trimmed = line.Trim();

            if (trimmed.StartsWith("NAME", StringComparison.Ordinal))
            {
                pos++;
                continue;
            }
            if (trimmed.StartsWith("TYPE", StringComparison.Ordinal))
            {
                type = line.Split(':')[1].Trim();
                pos++;
                continue;
            }
            if (trimmed.StartsWith("COMMENT", StringComparison.Ordinal))
            {
                pos++;
                continue;
            }
            if (trimmed.StartsWith("DIMENSION", StringComparison.Ordinal))
            {
                nbNodes = int.Parse(line.Split(':')[1].Trim());
                pos++;
                continue;
            }
            if (trimmed.StartsWith("DISPLAY_DATA_TYPE", StringComparison.Ordinal))
            {
                pos++;
                continue;
            }
            if (trimmed.StartsWith("DISTANCE", StringComparison.Ordinal))
            {
                pos++;
                continue;
            }
            if (trimmed.StartsWith("EDGE_WEIGHT_TYPE", StringComparison.Ordinal))
            {
                edgeWeightType = line.Split(':')[1].Trim();
                if (edgeWeightType is not ("GEO" or "EUC_2D" or "CEIL_2D" or "ATT" or "EXPLICIT"))
                {
                    Console.Error.WriteLine($"Unsupported edge weight type (not implemented): \"{edgeWeightType}\"");
                    Environment.Exit(1);
                }
                if (forceCeil && edgeWeightType == "EUC_2D")
                    edgeWeightType = "CEIL_2D";
                pos++;
                continue;
            }
            if (trimmed.StartsWith("EDGE_WEIGHT_FORMAT", StringComparison.Ordinal))
            {
                edgeWeightFormat = line.Split(':')[1].Trim();
                pos++;
                continue;
            }
            if (trimmed.StartsWith("CAPACITY", StringComparison.Ordinal))
            {
                capacity = int.Parse(line.Split(':')[1].Trim());
                pos++;
                continue;
            }

            if (trimmed == "NODE_COORD_SECTION")
            {
                pos++;
                if (edgeWeightType is not ("GEO" or "EUC_2D" or "CEIL_2D" or "ATT"))
                    throw new InvalidDataException("Unsupported edge weight type");
                if (edgeWeightFormat != "FUNCTION")
                    throw new InvalidDataException("Unsupported combination of edge weight type and format");

                var nodes = new (double X, double Y)[nbNodes];
                for (int i = 0; i < nbNodes; i++)
                {
                    var coord = lines[pos++].Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
                        .Select(s => double.Parse(s, System.Globalization.CultureInfo.InvariantCulture)).ToArray();
                    if (coord.Length != 3)
                        throw new InvalidDataException("Invalid input file format (node data)");
                    if ((int)coord[0] != i + 1)
                        throw new InvalidDataException("Invalid input file format (node number)");
                    nodes[i] = (coord[1], coord[2]);
                }

                for (int i = 0; i < nbNodes; i++)
                {
                    var row = new int[nbNodes];
                    if (edgeWeightType == "EUC_2D")
                    {
                        for (int j = 0; j < nbNodes; j++)
                        {
                            double distX = nodes[i].X - nodes[j].X;
                            double distY = nodes[i].Y - nodes[j].Y;
                            row[j] = (int)Math.Round(Math.Sqrt(distX * distX + distY * distY), MidpointRounding.AwayFromZero);
                        }
                    }
                    else if (edgeWeightType == "CEIL_2D")
                    {
                        for (int j = 0; j < nbNodes; j++)
                        {
                            double distX = nodes[i].X - nodes[j].X;
                            double distY = nodes[i].Y - nodes[j].Y;
                            row[j] = (int)Math.Ceiling(Math.Sqrt(distX * distX + distY * distY));
                        }
                    }
                    else if (edgeWeightType == "ATT")
                    {
                        for (int j = 0; j < nbNodes; j++)
                        {
                            double distX = nodes[i].X - nodes[j].X;
                            double distY = nodes[i].Y - nodes[j].Y;
                            double dist = Math.Sqrt((distX * distX + distY * distY) / 10.0);
                            row[j] = (int)Math.Ceiling(dist);
                        }
                    }
                    else
                    {
                        // GEO
                        for (int j = 0; j < nbNodes; j++)
                        {
                            double latitudeI = ToRadians(nodes[i].X);
                            double longitudeI = ToRadians(nodes[i].Y);
                            double latitudeJ = ToRadians(nodes[j].X);
                            double longitudeJ = ToRadians(nodes[j].Y);
                            double q1 = Math.Cos(longitudeI - longitudeJ);
                            double q2 = Math.Cos(latitudeI - latitudeJ);
                            double q3 = Math.Cos(latitudeI + latitudeJ);
                            double dist = 6378.388 * Math.Acos(0.5 * ((1.0 + q1) * q2 - (1.0 - q1) * q3)) + 1.0;
                            row[j] = forceCeil ? (int)Math.Ceiling(dist) : (int)Math.Floor(dist);
                        }
                    }
                    transitionMatrix.Add(row);
                }
                continue;
            }

            if (trimmed == "EDGE_WEIGHT_SECTION")
            {
                pos++;
                if (edgeWeightType == "EXPLICIT")
                {
                    if (edgeWeightFormat == "FULL_MATRIX")
                    {
                        for (int i = 0; i < nbNodes; i++)
                        {
                            var edgeData = lines[pos++].Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
                                .Select(int.Parse).ToArray();
                            if (edgeData.Length != nbNodes)
                                throw new InvalidDataException("Invalid input file matrix dimension format (edge data)");
                            transitionMatrix.Add(edgeData);
                        }
                    }
                    else if (edgeWeightFormat == "UPPER_ROW")
                    {
                        var rows = new List<int[]>();
                        for (int i = 0; i < nbNodes - 1; i++)
                        {
                            var edgeData = lines[pos++].Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
                                .Select(int.Parse).ToArray();
                            int expected = nbNodes - i - 1;
                            if (edgeData.Length != expected)
                                throw new InvalidDataException($"Invalid UPPER_ROW matrix. Expected {expected} values, got {edgeData.Length}");
                            rows.Add(edgeData);
                        }
                        rows.Add(Array.Empty<int>());
                        for (int i = 0; i < nbNodes; i++)
                        {
                            var row = new int[nbNodes];
                            for (int j = 0; j < i; j++)
                                row[j] = transitionMatrix[j][i];
                            row[i] = 0;
                            for (int k = 0; k < rows[i].Length; k++)
                                row[i + 1 + k] = rows[i][k];
                            transitionMatrix.Add(row);
                        }
                    }
                    else
                    {
                        Console.Error.WriteLine($"Unsupported edge weight format \"{edgeWeightFormat}\".");
                        Environment.Exit(1);
                    }
                }
                continue;
            }

            if (trimmed == "DEMAND_SECTION")
            {
                pos++;
                demands = new int[nbNodes];
                for (int i = 0; i < nbNodes; i++)
                {
                    var parts = lines[pos++].Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
                        .Select(int.Parse).ToArray();
                    if (parts.Length != 2)
                        throw new InvalidDataException("Invalid input file format (node data)");
                    if (parts[0] != i + 1)
                        throw new InvalidDataException("Invalid input file format (node number)");
                    demands[i] = parts[1];
                }
                continue;
            }

            if (trimmed == "DEPOT_SECTION")
            {
                pos++;
                var depotList = new List<int>();
                while (pos < lines.Length)
                {
                    int depot = int.Parse(lines[pos++].Trim());
                    if (depot == -1)
                        break;
                    depotList.Add(depot - 1);
                }
                depots = depotList.ToArray();
                continue;
            }

            if (trimmed == "DISPLAY_DATA_SECTION")
            {
                pos++;
                for (int i = 0; i < nbNodes; i++)
                {
                    var parts = lines[pos++].Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
                    if (int.Parse(parts[0]) != i + 1)
                        throw new InvalidDataException("Invalid input file format (node number)");
                }
                continue;
            }

            if (trimmed == "EOF")
                break;

            Console.Error.WriteLine($"Unrecognized line: \"{trimmed}\"");
            Environment.Exit(1);
        }

        // Validate that depots have zero demand
        if (demands != null && depots != null)
        {
            foreach (var d in depots)
                if (demands[d] != 0)
                    throw new InvalidDataException("Depot with non-zero demand");
        }

        // Check if the distance matrix is symmetric (i.e., dist(i,j) == dist(j,i))
        bool hasDirectionSymmetry = true;
        for (int i = 0; i < nbNodes && hasDirectionSymmetry; i++)
        {
            for (int j = 0; j < nbNodes; j++)
            {
                if (transitionMatrix[i][j] != transitionMatrix[j][i])
                {
                    if (checkDirectionSymmetry)
                    {
                        Console.Error.WriteLine($"{filename}: Direction symmetry violated: {i} -> {j}: {transitionMatrix[i][j]}, {j} -> {i}: {transitionMatrix[j][i]} (EDGE_WEIGHT_TYPE: {edgeWeightType})");
                        hasDirectionSymmetry = false;
                        break;
                    }
                    hasDirectionSymmetry = false;
                    break;
                }
            }
        }

        // Check triangular inequality: dist(i,j) <= dist(i,k) + dist(k,j)
        if (checkTriangularInequality)
        {
            bool done = false;
            for (int i = 0; i < nbNodes && !done; i++)
            {
                for (int k = 0; k < nbNodes && !done; k++)
                {
                    int ttIK = transitionMatrix[i][k];
                    for (int j = 0; j < nbNodes; j++)
                    {
                        if (transitionMatrix[i][j] > ttIK + visitDuration + transitionMatrix[k][j])
                        {
                            Console.Error.WriteLine($"{filename}: Triangular inequality violated: {i} -> {k} -> {j}: {transitionMatrix[i][j]} > {transitionMatrix[i][k]} + {visitDuration} + {transitionMatrix[k][j]} (EDGE_WEIGHT_TYPE: {edgeWeightType})");
                            done = true;
                            break;
                        }
                    }
                }
            }
        }

        return new ParseResult
        {
            Type = type,
            NbNodes = nbNodes,
            TransitionMatrix = transitionMatrix.ToArray(),
            Demands = demands,
            Capacity = capacity,
            Depots = depots,
            HasDirectionSymmetry = hasDirectionSymmetry,
        };
    }
}
