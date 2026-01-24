#!/usr/bin/env python3
"""
Vehicle Routing Problem with Time Windows: route capacitated vehicles from
a depot to serve customers within their time windows.
"""

import argparse
import gzip
import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import optalcp as cp


def read_file(filename: str) -> str:
    """Read a file, handling gzip compression."""
    path = Path(filename)
    if filename.endswith(".gz"):
        with gzip.open(path, "rt") as f:
            return f.read()
    return path.read_text()


def make_model_name(benchmark_name: str, filename: str) -> str:
    """Generate model identifier from benchmark name and filename."""
    instance = re.sub(r"[/\\]", "_", filename)
    instance = re.sub(r"^data_", "", instance)
    instance = re.sub(r"\.gz$", "", instance)
    instance = re.sub(r"\.json$", "", instance)
    instance = re.sub(r"\...?$", "", instance)
    return f"{benchmark_name}_{instance}"


@dataclass
class Node:
    """A node in the VRP-TW problem (depot or customer)."""

    x: float
    y: float
    demand: int
    ready: float  # Minimum start time
    due: float  # Maximum start time
    service_time: float  # Duration


# Command line options (module-level for access in define_model):
rounding = "ceil"
objective_type = "makespan"
break_vehicle_symmetry = False
scale_factor = 1.0
BIG_M = 1_000_000


def verify_expected_line(lines: list[str], pos: int, expected: re.Pattern[str]) -> None:
    """Verify that a line matches the expected pattern."""
    if not expected.match(lines[pos].strip()):
        print(
            f'Expected line {pos + 1} to match "{expected.pattern}", '
            f'but got "{lines[pos]}"',
            file=sys.stderr,
        )
        sys.exit(1)


