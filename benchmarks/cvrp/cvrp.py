#!/usr/bin/env python3
"""
Capacitated Vehicle Routing Problem (CVRP): a fleet of vehicles with limited
capacity must serve customers with known demands, minimizing total travel distance.
"""

import re
import sys
from pathlib import Path

import optalcp as cp

# Add parent directory to path to import from sibling packages
sys.path.insert(0, str(Path(__file__).parent.parent))
from tsp.parsetsp import ParseParameters, parse

# Global options (set from command line)
check_triangular_inequality = False
visit_duration = 0
force_ceil = False
check_direction_symmetry = False
break_direction_symmetry = False
break_vehicle_symmetry = False
forced_nb_vehicles = 0  # 0 means not forced
objective = "path"


def make_model_name(benchmark_name: str, filename: str) -> str:
    """Generate model identifier from benchmark name and filename."""
    instance = re.sub(r"[/\\]", "_", filename)
    instance = re.sub(r"^data_", "", instance)
    instance = re.sub(r"\.gz$", "", instance)
    instance = re.sub(r"\.json$", "", instance)
    instance = re.sub(r"\...?$", "", instance)
    return f"{benchmark_name}_{instance}"


def define_model(filename: str) -> cp.Model:
    """Define the CVRP model."""
    result = parse(
        filename,
        ParseParameters(
            check_triangular_inequality=check_triangular_inequality,
            visit_duration=visit_duration,
            force_ceil=force_ceil,
            check_direction_symmetry=check_direction_symmetry,
        ),
    )

    nb_nodes = result.nb_nodes
    transition_matrix = result.transition_matrix
    demands = result.demands
    capacity = result.capacity
    depots = result.depots
    has_direction_symmetry = result.has_direction_symmetry

    assert depots is not None, "Depots are not defined in the input file"
    assert capacity is not None, "Capacity is not defined in the input file"
    assert demands is not None, "Demands are not defined in the input file"

    # The data format supports multiple depots, but we don't have any such data files:
    assert len(depots) == 1, "Multiple depots are not supported yet"
    # In the symmetry breaking, we assume that the depot is the first node:
    assert depots[0] == 0, "Depot must be the first node"

    # Try to guess the number of vehicles from the filename name.
    # It may end by kNN.vrp(.gz) where NN is the number of vehicles.
    nb_vehicles = forced_nb_vehicles
    if nb_vehicles == 0:
        match = re.search(r"k(\d+)\.vrp(\.gz)?$", filename)
        if match is not None:
            nb_vehicles = int(match.group(1))
        else:
            print(
                "Number of vehicles is not defined on the command line "
                "and cannot be guessed from the filename",
                file=sys.stderr,
            )
            sys.exit(1)

    # Compute the maximum distance in the matrix:
    max_distance = max(transition_matrix[i][j] for i in range(nb_nodes) for j in range(nb_nodes))
    # The horizon doesn't seem to be needed. But let's use it anyway:
    horizon = max_distance * (nb_nodes + nb_vehicles)

    # The depot will not be part of noOverlap. It is known to be first and last
    # and so it will be handled separately. Therefore, for the noOverlap, we can
    # make the transition matrix smaller by one row and one column:
    customer_matrix = [row[1:] for row in transition_matrix[1:]]
    # From now on, we will index the customers from 0.
    # In the variable names, we index from 2 (because node 1 in the input file is the depot).
    nb_customers = nb_nodes - 1

    model = cp.Model(name=make_model_name("cvrp", filename))
    # For each customer, we have an array of potential visits by the vehicles:
    visits: list[list[cp.IntervalVar]] = [[] for _ in range(nb_customers)]
    # For each vehicle, the time of the last visit:
    end_times: list[cp.IntExpr] = []
    # For each vehicle, we compute the max index of a customer served.
    # Used only for symmetry-breaking.
    max_served: list[cp.IntExpr] = []
    # Usage of each vehicle (how much capacity is used):
    vehicle_usage: list[cp.IntExpr] = []

    for v in range(nb_vehicles):
        # Visits done by the vehicle v:
        my_visits = [
            model.interval_var(length=visit_duration, name=f"V_{v + 1}_{i + 2}", optional=True)
            for i in range(nb_customers)
        ]
        # Add my_visits to the visits array:
        for i in range(nb_customers):
            visits[i].append(my_visits[i])

        model.no_overlap(my_visits, customer_matrix)

        # Constraints for the depot:
        last = model.interval_var(length=0, name=f"last_{v + 1}", end=(0, horizon))
        for i in range(nb_customers):
            # We don't model the initial depot visit at all. It is known to be at time 0.
            # Instead, we increase start_min of all the visits by the transition matrix value:
            my_visits[i].start_min = transition_matrix[0][i + 1]
            # The return to depot must be after all visits and respect the transition matrix:
            my_visits[i].end_before_start(last, transition_matrix[i + 1][0])
        end_times.append(last.end())

        # Capacity of the vehicle cannot be exceeded:
        used = model.sum([my_visits[i].presence() * demands[i + 1] for i in range(nb_customers)])
        model.enforce(used <= capacity)
        vehicle_usage.append(used)

        # Compute the max index of a served customer as:
        #    max_i { (i+1) * my_visits[i].presence() }
        # There is +1 to distinguish between serving no customer (value 0) and
        # serving just the customer with index 0 (value 1).
        max_served_customer = model.max(
            [my_visits[i].presence() * (i + 1) for i in range(nb_customers)]
        )
        max_served.append(max_served_customer)

        if has_direction_symmetry and break_direction_symmetry:
            # Let's compute the time of the customer with the max index served:
            #   sum_i { my_visits[i].start() * (max_served_customer == i+1) }
            # Here we use boolean expression max_served_customer == i+1 as 0/1 integer expression.
            time_of_max_served_customer = model.sum(
                [my_visits[i].start() * (max_served_customer == i + 1) for i in range(nb_customers)]
            )
            # The route taken in the reverse order is also a solution.
            # So we may insist that the time of this visit is in the first half of the route:
            model.enforce(time_of_max_served_customer * 2 <= last.end())

    for i in range(nb_customers):
        # Every customer must be visited exactly once:
        #    sum_j visits[i][j] == 1
        # We don't need alternative constraint.
        model.enforce(model.sum([visits[i][v].presence() for v in range(nb_vehicles)]) == 1)

    # All the demands must be satisfied by some vehicle. Therefore the sum of
    # their usage must be equal to the total demand. It is a redundant
    # constraint. It allows the solver to see a problem when some vehicles are
    # underused and there is no way to satisfy the remaining demands by the
    # remaining vehicles.
    total_demand = sum(demands[1:])
    model.enforce(model.sum(vehicle_usage) == total_demand)

    if break_vehicle_symmetry:
        # The values of the max_served variables must be increasing with the vehicle number.
        # For the case the two vehicles are not used at all, i.e., both max_served
        # are 0, there is max2(1) on the right side.
        for c in range(1, nb_vehicles):
            model.enforce(max_served[c - 1] <= max_served[c].max2(1))
        # Customer with the biggest index must be served by the last vehicle.
        # Customer with 2nd biggest index must be served by the last or second last vehicle.
        # etc.
        for i in range(nb_customers - 1, nb_customers - nb_vehicles, -1):
            # How many possible vehicles can serve this customer:
            nb_possible_vehicles = nb_customers - i
            nb_forbidden_vehicles = nb_vehicles - nb_possible_vehicles
            for v in range(nb_forbidden_vehicles):
                visits[i][v].optional = None

    if objective == "makespan":
        model.minimize(model.max(end_times))
    else:
        assert objective == "path"
        model.minimize(model.sum(end_times) - nb_customers * visit_duration)

    return model


