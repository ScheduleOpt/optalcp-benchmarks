#!/usr/bin/env python3
"""
Distributed flowshop: jobs must be processed on machines in a fixed order (flow-shop),
and each job is assigned to exactly one of multiple factories.
Permutation variant: jobs are processed in the same order on all machines within a factory.
"""

import gzip
import re
import sys
from pathlib import Path

import optalcp as cp

# Command-line options:
# Use alternative() constraint with redundant cumulative (alternative modeling approach)
redundant_cumul = False
# Permutation variant: jobs must be processed in the same order on all machines within a factory
permutation = True
# Symmetry breaking: last job in last factory, factories ordered by max job number
symmetry_breaking = True


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
    """Define the distributed flowshop model."""
    data = iter(read_file_as_number_array(filename))
    model = cp.Model(name=make_model_name("distributed-flowshop", filename))

    nb_jobs = next(data)
    nb_machines = next(data)
    nb_factories = next(data)

    # Create interval variables for each job assigned to each factory.
    # operations[f][m][j] = operation of job j on machine m in factory f (optional)
    operations: list[list[list[cp.IntervalVar]]] = [
        [[] for _ in range(nb_machines)] for _ in range(nb_factories)
    ]
    # ends[j] = end time of job j (for makespan)
    ends: list[cp.IntExpr] = []
    # For symmetry breaking: job_numbers[f][j] = j if job j assigned to factory f, else 0
    job_numbers: list[list[cp.IntExpr]] = [[] for _ in range(nb_factories)]
    # For --redundantCumul: sum_machines[m] = cumulative pulses on machine m
    sum_machines: list[list[cp.CumulExpr]] = [[] for _ in range(nb_machines)]

    for j in range(nb_jobs):
        # Read processing times for this job
        lengths: list[int] = []
        for m in range(nb_machines):
            machine_idx = next(data)
            assert machine_idx == m
            lengths.append(next(data))

        # For --redundantCumul: main[m] = main interval for job j on machine m
        main: list[cp.IntervalVar] = []
        alternatives: list[list[cp.IntervalVar]] = []
        if redundant_cumul:
            for m in range(nb_machines):
                main.append(
                    model.interval_var(length=lengths[m], name=f"J{j + 1}M{m + 1}")
                )
                alternatives.append([])

        # Create operations for this job in each factory
        presences: list[cp.BoolExpr] = []
        for f in range(nb_factories):
            prev: cp.IntervalVar | None = None
            first: cp.IntervalVar | None = None

            for m in range(nb_machines):
                operation = model.interval_var(
                    optional=True,
                    length=lengths[m],
                    name=f"J{j + 1}F{f + 1}M{m + 1}",
                )
                if redundant_cumul:
                    alternatives[m].append(operation)
                operations[f][m].append(operation)

                if prev is not None:
                    # Flow-shop: previous machine must finish before next starts
                    prev.end_before_start(operation)
                    assert first is not None
                    # All operations of a job in a factory share the same presence
                    model.enforce(first.presence() == operation.presence())
                else:
                    first = operation
                prev = operation

            assert first is not None and prev is not None

            presences.append(first.presence())
            job_numbers[f].append(first.presence() * j)
            if not redundant_cumul:
                ends.append(prev.end())

            # Symmetry breaking: last job must be in last factory
            if symmetry_breaking and j == nb_jobs - 1 and f == nb_factories - 1:
                model.enforce(first.presence() == 1)

        if redundant_cumul:
            # Alternative: exactly one factory is chosen for each machine
            for m in range(nb_machines):
                model.alternative(main[m], alternatives[m])
                sum_machines[m].append(main[m].pulse(1))
            ends.append(main[nb_machines - 1].end())
        else:
            # Each job must be assigned to exactly one factory
            model.enforce(model.sum(presences) == 1)

    # Objective: minimize makespan
    model.minimize(model.max(ends))

    # No-overlap: each machine in each factory processes one job at a time
    machines: list[list[cp.SequenceVar]] = [[] for _ in range(nb_factories)]
    for f in range(nb_factories):
        for m in range(nb_machines):
            machines[f].append(model.sequence_var(operations[f][m]))
            model.no_overlap(machines[f][m])

    # Permutation: jobs processed in same order on all machines within a factory
    if permutation:
        for f in range(nb_factories):
            # Position variable for each job (same across all machines in this factory)
            positions: list[cp.IntExpr] = [
                model.int_var(optional=True, name=f"Position_F{f + 1}_J{j + 1}")
                for j in range(nb_jobs)
            ]
            for m in range(nb_machines):
                for j in range(nb_jobs):
                    model.enforce(
                        positions[j].identity(
                            operations[f][m][j].position(machines[f][m])
                        )
                    )

    # Redundant cumulative: at most nb_factories jobs on each machine simultaneously
    if redundant_cumul:
        for m in range(nb_machines):
            model.enforce(model.sum(sum_machines[m]) <= nb_factories)

    # Symmetry breaking: order factories by highest job number assigned
    if symmetry_breaking:
        max_job_in_f = [model.max(job_numbers[f]) for f in range(nb_factories)]
        for f in range(1, nb_factories - 1):
            model.enforce(max_job_in_f[f - 1] < max_job_in_f[f])

    return model


def main() -> None:
    global redundant_cumul, permutation, symmetry_breaking

    usage = (
        "Usage: python distributed-flowshop.py [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n"
        "Distributed flowshop options:\n"
        "  --redundantCumul      Use alternative() with redundant cumulative\n"
        "  --no-permutation      Disable permutation constraint\n"
        "  --no-symmetryBreaking Disable symmetry breaking constraints"
    )
    params, rest_args = cp.parse_known_parameters(usage=usage)

    input_files: list[str] = []
    for arg in rest_args:
        if arg == "--redundantCumul":
            redundant_cumul = True
        elif arg == "--no-permutation":
            permutation = False
        elif arg == "--no-symmetryBreaking":
            symmetry_breaking = False
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
