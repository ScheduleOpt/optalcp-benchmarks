#!/usr/bin/env python3
"""
Open Shop Scheduling: schedule n jobs on m machines where each job has one
operation per machine. Operations of a job can run in any order but cannot
overlap. Minimize makespan.
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
    """Define the open shop scheduling model."""
    data = iter(read_file_as_number_array(filename))
    model = cp.Model(name=make_model_name("openshop", filename))

    nb_jobs = next(data)
    nb_machines = next(data)

    # For each machine create an array of operations executed on it:
    machines: list[list[cp.IntervalVar]] = [[] for _ in range(nb_machines)]

    # Similarly for each job create an array of its operations:
    jobs: list[list[cp.IntervalVar]] = [[] for _ in range(nb_jobs)]

    # End times of all operations:
    ends: list[cp.IntExpr] = []

    # Longest operation (for symmetry breaking):
    longest: cp.IntervalVar | None = None
    max_length = 0

    for j in range(nb_jobs):
        for m in range(nb_machines):
            # Create a new operation:
            duration = next(data)
            operation = model.interval_var(length=duration, name=f"J{j + 1}M{m + 1}")
            machines[m].append(operation)
            jobs[j].append(operation)
            ends.append(operation.end())
            if max_length < duration:
                max_length = duration
                longest = operation

    # Tasks on each machine cannot overlap:
    for m in range(nb_machines):
        model.no_overlap(machines[m])
    # Similarly operations of a job cannot overlap:
    for j in range(nb_jobs):
        model.no_overlap(jobs[j])

    # Minimize the makespan:
    makespan = model.max(ends)
    model.minimize(makespan)

    # Break symmetry.
    # The symmetry is that the backward schedule is a valid solution. So force
    # the longest variable in the first half of the makespan.
    if longest is not None:
        model.enforce((makespan - longest.length()) // 2 >= longest.start())
    # For discussion about symmetry breaking see the following paper:
    # Malapert, Cambazard, Guéret, Jussien, Langevin, Rousseau:
    #   An Optimal Constraint Programming Approach to the Open-Shop Problem

    return model


def main() -> None:
    usage = "Usage: python openshop.py [OPTIONS] INPUT_FILE [INPUT_FILE2] .."
    params, input_files = cp.parse_known_parameters(usage=usage)

    if not input_files:
        print(usage, file=sys.stderr)
        print("Use --help for available options.", file=sys.stderr)
        sys.exit(1)

    for filename in input_files:
        define_model(filename).solve(params)


if __name__ == "__main__":
    main()
