#!/usr/bin/env python3
"""
Traveling Salesman Problem (TSP): find the shortest cycle visiting all nodes exactly once.
"""

import re
import sys

import optalcp as cp
from parsetsp import ParseParameters, parse


def make_model_name(benchmark_name: str, filename: str) -> str:
    """Generate model identifier from benchmark name and filename."""
    instance = re.sub(r"[/\\]", "_", filename)
    instance = re.sub(r"^data_", "", instance)
    instance = re.sub(r"\.gz$", "", instance)
    instance = re.sub(r"\.json$", "", instance)
    instance = re.sub(r"\...?$", "", instance)
    return f"{benchmark_name}_{instance}"


# Command-line options:
check_direction_symmetry = False
check_triangular_inequality = False
visit_duration = 0
force_ceil = False
break_direction_symmetry = False


def define_model(filename: str) -> cp.Model:
    """Define the TSP model."""
    result = parse(
        filename,
        ParseParameters(
            check_direction_symmetry=check_direction_symmetry,
            check_triangular_inequality=check_triangular_inequality,
            visit_duration=visit_duration,
            force_ceil=force_ceil,
        ),
    )
    nb_nodes = result.nb_nodes
    transition_matrix = result.transition_matrix
    has_direction_symmetry = result.has_direction_symmetry

    model = cp.Model(name=make_model_name("tsp", filename))

    # The times of the visits (named N_1, N_2, ... to match 1-based file numbering):
    intervals = [
        model.interval_var(length=visit_duration, name=f"N_{i + 1}") for i in range(nb_nodes)
    ]

    # We're looking for a cycle that visits all nodes exactly once. So we can
    # choose which node starts the cycle. Let's choose node 0 (N_1), fixed at time 0.
    intervals[0].start_min = 0
    intervals[0].start_max = 0

    # The `last` interval marks the return to node 0, handled separately from the sequence:
    last = model.interval_var(length=0, name="last")

    # Remaining nodes (1..n-1) must be visited in a sequence with transition times.
    # Trim the matrix to exclude row/column 0 (handled separately for the starting node).
    trimmed_matrix = [row[1:] for row in transition_matrix[1:]]
    sequence = model.sequence_var(intervals[1:])
    model.no_overlap(sequence, trimmed_matrix)

    for i in range(1, nb_nodes):
        # The first node is not part of the sequence, so we have to propagate
        # the transition matrix manually:
        intervals[0].end_before_start(intervals[i], transition_matrix[0][i])
        # The last node must be after all the other nodes, taking into account
        # the transition matrix:
        intervals[i].end_before_start(last, transition_matrix[i][0])

    # Minimize total travel distance (subtract visit durations from total time):
    model.minimize(last.end() - nb_nodes * visit_duration)

    if has_direction_symmetry and break_direction_symmetry and nb_nodes > 2:
        # If we reverse the order of the nodes, the solution will be the same. So,
        # we can break the symmetry by choosing any node and forcing it to be in
        # the first half of the cycle. Let's choose a node with the maximum
        # distance from node 0:
        max_distance = 0
        max_distance_node = 0
        for i in range(1, nb_nodes):
            if transition_matrix[0][i] > max_distance:
                max_distance = transition_matrix[0][i]
                max_distance_node = i
        model.enforce(intervals[max_distance_node].end() * 2 <= last.end())

    return model


def get_bool_option(name: str, args: list[str]) -> bool:
    """Extract a boolean option from args list."""
    if name in args:
        args.remove(name)
        return True
    return False


def get_int_option(name: str, default: int, args: list[str]) -> int:
    """Extract an integer option from args list."""
    if name in args:
        idx = args.index(name)
        value = int(args[idx + 1])
        del args[idx : idx + 2]
        return value
    return default


def main() -> None:
    global check_direction_symmetry, check_triangular_inequality
    global visit_duration, force_ceil, break_direction_symmetry

    usage = (
        "Usage: python tsp.py [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n"
        "TSP options:\n"
        "  --checkTriangularInequality  Warn if triangular inequality is not respected\n"
        "  --visitDuration <number>     Duration of each visit (the default is 0)\n"
        "  --forceCeil                  Round up during distance computation\n"
        "  --checkDirectionSymmetry     Warn if the distance matrix is not symmetrical\n"
        "  --breakDirectionSymmetry     Break the direction symmetry of the solution"
    )
    params, rest_args = cp.parse_known_parameters(usage=usage)

    # Look for the optional parameters:
    check_triangular_inequality = get_bool_option("--checkTriangularInequality", rest_args)
    visit_duration = get_int_option("--visitDuration", visit_duration, rest_args)
    force_ceil = get_bool_option("--forceCeil", rest_args)
    check_direction_symmetry = get_bool_option("--checkDirectionSymmetry", rest_args)
    break_direction_symmetry = get_bool_option("--breakDirectionSymmetry", rest_args)

    if not rest_args:
        print(usage, file=sys.stderr)
        print("Use --help for available options.", file=sys.stderr)
        sys.exit(1)

    for filename in rest_args:
        define_model(filename).solve(params)


if __name__ == "__main__":
    main()
