#!/usr/bin/env python3
"""
Non-permutation Flowshop Scheduling Problem
============================================

The Flowshop Scheduling Problem (FSP) involves scheduling multiple jobs on
multiple machines. Each job consists of operations that must be processed
on machines in a fixed order (the same for all jobs). The goal is to
minimize the makespan: the total time to complete all jobs.

In "permutation flowshop", jobs must be processed in the same order on all
machines. In "non-permutation flowshop" (this problem), the order of jobs
can differ between machines, making it more flexible but harder to solve.

Model
-----

For each operation, we create an interval variable with a fixed length
(processing time). Two types of constraints are used:

  1. Precedence: Operations of the same job must be executed in order
     (job's operation on machine 1 before machine 2, etc.).
  2. No-overlap: Each machine can process only one operation at a time.

The objective is to minimize the maximum end time across all jobs.

Data formats
------------

This solver supports two input formats:

  1. Taillard format: Numbers are arranged by machine, then by job:
       nbJobs nbMachines
       J1M1 J2M1 J3M1 ...  (all jobs on machine 1)
       J1M2 J2M2 J3M2 ...  (all jobs on machine 2)
       ...

  2. OR-Library format: Each operation includes its machine ID (0-based):
       nbJobs nbMachines
       0 J1M1 1 J1M2 2 J1M3 ...  (job 1: machineId duration pairs)
       0 J2M1 1 J2M2 2 J2M3 ...  (job 2: machineId duration pairs)
       ...
     This format is shared with JobShop (flowshop is a special case where
     all jobs visit machines in the same order: 0, 1, 2, ...).

The solver auto-detects the format by checking if the third number is 0
(indicating OR-Library format with machine IDs).
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


def make_model_name(filename: str) -> str:
    """Generate model identifier from filename."""
    instance = re.sub(r"[/\\]", "_", filename)
    instance = re.sub(r"^data_", "", instance)
    instance = re.sub(r"\.gz$", "", instance)
    instance = re.sub(r"\.json$", "", instance)
    instance = re.sub(r"\...?$", "", instance)
    return f"non-permutation-flowshop_{instance}"


def read_taillard_format(model: cp.Model, data: list[int]) -> None:
    """Reads Taillard format (durations organized by machine)."""
    it = iter(data)
    nb_jobs = next(it)
    nb_machines = next(it)

    last: list[cp.IntervalVar] = []  # Previous operation of each job
    for j in range(nb_machines):
        machine: list[cp.IntervalVar] = []
        for i in range(nb_jobs):
            duration = next(it)
            operation = model.interval_var(length=duration, name=f"J{i + 1}M{j + 1}")
            machine.append(operation)
            # Precedence: operation must start after the previous operation of the same job:
            if i < len(last):
                last[i].end_before_start(operation)
                last[i] = operation
            else:
                last.append(operation)
        # No-overlap: only one job at a time on each machine:
        model.no_overlap(machine)

    # Objective: minimize the makespan (max end time over all jobs):
    ends = [op.end() for op in last]
    model.minimize(model.max(ends))


def read_or_library_format(model: cp.Model, data: list[int]) -> None:
    """Reads OR-Library format (with machine IDs in input)."""
    it = iter(data)
    nb_jobs = next(it)
    nb_machines = next(it)

    machines: list[list[cp.IntervalVar]] = [[] for _ in range(nb_machines)]
    ends: list[cp.IntExpr] = []

    for i in range(nb_jobs):
        prev: cp.IntervalVar | None = None
        for j in range(nb_machines):
            machine_id = next(it)
            duration = next(it)
            operation = model.interval_var(
                length=duration,
                name=f"J{i + 1}O{j + 1}M{machine_id + 1}",
            )
            machines[machine_id].append(operation)
            # Precedence: operation must start after the previous operation of the same job:
            if prev is not None:
                prev.end_before_start(operation)
            prev = operation
        assert prev is not None
        ends.append(prev.end())

    # No-overlap: only one job at a time on each machine:
    for j in range(nb_machines):
        model.no_overlap(machines[j])

    # Objective: minimize the makespan (max end time over all jobs):
    model.minimize(model.max(ends))


def define_model(filename: str) -> cp.Model:
    """Define the non-permutation flowshop model."""
    data = read_file_as_number_array(filename)
    model = cp.Model(name=make_model_name(filename))

    # Detect format: OR-Library format has machine ID (0) as the third number.
    is_or_library_format = data[2] == 0

    if is_or_library_format:
        read_or_library_format(model, data)
    else:
        read_taillard_format(model, data)

    return model


def main() -> None:
    usage = "Usage: python non-permutation-flowshop.py [OPTIONS] INPUT_FILE [INPUT_FILE2] .."
    params, input_files = cp.parse_known_parameters(usage=usage)

    if not input_files:
        print(usage, file=sys.stderr)
        print("Use --help for available options.", file=sys.stderr)
        sys.exit(1)

    for filename in input_files:
        define_model(filename).solve(params)


if __name__ == "__main__":
    main()