def get_bool_option(name: str, args: list[str]) -> bool:
    """Get a boolean option from args and remove it."""
    if name in args:
        args.remove(name)
        return True
    return False


def get_int_option(name: str, default_value: int, args: list[str]) -> int:
    """Get an integer option from args and remove it."""
    if name in args:
        index = args.index(name)
        value = int(args[index + 1])
        del args[index : index + 2]
        return value
    return default_value


def get_string_option(name: str, default_value: str, args: list[str]) -> str:
    """Get a string option from args and remove it."""
    if name in args:
        index = args.index(name)
        value = args[index + 1]
        del args[index : index + 2]
        return value
    return default_value


def main() -> None:
    global check_triangular_inequality, visit_duration, force_ceil
    global forced_nb_vehicles, check_direction_symmetry, break_direction_symmetry
    global break_vehicle_symmetry, objective

    usage = (
        "Usage: python cvrp.py [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n"
        "CVRP options:\n"
        "  --nbVehicles <number>       Number of vehicles\n"
        "  --objective <makespan|path> Objective function\n"
        "  --checkTriangularInequality Warn if triangular inequality is not respected\n"
        "  --visitDuration <number>    Duration of each visit (the default is 0)\n"
        "  --forceCeil                 Round up during distance computation\n"
        "  --checkDirectionSymmetry    Warn if the directions are not symmetrical\n"
        "  --breakDirectionSymmetry    Break the direction symmetry of the solution\n"
        "  --breakVehicleSymmetry      Order vehicles by the maximum city visited"
    )

    # Get rest args from sys.argv for custom parsing
    rest_args = sys.argv[1:]

    # Parse custom options first
    check_triangular_inequality = get_bool_option("--checkTriangularInequality", rest_args)
    visit_duration = get_int_option("--visitDuration", visit_duration, rest_args)
    force_ceil = get_bool_option("--forceCeil", rest_args)
    forced_nb_vehicles = get_int_option("--nbVehicles", forced_nb_vehicles, rest_args)
    check_direction_symmetry = get_bool_option("--checkDirectionSymmetry", rest_args)
    break_direction_symmetry = get_bool_option("--breakDirectionSymmetry", rest_args)
    break_vehicle_symmetry = get_bool_option("--breakVehicleSymmetry", rest_args)
    objective = get_string_option("--objective", objective, rest_args)

    if objective not in ["makespan", "path"]:
        print("Invalid value for --objective. Can only be 'makespan' or 'path'", file=sys.stderr)
        sys.exit(1)

    # Parse standard parameters and collect input files
    params, input_files = cp.parse_known_parameters(args=rest_args, usage=usage)

    if not input_files:
        print(usage, file=sys.stderr)
        print("Use --help for available options.", file=sys.stderr)
        sys.exit(1)

    for filename in input_files:
        define_model(filename).solve(params)


if __name__ == "__main__":
    main()
