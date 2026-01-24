#!/usr/bin/env python3
"""
Resource-Constrained Project Scheduling Problem (RCPSP).

Schedule jobs with precedence constraints and limited renewable resources.
Each job has a fixed duration and resource requirements. Resources have
per-time-step capacity limits. Objective: minimize makespan.
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


def read_file_as_number_array(filename: str) -> list[int]:
    """Read a file and parse whitespace-separated numbers."""
    return [int(x) for x in read_file(filename).strip().split()]


def make_model_name(benchmark_name: str, filename: str) -> str:
    """Generate model identifier from benchmark name and filename."""
    instance = re.sub(r"[/\\]", "_", filename)
    instance = re.sub(r"^data_", "", instance)
    instance = re.sub(r"\.gz$", "", instance)
    instance = re.sub(r"\.json$", "", instance)
    instance = re.sub(r"\...?$", "", instance)
    return f"{benchmark_name}_{instance}"


def define_model_rcp(filename: str) -> cp.Model:
    """Read RCPSP data file in '.rcp' format."""
    data = iter(read_file_as_number_array(filename))
    model = cp.Model(name=make_model_name("rcpsp", filename))

    # Read initial numbers at the beginning of the file:
    nb_jobs = next(data)
    nb_resources = next(data)
    nb_real_jobs = nb_jobs - 2

    # Read resource capacities and initialize their cumuls:
    capacities = [next(data) for _ in range(nb_resources)]
    cumuls: list[list[cp.CumulExpr]] = [[] for _ in range(nb_resources)]

    # Create interval variables
    jobs = [model.interval_var(name=f"T{j + 1}") for j in range(nb_real_jobs)]

    # Skip dummy source job:
    assert next(data) == 0  # duration
    for _ in range(nb_resources):
        assert next(data) == 0  # resource requirement
    nb_successors = next(data)
    for _ in range(nb_successors):
        next(data)  # successor IDs

    # Preparation for the makespan: array of end times of the last jobs
    ends: list[cp.IntExpr] = []

    # Read individual jobs
    for j in range(nb_real_jobs):
        duration = next(data)
        jobs[j].length_min = duration
        jobs[j].length_max = duration
        for r in range(nb_resources):
            requirement = next(data)
            cumuls[r].append(model.pulse(jobs[j], requirement))
        nb_successors = next(data)
        is_last = True
        predecessor = jobs[j]
        for _ in range(nb_successors):
            s_id = next(data)
            assert 2 <= s_id <= nb_jobs
            # Ignore sink job:
            if s_id < nb_jobs:
                successor = jobs[s_id - 2]
                predecessor.end_before_start(successor)
                is_last = False
        if is_last:
            ends.append(predecessor.end())

    # Skip dummy sink job:
    assert next(data) == 0  # duration
    for _ in range(nb_resources):
        assert next(data) == 0  # resource requirement
    assert next(data) == 0  # number of successors

    # Verify we consumed all input
    remaining = list(data)
    assert len(remaining) == 0, f"Unexpected data at end: {remaining}"

    # Constraint height of cumuls:
    for r in range(nb_resources):
        model.enforce(model.sum(cumuls[r]) <= capacities[r])

    # Minimize makespan:
    model.minimize(model.max(ends))

    return model


def define_model_sm(filename: str) -> cp.Model:
    """Read RCPSP data file in '.sm' format."""
    model = cp.Model(name=make_model_name("rcpsp", filename))

    # Read the whole file into memory and remove text labels:
    input_txt = read_file(filename)
    input_txt = re.sub(r"^\*\**$", "", input_txt, flags=re.MULTILINE)
    input_txt = re.sub(r"file with basedata *: .*", "", input_txt)
    input_txt = re.sub(r"initial value random generator: [0-9]*", "", input_txt)
    input_txt = re.sub(r"projects +: {2}1", "", input_txt)
    input_txt = re.sub(r"jobs \(incl. supersource/sink \): ", "", input_txt)
    input_txt = re.sub(r"horizon *:", "", input_txt)
    input_txt = re.sub(r"RESOURCES", "", input_txt)
    input_txt = re.sub(r"- renewable *: *([0-9]*) *R", r"\1", input_txt)
    input_txt = re.sub(r"- nonrenewable *: *0 *N", "", input_txt)
    input_txt = re.sub(r"- doubly constrained *: *0 *D", "", input_txt)
    input_txt = re.sub(r"PROJECT INFORMATION:", "", input_txt)
    input_txt = re.sub(r"pronr\. *#jobs rel.date duedate tardcost *MPM-Time", "", input_txt)
    input_txt = re.sub(r"PRECEDENCE RELATIONS:", "", input_txt)
    input_txt = re.sub(r"jobnr. *#modes *#successors *successors", "", input_txt)
    input_txt = re.sub(r"REQUESTS/DURATIONS:", "", input_txt)
    input_txt = re.sub(r"jobnr. mode duration [ R0-9]*", "", input_txt)
    input_txt = re.sub(r"^--*$", "", input_txt, flags=re.MULTILINE)
    input_txt = re.sub(r"RESOURCEAVAILABILITIES:", "", input_txt)
    input_txt = re.sub(r"^ *R 1 [ R0-9]*$", "", input_txt, flags=re.MULTILINE)

    # After this preprocessing there should be only numbers:
    if not re.match(r"^[ 0-9\n]*$", input_txt):
        print("Failed to remove garbage from the input file. Result after replace:")
        print(input_txt)
        sys.exit(1)

    # Convert the input into an iterator of numbers:
    data = iter(int(x) for x in input_txt.strip().split())

    # Read initial numbers at the beginning of the file:
    nb_jobs = next(data)
    next(data)  # horizon (unused)
    nb_resources = next(data)
    assert next(data) == 1  # pronr
    nb_real_jobs = next(data)
    assert next(data) == 0  # releaseDate
    next(data)  # dueDate (unused)
    next(data)  # tardCost (unused)
    next(data)  # mpmTime (unused)

    assert nb_real_jobs == nb_jobs - 2

    # Create interval variables
    jobs = [model.interval_var(name=f"T{j + 1}") for j in range(nb_real_jobs)]

    # Skip dummy source job:
    assert next(data) == 1  # job ID
    assert next(data) == 1  # mode
    nb_successors = next(data)
    for _ in range(nb_successors):
        next(data)  # successor IDs

    # Preparation for the makespan: array of end times of the last jobs
    ends: list[cp.IntExpr] = []

    # Read precedence relations for the real jobs:
    for j in range(nb_real_jobs):
        assert next(data) == j + 2  # job ID
        assert next(data) == 1  # number of modes
        is_last = True
        predecessor = jobs[j]
        nb_successors = next(data)
        for _ in range(nb_successors):
            s_id = next(data)
            assert 2 <= s_id <= nb_jobs
            # Ignore sink job:
            if s_id < nb_jobs:
                successor = jobs[s_id - 2]
                predecessor.end_before_start(successor)
                is_last = False
        if is_last:
            ends.append(predecessor.end())

    # Minimize makespan:
    model.minimize(model.max(ends))

    # Skip dummy sink job (precedence):
    assert next(data) == nb_jobs  # jobID
    assert next(data) == 1  # mode
    assert next(data) == 0  # number of successors

    # Prepare cumulative resources:
    cumuls: list[list[cp.CumulExpr]] = [[] for _ in range(nb_resources)]

    # Skip dummy source job (duration/resources):
    assert next(data) == 1  # jobID
    assert next(data) == 1  # mode
    assert next(data) == 0  # duration
    for _ in range(nb_resources):
        assert next(data) == 0  # required capacity

    # Parse job durations and resource requirements
    for j in range(nb_real_jobs):
        assert next(data) == j + 2  # jobID
        assert next(data) == 1  # mode
        duration = next(data)
        job = jobs[j]
        job.length_min = duration
        job.length_max = duration
        for r in range(nb_resources):
            c = next(data)
            if c > 0:
                cumuls[r].append(model.pulse(job, c))

    # Skip dummy sink job (duration/resources):
    assert next(data) == nb_jobs  # jobID
    assert next(data) == 1  # mode
    assert next(data) == 0  # duration
    for _ in range(nb_resources):
        assert next(data) == 0  # required capacity

    # Read available resource capacities:
    for r in range(nb_resources):
        c = next(data)
        assert c > 0
        model.enforce(model.sum(cumuls[r]) <= c)

    # Verify we consumed all input
    remaining = list(data)
    assert len(remaining) == 0, f"Unexpected data at end: {remaining}"

    return model


def define_model(filename: str) -> cp.Model:
    """Define RCPSP model, auto-detecting file format from extension."""
    if ".rcp" in filename:
        return define_model_rcp(filename)
    if ".sm" in filename:
        return define_model_sm(filename)

    print(f"Unable to guess data format of '{filename}'. Known extensions are .rcp and .sm.")
    sys.exit(1)


def main() -> None:
    usage = "Usage: python rcpsp.py [OPTIONS] INPUT_FILE [INPUT_FILE2] .."
    params, input_files = cp.parse_known_parameters(usage=usage)

    if not input_files:
        print(usage, file=sys.stderr)
        print("Use --help for available options.", file=sys.stderr)
        sys.exit(1)

    for filename in input_files:
        define_model(filename).solve(params)


if __name__ == "__main__":
    main()
