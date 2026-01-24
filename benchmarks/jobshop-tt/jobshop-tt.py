#!/usr/bin/env python3
"""
Job Shop Scheduling with sequence-dependent transition times: jobs consist of
operations that must be processed on specific machines in order. Transition
times between operations on the same machine depend on the operation sequence.
"""

import gzip
import math
import re
import sys
from pathlib import Path

import optalcp as cp


def read_file_as_number_array(filename: str) -> list[int]:
    """Read a file and parse whitespace-separated numbers."""
    path = Path(filename)
    if filename.endswith(".gz"):
        with gzip.open(path, "rt") as f:
            content = f.read()
    else:
        content = path.read_text()
    return [int(x) for x in content.strip().split()]


def make_model_name(benchmark_name: str, filename: str) -> str:
    """Generate model identifier from benchmark name and filename."""
    instance = re.sub(r"[/\\]", "_", filename)
    instance = re.sub(r"^data_", "", instance)
    instance = re.sub(r"\.gz$", "", instance)
    instance = re.sub(r"\.json$", "", instance)
    instance = re.sub(r"\...?$", "", instance)
    return f"{benchmark_name}_{instance}"


# Xorshift32 PRNG for reproducible random numbers:
random_state = 1


def random() -> float:
    """Generate a random number in [0, 1) using xorshift32."""
    global random_state
    random_state ^= (random_state << 13) & 0xFFFFFFFF
    random_state ^= random_state >> 17
    random_state ^= (random_state << 5) & 0xFFFFFFFF
    return (random_state & 0xFFFFFFFF) / 0xFFFFFFFF


# Command-line option:
max_tt = 20  # Maximum transition time (controls random point spread)


def define_model(filename: str) -> cp.Model:
    """Define the job shop with transition times model."""
    global random_state

    input_data = read_file_as_number_array(filename)
    data = iter(input_data)
    model = cp.Model(name=make_model_name("jobshop-tt", filename))

    nb_jobs = next(data)
    nb_machines = next(data)

    # Seed the PRNG from instance data for reproducibility:
    random_state = sum(input_data) or 1

    # For each machine create an array of operations executed on it:
    machines: list[list[cp.IntervalVar]] = [[] for _ in range(nb_machines)]

    # End times of each job:
    ends: list[cp.IntExpr] = []

    for i in range(nb_jobs):
        # Previous task in the job:
        prev: cp.IntervalVar | None = None
        for j in range(nb_machines):
            machine_id = next(data)
            duration = next(data)
            if machine_id >= nb_machines:
                raise ValueError(
                    f"Invalid machine ID {machine_id} (only {nb_machines} machines)"
                )
            operation = model.interval_var(
                length=duration,
                name=f"J{i + 1}O{j + 1}M{machine_id + 1}",
            )
            # Operation requires some machine:
            machines[machine_id].append(operation)
            # Operation has a predecessor:
            if prev is not None:
                prev.end_before_start(operation)
            prev = operation
        # End time of the job is end time of the last operation:
        assert prev is not None
        ends.append(prev.end())

    # Tasks on each machine cannot overlap:
    for j in range(nb_machines):
        # Create transition times from random 2D points (Euclidean distances):
        points = [
            {"x": round(random() * max_tt), "y": round(random() * max_tt)}
            for _ in range(nb_jobs)
        ]
        matrix = [
            [round(math.hypot(p1["x"] - p2["x"], p1["y"] - p2["y"])) for p2 in points]
            for p1 in points
        ]
        model.no_overlap(model.sequence_var(machines[j]), matrix)

    # Minimize the makespan:
    makespan = model.max(ends)
    model.minimize(makespan)

    return model


def get_int_option(name: str, default: int, args: list[str]) -> int:
    """Parse an integer option from args list, removing it if found."""
    if name in args:
        idx = args.index(name)
        value = int(args[idx + 1])
        del args[idx : idx + 2]
        return value
    return default


def main() -> None:
    global max_tt

    usage = (
        "Usage: python jobshop-tt.py [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n"
        "Jobshop-tt options:\n"
        "  --maxTT <number>  Maximum transition time (default: 20)"
    )
    params, input_files = cp.parse_known_parameters(usage=usage)

    # Parse custom options from remaining args:
    max_tt = get_int_option("--maxTT", max_tt, input_files)

    if not input_files:
        print(usage, file=sys.stderr)
        print("Use --help for available options.", file=sys.stderr)
        sys.exit(1)

    for filename in input_files:
        define_model(filename).solve(params)


if __name__ == "__main__":
    main()
