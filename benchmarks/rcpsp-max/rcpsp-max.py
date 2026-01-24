#!/usr/bin/env python3
"""
RCPSP/max: Resource-Constrained Project Scheduling Problem with generalized
precedence constraints (minimum and maximum time lags).
"""

import gzip
import re
import sys
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


def define_model(filename: str) -> cp.Model:
    """Define the RCPSP/max model."""
    input_text = read_file(filename)
    # Input files contain characters '[' and ']'. Ignore them and convert the
    # text into an array of numbers:
    input_text = re.sub(r"[\[\]]", "", input_text)
    data = iter([int(x) for x in input_text.strip().split()])

    model = cp.Model(name=make_model_name("rcpsp-max", filename))

    # Read initial numbers at the beginning of the file:
    nb_real_jobs = next(data)
    nb_resources = next(data)
    assert next(data) == 0  # number of non-renewable resources?
    assert next(data) == 0  # number of doubly constrained resources?

    # Create interval variables
    jobs: list[cp.IntervalVar] = []
    # To compute scheduling horizon, it is good to know the maximum delay of
    # precedences starting at the given job:
    max_delay_after: list[int] = []
    for j in range(nb_real_jobs):
        itv = model.interval_var(name=f"T{j + 1}")
        jobs.append(itv)
        max_delay_after.append(0)

    # Ignore precedence relations for the dummy source job at the beginning:
    assert next(data) == 0  # Job ID
    assert next(data) == 1  # Mode ID
    nb_successors = next(data)
    for _ in range(nb_successors):
        next(data)  # Successor id
    for _ in range(nb_successors):
        assert next(data) == 0  # Precedence length

    # Preparation for the makespan: array of end times of the last jobs
    ends: list[cp.IntExpr] = []

    # Read precedence relations for normal jobs:
    for j in range(nb_real_jobs):
        assert next(data) == j + 1  # Job ID
        assert next(data) == 1  # Mode ID
        nb_successors = next(data)
        count_in_makespan = False
        predecessor = jobs[j]
        successors: list[cp.IntervalVar | None] = []
        # First there are IDs of the successors:
        for _ in range(nb_successors):
            s_id = next(data)
            assert 1 <= s_id <= nb_real_jobs + 1
            if s_id <= nb_real_jobs:
                # Successor is a normal job:
                successors.append(jobs[s_id - 1])
            else:
                # Successor is the sink dummy job. Include the predecessor in
                # makespan computation:
                count_in_makespan = True
                successors.append(None)
        # Then read delays and create precedences:
        for s in range(nb_successors):
            delay = next(data)
            successor = successors[s]
            if successor is not None:
                # Standard successor
                predecessor.start_before_start(successor, delay)
            else:
                # Successor is the dummy sink job. The delay to the sink equals
                # the job's duration. Set it here; we'll verify it matches the
                # duration read later.
                assert predecessor.length_min == 0
                predecessor.length_min = delay
                predecessor.length_max = delay
            max_delay_after[j] = max(max_delay_after[j], delay)
        if count_in_makespan:
            ends.append(predecessor.end())

    # Ignore precedences for the dummy sink job:
    assert next(data) == nb_real_jobs + 1  # Job ID
    assert next(data) == 1  # Mode ID
    assert next(data) == 0  # Number of successors

    # Read durations and resource usage.
    # First, ignore the dummy source job:
    assert next(data) == 0  # Job ID
    assert next(data) == 1  # Mode ID
    assert next(data) == 0  # Duration
    for _ in range(nb_resources):
        assert next(data) == 0  # Resource requirement

    # Prepare arrays for resources:
    resources: list[list[cp.CumulExpr]] = [[] for _ in range(nb_resources)]

    # We're going to compute rough UB (maximum end time) for all interval
    # variables:
    horizon = 0

    # Read durations and resource usage for real jobs
    for j in range(nb_real_jobs):
        assert next(data) == j + 1  # Job ID
        assert next(data) == 1  # Mode ID
        duration = next(data)
        # We could already set the length as we saw the precedence to dummy sink
        # job. Verify that it is correct:
        assert jobs[j].length_min == 0 or jobs[j].length_min == duration
        horizon += max(duration, max_delay_after[j])
        jobs[j].length_min = duration
        jobs[j].length_max = duration
        for r in range(nb_resources):
            requirement = next(data)
            resources[r].append(model.pulse(jobs[j], requirement))

    # Apply computed horizon:
    for j in range(nb_real_jobs):
        jobs[j].end_max = horizon

    # Ignore resource requirements of the dummy sink job:
    assert next(data) == nb_real_jobs + 1  # Job ID
    assert next(data) == 1  # Mode ID
    assert next(data) == 0  # Duration
    for _ in range(nb_resources):
        assert next(data) == 0  # Resource usage

    # Read resource capacities and create cumulative constraints:
    for r in range(nb_resources):
        capacity = next(data)
        model.enforce(model.sum(resources[r]) <= capacity)

    # There shouldn't be anything more in the input:
    try:
        next(data)
        raise AssertionError("Unexpected data at end of input")
    except StopIteration:
        pass

    # Minimize makespan:
    model.minimize(model.max(ends))

    return model


def main() -> None:
    usage = "Usage: python rcpsp-max.py [OPTIONS] INPUT_FILE [INPUT_FILE2] .."
    params, input_files = cp.parse_known_parameters(usage=usage)

    if not input_files:
        print(usage, file=sys.stderr)
        print("Use --help for available options.", file=sys.stderr)
        sys.exit(1)

    for filename in input_files:
        define_model(filename).solve(params)


if __name__ == "__main__":
    main()
