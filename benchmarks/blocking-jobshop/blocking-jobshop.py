#!/usr/bin/env python3
"""
Blocking job shop: a job blocks its machine until the next machine becomes available.
Modeled by allowing operations (except the last in each job) to have variable duration.
"""

import gzip
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


def define_model(filename: str) -> cp.Model:
    """Define the blocking job shop model."""
    data = iter(read_file_as_number_array(filename))
    model = cp.Model(name=make_model_name("blocking-jobshop", filename))

    nb_jobs = next(data)
    nb_machines = next(data)

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
            # Variable duration models waiting (blocking) on the machine;
            # last operation doesn't block:
            max_duration = cp.IntervalMax if j < nb_machines - 1 else duration
            operation = model.interval_var(
                length=(duration, max_duration),
                name=f"J{i + 1}O{j + 1}M{machine_id + 1}",
            )
            # Add operation to its machine:
            machines[machine_id].append(operation)
            # Chain to previous operation:
            if prev is not None:
                prev.end_at_start(operation)
            prev = operation
        # End time of the job is end time of the last operation:
        assert prev is not None
        ends.append(prev.end())

    # Tasks on each machine cannot overlap:
    for j in range(nb_machines):
        model.no_overlap(machines[j])

    # Minimize the makespan:
    makespan = model.max(ends)
    model.minimize(makespan)

    return model


def main() -> None:
    # Parse parameters and collect unknown arguments (input files)
    usage = "Usage: python blocking-jobshop.py [OPTIONS] INPUT_FILE [INPUT_FILE2] .."
    params, input_files = cp.parse_known_parameters(usage=usage)

    if not input_files:
        print(usage, file=sys.stderr)
        print("Use --help for available options.", file=sys.stderr)
        sys.exit(1)

    for filename in input_files:
        define_model(filename).solve(params)


if __name__ == "__main__":
    main()
