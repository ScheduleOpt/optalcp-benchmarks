"""
Parser for TSPLIB format files (.tsp, .vrp).
Supports TSP (Traveling Salesman Problem) and CVRP (Capacitated Vehicle Routing Problem).
"""

import gzip
import math
import sys
from dataclasses import dataclass
from pathlib import Path


def read_file(filename: str) -> str:
    """Read a file, handling .gz decompression."""
    path = Path(filename)
    if filename.endswith(".gz"):
        with gzip.open(path, "rt") as f:
            return f.read()
    return path.read_text()


def to_radians(x: float) -> float:
    """Convert coordinates to radians for GEO distance."""
    degrees = math.trunc(x)
    minutes = x - degrees
    # Don't use math.pi here to match other implementations exactly
    pi = 3.141592
    return pi * (degrees + 5.0 * minutes / 3.0) / 180.0


@dataclass
class ParseResult:
    """Result of parsing a TSPLIB file."""

    type: str
    nb_nodes: int
    transition_matrix: list[list[int]]
    has_direction_symmetry: bool
    # For CVRP:
    demands: list[int] | None = None
    capacity: int | None = None
    depots: list[int] | None = None


@dataclass
class ParseParameters:
    """Parameters for parsing."""

    check_direction_symmetry: bool = False
    check_triangular_inequality: bool = False
    visit_duration: int = 0
    force_ceil: bool = False