def define_model(filename: str) -> cp.Model:
    """Define the VRP-TW model."""
    lines = read_file(filename).strip().split("\n")
    # lines[0] is name of the instance. We ignore it and make the name from the filename
    # lines[1] is an empty line, and then comes column names
    verify_expected_line(lines, 1, re.compile(r"^$"))
    verify_expected_line(lines, 2, re.compile(r"^VEHICLE$"))
    verify_expected_line(lines, 3, re.compile(r"^NUMBER\s+CAPACITY$"))
    parts = lines[4].strip().split()
    nb_vehicles = int(parts[0])
    capacity = int(parts[1])
    verify_expected_line(lines, 5, re.compile(r"^$"))
    # Then comes the customer data
    verify_expected_line(lines, 6, re.compile(r"^CUSTOMER$"))
    verify_expected_line(
        lines,
        7,
        re.compile(
            r"^CUST NO\.\s+XCOORD\.\s+YCOORD\.\s+DEMAND\s+"
            r"READY TIME\s+DUE DATE\s+SERVICE\s+TIME$"
        ),
    )
    verify_expected_line(lines, 8, re.compile(r"^$"))

    nodes: list[Node] = []
    # Note that due date is the maximum start time, not maximum end time.
    # Because in the data, there are nodes with: ready + serviceTime > due.

    for i in range(9, len(lines)):
        parts = lines[i].strip().split()
        customer_number = int(parts[0])
        x = float(parts[1])
        y = float(parts[2])
        demand = int(parts[3])
        ready = float(parts[4])
        due = float(parts[5])
        service_time = float(parts[6])

        if customer_number != i - 9:
            print(
                f"Line {i + 1}: Expected customer number {i - 9}, "
                f"but got {customer_number}",
                file=sys.stderr,
            )
            sys.exit(1)

        nodes.append(
            Node(
                x=x * scale_factor,
                y=y * scale_factor,
                demand=demand,
                ready=ready * scale_factor,
                due=due * scale_factor,
                service_time=service_time * scale_factor,
            )
        )

    # Node 0 is the depot:
    assert nodes[0].demand == 0
    assert nodes[0].ready == 0
    for i in range(1, len(nodes)):
        assert nodes[i].demand > 0
        # Otherwise, we may have a problem with triangular inequality:
        assert nodes[i].service_time > 0

    # Compute transition matrix
    # The depot will not be part of noOverlap. It is known to be first and last
    # and so it will be handled separately. Therefore node 0 is not part of the matrix:
    nb_nodes = len(nodes)
    round_func = round if rounding == "round" else math.ceil
    customer_matrix: list[list[int]] = []
    for i in range(1, nb_nodes):
        row: list[int] = []
        for j in range(1, nb_nodes):
            xdist = nodes[i].x - nodes[j].x
            ydist = nodes[i].y - nodes[j].y
            dist = math.sqrt(xdist * xdist + ydist * ydist)
            row.append(round_func(dist))
        customer_matrix.append(row)

    # For the depot, we need distances to all the customers:
    depot_distances: list[int] = []
    for i in range(1, nb_nodes):
        xdist = nodes[0].x - nodes[i].x
        ydist = nodes[0].y - nodes[i].y
        dist = math.sqrt(xdist * xdist + ydist * ydist)
        depot_distances.append(round_func(dist))

    model = cp.Model(name=make_model_name("vrp-tw", filename))
    nb_customers = nb_nodes - 1
    # From now on, we will index the customers from 0.
    # But in the variable names, we will index them from 1 (because node 0 in the
    # input file is the depot).
    customer_nodes = nodes[1:]

    # For each customer, we have an array of potential visits by the vehicles:
    visits: list[list[cp.IntervalVar]] = [[] for _ in range(nb_customers)]
    # For each vehicle, the time of the last visit:
    end_times: list[cp.IntExpr] = []
    # Load of each vehicle (how much capacity is used):
    vehicle_load: list[cp.IntExpr] = []
    # For each vehicle, we compute the max index of a customer served.
    # Used only for symmetry-breaking.
    max_served: list[cp.IntExpr] = []
    # Whether given vehicle is used or not:
    vehicle_used: list[cp.IntExpr] = []

    for v in range(nb_vehicles):
        # Visits done by the vehicle v:
        my_visits: list[cp.IntervalVar] = []
        for i, node in enumerate(customer_nodes):
            # The start time must be within the time window. But it cannot be
            # before depot_distances[i], which is the minimum time necessary to get
            # there (if it is the very first customer).
            start_min = max(depot_distances[i], int(node.ready))
            start_max = int(node.due)
            # The range for the end time can also be computed from the time window
            # and the visit duration.
            # It is necessary only for objective_type === "traveltime"
            end_min = start_min + int(node.service_time)
            end_max = start_max + int(node.service_time)

            visit = model.interval_var(
                name=f"V_{v + 1}_{i + 1}",
                optional=True,
                length=int(node.service_time),
                start=(start_min, start_max),
                end=(end_min, end_max),
            )
            my_visits.append(visit)

        if objective_type == "traveltime":
            for i in range(nb_customers):
                # Extend the visit so that it also covers potential waiting time for the
                # time window. I.e., the visit can start sooner and can be longer.
                # Length min, startMax, endMin and endMax remain the same.
                my_visits[i].start_min = depot_distances[i]
                my_visits[i].length_max = cp.LengthMax
                assert my_visits[i].length_min == int(customer_nodes[i].service_time)

        # Add my_visits to the visits array:
        for i in range(nb_customers):
            visits[i].append(my_visits[i])

        model.no_overlap(my_visits, customer_matrix)

        # Constraints for the depot:
        last = model.interval_var(length=0, name=f"last_{v + 1}")
        for i in range(nb_customers):
            # The return to depot must be after all the other visits and respect
            # the transition matrix:
            my_visits[i].end_before_start(last, depot_distances[i])
        end_times.append(last.end())

        vehicle_used.append(model.max([itv.presence() for itv in my_visits]))

        # Capacity of the vehicle cannot be exceeded:
        used = model.sum(
            [
                itv.presence() * customer_nodes[i].demand
                for i, itv in enumerate(my_visits)
            ]
        )
        model.enforce(used <= capacity)
        vehicle_load.append(used)

        # Compute the max index of a served customer as:
        #    max_i { (i+1) * myVisits[i].presence() }
        # There is +1 to distinguish between serving no customer (value 0) and
        # serving just the customer with index 0 (value 1).
        max_served_customer = model.max(
            [itv.presence() * (i + 1) for i, itv in enumerate(my_visits)]
        )
        max_served.append(max_served_customer)

    for i in range(nb_customers):
        # Every customer must be visited exactly once:
        #    sum_j visits[i][j] == 1
        # We don't need alternative constraint.
        model.enforce(model.sum([vis.presence() for vis in visits[i]]) == 1)

    # All the demands must be satisfied by some vehicle. Therefore the sum of
    # their usage must be equal to the total demand. It is a redundant
    # constraint. It allows the solver to see a problem when some vehicles are
    # underused and there is no way to satisfy the remaining demands by the
    # remaining vehicles.
    total_demand = sum(node.demand for node in customer_nodes)
    model.enforce(model.sum(vehicle_load) == total_demand)

    if break_vehicle_symmetry:
        # The values of the max_served variables must be increasing with the vehicle
        # number. In case two vehicles are not used at all, i.e., both max_served
        # are 0, there is max2(1) on the right side.
        for c in range(1, nb_vehicles):
            model.enforce(max_served[c - 1] <= model.max([max_served[c], 1]))
        # Customer with the biggest index must be served by the last vehicle.
        # Customer with the second biggest index must be served by the last or the
        # second last vehicle. etc.
        for i in range(nb_customers - 1, nb_customers - nb_vehicles, -1):
            # How many possible vehicles can serve this customer:
            nb_possible_vehicles = nb_customers - i
            nb_forbidden_vehicles = nb_vehicles - nb_possible_vehicles
            for v in range(nb_forbidden_vehicles):
                visits[i][v].optional = None

    if objective_type == "makespan":
        model.minimize(model.max(end_times))
    elif objective_type == "totaltime":
        model.minimize(model.sum(end_times))
    elif objective_type == "nbvehicles":
        model.minimize(model.sum(vehicle_used))
    elif objective_type == "path":
        total_service_time = sum(int(node.service_time) for node in customer_nodes)
        objective = model.sum(end_times) - total_service_time
        model.enforce(objective >= 0)
        model.minimize(objective)
    else:
        assert objective_type in ("traveltime", "nbvehicles,traveltime")
        # Compute how much time we spent on the visits (including the waiting time).
        # To get a bit more propagation, for each visit compute the max length over
        # its alternatives (different vehicles).
        visit_durations: list[cp.IntExpr] = []
        for i in range(nb_customers):
            visit_durations.append(model.max([visit.length() for visit in visits[i]]))
        objective = model.sum(end_times) - model.sum(visit_durations)
        if objective_type == "nbvehicles,traveltime":
            # The objective is BIG_M * nbVehicles + total travel time
            objective = model.sum(vehicle_used) * BIG_M + objective
        model.enforce(objective >= 0)
        model.minimize(objective)

    return model


