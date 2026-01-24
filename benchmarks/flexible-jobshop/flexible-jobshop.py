#!/usr/bin/env python3
"""
Flexible Job Shop Scheduling Problem (FJSSP):
Each job consists of a sequence of operations that must be processed in order.
Each operation can be processed on one of several machines (flexibility).
Objective: minimize the makespan (completion time of all jobs).
"""

import gzip
import re
import sys
from pathlib import Path

import optalcp as cp


def read_file(filename: str) -> str:
    """Read a file, handling .gz decompression."""
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


redundant_cumul = False


def define_model(filename: str) -> cp.Model:
    """Define the flexible job shop model."""
    # Parse input file: first line has nbJobs and nbMachines, rest is job data
    input_text = read_file(filename)
    first_eol = input_text.index("\n")
    first_line = [float(x) for x in input_text[:first_eol].strip().split()]
    data = iter([int(x) for x in input_text[first_eol + 1 :].strip().split()])

    model = cp.Model(name=make_model_name("flexible-jobshop", filename))
    nb_jobs = int(first_line[0])
    nb_machines = int(first_line[1])

    # Operations assigned to each machine (for no-overlap constraints):
    machines: list[list[cp.IntervalVar]] = [[] for _ in range(nb_machines)]

    # End times of each job (for makespan calculation):
    ends: list[cp.IntExpr] = []

    # For --redundantCumul: cumulative pulses across all machines
    all_machines: list[cp.CumulExpr] = []

    for i in range(nb_jobs):
        nb_operations = next(data)
        prev: cp.IntervalVar | None = None
        for j in range(nb_operations):
            # Create operation (master interval for alternative constraint):
            operation = model.interval_var(name=f"J{i + 1}O{j + 1}")
            # Create one optional mode for each machine that can process this operation:
            nb_modes = next(data)
            modes: list[cp.IntervalVar] = []
            for _ in range(nb_modes):
                machine_id = next(data)
                duration = next(data)
                mode = model.interval_var(
                    length=duration,
                    optional=True,
                    name=f"J{i + 1}O{j + 1}_M{machine_id}",
                )
                machines[machine_id - 1].append(mode)  # machines are 1-indexed in input
                modes.append(mode)
            # Exactly one mode must be selected:
            model.alternative(operation, modes)
            # Operations within a job must be sequenced:
            if prev is not None:
                prev.end_before_start(operation)
            prev = operation
            if redundant_cumul:
                all_machines.append(operation.pulse(1))
        assert prev is not None
        ends.append(prev.end())

    # No-overlap: each machine processes one operation at a time
    for m in range(nb_machines):
        model.no_overlap(machines[m])

    # Redundant cumulative: at most nbMachines operations simultaneously
    if redundant_cumul:
        model.enforce(model.sum(all_machines) <= nb_machines)

    # Minimize makespan (completion time of all jobs):
    model.minimize(model.max(ends))

    # Verify all input data was consumed:
    remaining = list(data)
    assert len(remaining) == 0, f"Unexpected data at end: {remaining}"

    return model


def main() -> None:
    usage = (
        "Usage: python flexible-jobshop.py [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n"
        "Flexible JobShop options:\n"
        "  --redundantCumul    Add a redundant cumul constraint"
    )
    params, rest_args = cp.parse_known_parameters(usage=usage)

    # Filter out custom arguments
    global redundant_cumul
    input_files: list[str] = []
    for arg in rest_args:
        if arg == "--redundantCumul":
            redundant_cumul = True
        else:
            input_files.append(arg)

    if not input_files:
        print(usage, file=sys.stderr)
        print("Use --help for available options.", file=sys.stderr)
        sys.exit(1)

    for filename in input_files:
        define_model(filename).solve(params)


if __name__ == "__main__":
    main()