def parse(filename: str, params: ParseParameters | None = None) -> ParseResult:
    """Parse a TSPLIB format file."""
    if params is None:
        params = ParseParameters()

    lines = read_file(filename).strip().split("\n")
    pos = 0
    nb_nodes = -1
    edge_weight_type = ""
    problem_type = "UNKNOWN"
    capacity: int | None = None
    edge_weight_format = "FUNCTION"
    transition_matrix: list[list[int]] = []
    demands: list[int] | None = None
    depots: list[int] | None = None

    check_direction_symmetry = params.check_direction_symmetry
    check_triangular_inequality = params.check_triangular_inequality
    visit_duration = params.visit_duration
    force_ceil = params.force_ceil

    while pos < len(lines):
        line = lines[pos].strip()

        if line.startswith("NAME"):
            pos += 1
            continue

        if line.startswith("TYPE"):
            problem_type = line.split(":")[1].strip()
            pos += 1
            continue

        if line.startswith("COMMENT"):
            pos += 1
            continue

        if line.startswith("DIMENSION"):
            nb_nodes = int(line.split(":")[1])
            pos += 1
            continue

        if line.startswith("DISPLAY_DATA_TYPE"):
            pos += 1
            continue

        if line.startswith("DISTANCE"):
            pos += 1
            continue

        if line.startswith("EDGE_WEIGHT_TYPE"):
            edge_weight_type = line.split(":")[1].strip()
            if edge_weight_type not in ["GEO", "EUC_2D", "CEIL_2D", "ATT", "EXPLICIT"]:
                print(
                    f'Unsupported edge weight type (not implemented): "{edge_weight_type}"',
                    file=sys.stderr,
                )
                sys.exit(1)
            if force_ceil and edge_weight_type == "EUC_2D":
                edge_weight_type = "CEIL_2D"
            pos += 1
            continue

        if line.startswith("EDGE_WEIGHT_FORMAT"):
            edge_weight_format = line.split(":")[1].strip()
            pos += 1
            continue

        if line.startswith("CAPACITY"):
            capacity = int(line.split(":")[1].strip())
            pos += 1
            continue

        if line == "NODE_COORD_SECTION":
            pos += 1
            assert edge_weight_type in [
                "GEO",
                "EUC_2D",
                "CEIL_2D",
                "ATT",
            ], "Unsupported edge weight type"
            assert (
                edge_weight_format == "FUNCTION"
            ), "Unsupported combination of edge weight type and format"

            nodes: list[tuple[float, float]] = []
            for i in range(nb_nodes):
                coord_data = [float(x) for x in lines[pos].split()]
                pos += 1
                assert len(coord_data) == 3, "Invalid input file format (node data)"
                assert int(coord_data[0]) == i + 1, "Invalid input file format (node number)"
                nodes.append((coord_data[1], coord_data[2]))

            # Compute transition matrix
            for i in range(nb_nodes):
                row: list[int] = []
                if edge_weight_type == "EUC_2D":
                    # Euclidean distance, rounded to nearest integer
                    for j in range(nb_nodes):
                        dist_x = nodes[i][0] - nodes[j][0]
                        dist_y = nodes[i][1] - nodes[j][1]
                        row.append(round(math.sqrt(dist_x * dist_x + dist_y * dist_y)))
                elif edge_weight_type == "CEIL_2D":
                    # Euclidean distance, rounded up
                    for j in range(nb_nodes):
                        dist_x = nodes[i][0] - nodes[j][0]
                        dist_y = nodes[i][1] - nodes[j][1]
                        row.append(math.ceil(math.sqrt(dist_x * dist_x + dist_y * dist_y)))
                elif edge_weight_type == "ATT":
                    # Pseudo-Euclidean distance
                    for j in range(nb_nodes):
                        dist_x = nodes[i][0] - nodes[j][0]
                        dist_y = nodes[i][1] - nodes[j][1]
                        dist = math.sqrt((dist_x * dist_x + dist_y * dist_y) / 10.0)
                        row.append(math.ceil(dist))
                else:
                    # GEO - geographical distance
                    for j in range(nb_nodes):
                        latitude_i = to_radians(nodes[i][0])
                        longitude_i = to_radians(nodes[i][1])
                        latitude_j = to_radians(nodes[j][0])
                        longitude_j = to_radians(nodes[j][1])
                        q1 = math.cos(longitude_i - longitude_j)
                        q2 = math.cos(latitude_i - latitude_j)
                        q3 = math.cos(latitude_i + latitude_j)
                        dist = 6378.388 * math.acos(0.5 * ((1.0 + q1) * q2 - (1.0 - q1) * q3)) + 1.0
                        row.append(math.ceil(dist) if force_ceil else math.floor(dist))
                transition_matrix.append(row)
            continue

        # Explicit distance matrix
        if line == "EDGE_WEIGHT_SECTION":
            pos += 1
            if edge_weight_type == "EXPLICIT":
                if edge_weight_format == "FULL_MATRIX":
                    for _ in range(nb_nodes):
                        edge_data = [int(x) for x in lines[pos].split()]
                        pos += 1
                        assert (
                            len(edge_data) == nb_nodes
                        ), "Invalid input file matrix dimension format (edge data)"
                        transition_matrix.append(edge_data)
                elif edge_weight_format == "UPPER_ROW":
                    rows: list[list[int]] = []
                    for i in range(nb_nodes - 1):
                        upper_row_data = [int(x) for x in lines[pos].split()]
                        pos += 1
                        expected = nb_nodes - i - 1
                        assert (
                            len(upper_row_data) == expected
                        ), f"Invalid UPPER_ROW matrix. Expected {expected}, got {len(upper_row_data)}"
                        rows.append(upper_row_data)
                    rows.append([])
                    for i in range(nb_nodes):
                        row = []
                        for j in range(i):
                            row.append(transition_matrix[j][i])
                        row.append(0)
                        row.extend(rows[i])
                        transition_matrix.append(row)
                else:
                    print(f'Unsupported edge weight format "{edge_weight_format}"', file=sys.stderr)
                    sys.exit(1)
            continue

        # CVRP: customer demands
        if line == "DEMAND_SECTION":
            pos += 1
            demands = []
            for i in range(nb_nodes):
                demand_data = [int(x) for x in lines[pos].split()]
                pos += 1
                assert len(demand_data) == 2, "Invalid input file format (node data)"
                assert demand_data[0] == i + 1, "Invalid input file format (node number)"
                demands.append(demand_data[1])
            continue

        # CVRP: depot locations
        if line == "DEPOT_SECTION":
            pos += 1
            depots = []
            while pos < len(lines):
                depot = int(lines[pos])
                pos += 1
                if depot == -1:
                    break
                depots.append(depot - 1)  # Convert to 0-based index
            continue

        if line == "DISPLAY_DATA_SECTION":
            pos += 1
            for i in range(nb_nodes):
                display_data = lines[pos].split()
                pos += 1
                assert int(display_data[0]) == i + 1, "Invalid input file format (node number)"
            continue

        if line == "EOF":
            break

        print(f'Unrecognized line: "{line}"', file=sys.stderr)
        sys.exit(1)

    # Validate that depots have zero demand
    if demands is not None and depots is not None:
        for d in depots:
            assert demands[d] == 0, "Depot with non-zero demand"

    # Check if the distance matrix is symmetric
    has_direction_symmetry = True
    for i in range(nb_nodes):
        for j in range(nb_nodes):
            if transition_matrix[i][j] != transition_matrix[j][i]:
                if check_direction_symmetry:
                    print(
                        f"{filename}: Direction symmetry violated: {i} -> {j}: "
                        f"{transition_matrix[i][j]}, {j} -> {i}: {transition_matrix[j][i]} "
                        f"(EDGE_WEIGHT_TYPE: {edge_weight_type})",
                        file=sys.stderr,
                    )
                has_direction_symmetry = False
                break
        if not has_direction_symmetry:
            break

    # Check triangular inequality
    if check_triangular_inequality:
        done = False
        for i in range(nb_nodes):
            if done:
                break
            for k in range(nb_nodes):
                if done:
                    break
                tt_ik = transition_matrix[i][k]
                for j in range(nb_nodes):
                    if transition_matrix[i][j] > tt_ik + visit_duration + transition_matrix[k][j]:
                        print(
                            f"{filename}: Triangular inequality violated: {i} -> {k} -> {j}: "
                            f"{transition_matrix[i][j]} > {transition_matrix[i][k]} + "
                            f"{visit_duration} + {transition_matrix[k][j]} "
                            f"(EDGE_WEIGHT_TYPE: {edge_weight_type})",
                            file=sys.stderr,
                        )
                        done = True
                        break

    return ParseResult(
        type=problem_type,
        nb_nodes=nb_nodes,
        transition_matrix=transition_matrix,
        demands=demands,
        capacity=capacity,
        depots=depots,
        has_direction_symmetry=has_direction_symmetry,
    )