def main() -> None:
    global rounding, objective_type, break_vehicle_symmetry, scale_factor

    usage = "Usage: python vrp-tw.py [OPTIONS] INPUT_FILE [INPUT_FILE2] .."
    params, rest_args = cp.parse_known_parameters(usage=usage)

    # Parse custom arguments
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--objective", default="makespan")
    parser.add_argument("--scale", type=float, default=1.0)
    parser.add_argument("--breakVehicleSymmetry", action="store_true")
    parser.add_argument("--rounding", default="ceil")
    args, input_files = parser.parse_known_args(rest_args)

    objective_type = args.objective
    if objective_type not in (
        "path",
        "traveltime",
        "totaltime",
        "makespan",
        "nbvehicles",
        "nbvehicles,traveltime",
    ):
        print("Invalid value for --objective.", file=sys.stderr)
        sys.exit(1)

    scale_factor = args.scale
    break_vehicle_symmetry = args.breakVehicleSymmetry
    rounding = args.rounding
    if rounding not in ("round", "ceil"):
        print("Invalid value for --rounding. Must be 'round' or 'ceil'", file=sys.stderr)
        sys.exit(1)

    if not input_files:
        print(usage, file=sys.stderr)
        print(
            "\nVRP-TW options:\n"
            "  --objective <type>       The type of the objective function "
            "(default: makespan)\n"
            "  --scale <number>         Scale the time by a constant factor "
            "(default: 1)\n"
            "  --breakVehicleSymmetry   Order vehicles by the maximum city visited "
            "(default: false)\n"
            "  --rounding <round|ceil>  How to round the distances (default: ceil)\n"
            "\n"
            "Objective types are:\n"
            "  * makespan: the time the last vehicle returns to the depot\n"
            "  * traveltime: the total time spent traveling "
            "(without waiting and without service times)\n"
            "  * totaltime: the total time of all vehicles "
            "(with traveling, waiting and service times)\n"
            "  * path: the time not spent at customers "
            "(i.e., the total traveling and waiting time)\n"
            "  * nbvehicles: the minimum number of vehicles used\n"
            "  * nbvehicles,traveltime: 1000000*nbvehicles + traveltime\n"
            "\nUse --help for available solver options.",
            file=sys.stderr,
        )
        sys.exit(1)

    for filename in input_files:
        define_model(filename).solve(params)


if __name__ == "__main__":
    main()
