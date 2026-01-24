#!/usr/bin/env python3
"""
Flexible Job Shop Scheduling Problem with Worker Flexibility (FJSSP-W)

FJSSP-W extends the classical Flexible Job Shop Scheduling Problem by adding
worker flexibility constraints. Each job consists of a sequence of operations
that must be executed in order. Each operation can be processed on one of
several eligible machines, and additionally requires a worker to be present.
The processing time depends on both the machine and worker assignment.
The goal is to minimize the makespan (total completion time of all jobs).

Constraints:
  - Operations within a job must be executed sequentially (precedence)
  - Each machine can process at most one operation at a time (no overlap)
  - Each worker can work on at most one operation at a time (no overlap)
  - Each operation must be assigned to exactly one (machine, worker) pair

Reference: Hutter et al. "A Benchmarking Environment for Worker Flexibility
in Flexible Job Shop Scheduling Problems", arXiv:2501.16159, 2025.
"""

import gzip
import re
import sys
from pathlib import Path

import optalcp as cp

# Command-line options:
flat_alternatives = False
redundant_cumul = False
verbose = False


def read_file(filename: str) -> str:
    """Read a file, decompressing if .gz."""
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


def define_model(filename: str) -> cp.Model:
    """Define the FJSSP-W model."""
    input_text = read_file(filename)

    # Parse first line: <nbJobs> <nbMachines> <nbWorkers> [(avgMachinesPerOp)]
    first_eol = input_text.index("\n")
    first_line = re.sub(r"[()]", "", input_text[:first_eol]).split()
    rest = input_text[first_eol + 1 :].split()
    data = iter(int(x) for x in rest)

    model = cp.Model(name=make_model_name("flexible-jobshop-w", filename))
    nb_jobs = int(first_line[0])
    nb_machines = int(first_line[1])
    nb_workers = int(first_line[2])

    if verbose:
        print(f"FJSSP-W with {nb_machines} machines, {nb_jobs} jobs and {nb_workers} workers.")

    # For each machine/worker, an array of operations executed on it:
    machines: list[list[cp.IntervalVar]] = [[] for _ in range(nb_machines)]
    workers: list[list[cp.IntervalVar]] = [[] for _ in range(nb_workers)]

    # End times of each job:
    ends: list[cp.IntExpr] = []

    # For --redundantCumul: cumulative pulses across all operations
    all_operations: list[cp.CumulExpr] = []

    for i in range(nb_jobs):
        nb_operations = next(data)
        # Previous task in the job:
        prev: cp.IntervalVar | None = None
        for j in range(nb_operations):
            # Create a new operation (master of alternative constraint):
            operation = model.interval_var(name=f"J{i + 1}O{j + 1}")
            if redundant_cumul:
                all_operations.append(operation.pulse(1))
            nb_machine_choices = next(data)
            modes: list[cp.IntervalVar] = []
            variants_on_worker: list[list[cp.IntervalVar]] = [[] for _ in range(nb_workers)]
            variants_on_machine: list[list[cp.IntervalVar]] = [[] for _ in range(nb_machines)]

            for _ in range(nb_machine_choices):
                machine_id = next(data)
                nb_worker_choices = next(data)
                for _ in range(nb_worker_choices):
                    worker_id = next(data)
                    duration = next(data)
                    mode = model.interval_var(
                        length=duration,
                        optional=True,
                        name=f"J{i + 1}O{j + 1}_M{machine_id}W{worker_id}",
                    )
                    if flat_alternatives:
                        # In the input file machines are counted from 1, we count from 0.
                        machines[machine_id - 1].append(mode)
                        workers[worker_id - 1].append(mode)
                    else:
                        variants_on_machine[machine_id - 1].append(mode)
                        variants_on_worker[worker_id - 1].append(mode)
                    modes.append(mode)

            if flat_alternatives:
                model.alternative(operation, modes)
            else:
                operations_on_machine: list[cp.IntervalVar] = []
                for m in range(nb_machines):
                    if variants_on_machine[m]:
                        sub_operation = model.interval_var(
                            name=f"J{i + 1}O{j + 1}_M{m + 1}", optional=True
                        )
                        model.alternative(sub_operation, variants_on_machine[m])
                        operations_on_machine.append(sub_operation)
                        machines[m].append(sub_operation)
                model.alternative(operation, operations_on_machine)

                operations_on_worker: list[cp.IntervalVar] = []
                for w in range(nb_workers):
                    if variants_on_worker[w]:
                        sub_operation = model.interval_var(
                            name=f"J{i + 1}O{j + 1}_W{w + 1}", optional=True
                        )
                        model.alternative(sub_operation, variants_on_worker[w])
                        operations_on_worker.append(sub_operation)
                        workers[w].append(sub_operation)
                model.alternative(operation, operations_on_worker)

            # Operation has a predecessor:
            if prev is not None:
                prev.end_before_start(operation)
            prev = operation

        # End time of the job is end time of the last operation:
        assert prev is not None
        ends.append(prev.end())

    # Tasks on each machine cannot overlap:
    for m in range(nb_machines):
        model.no_overlap(machines[m])
    # Tasks on each worker cannot overlap:
    for w in range(nb_workers):
        model.no_overlap(workers[w])

    # Redundant cumulative: at most min(nb_machines, nb_workers) operations simultaneously
    if redundant_cumul:
        model.enforce(model.sum(all_operations) <= min(nb_machines, nb_workers))

    # Minimize the makespan:
    makespan = model.max(ends)
    model.minimize(makespan)

    # Verify all input data was consumed:
    remaining = list(data)
    assert len(remaining) == 0, f"Unexpected data at end: {remaining}"

    return model


def main() -> None:
    global flat_alternatives, redundant_cumul, verbose

    usage = (
        "Usage: python flexible-jobshop-w.py [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n"
        "FJSSP-W specific options:\n"
        "  --flatAlternatives  Don't use hierarchical alternative constraints\n"
        "  --redundantCumul    Add a redundant cumul constraint\n"
        "  --verbose           Enable verbose output"
    )
    params, rest_args = cp.parse_known_parameters(usage=usage)

    # Parse FJSSP-W specific options:
    input_files: list[str] = []
    for arg in rest_args:
        if arg == "--flatAlternatives":
            flat_alternatives = True
        elif arg == "--redundantCumul":
            redundant_cumul = True
        elif arg == "--verbose":
            verbose = True
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
