#!/usr/bin/env python3
"""
Multi-Mode Resource-Constrained Project Scheduling Problem (MMRCPSP).

Jobs must be scheduled respecting precedence constraints. Each job has multiple
execution modes with different durations and resource requirements. Renewable
resources have per-time-step capacity limits. Non-renewable resources have
total capacity limits across the entire project.

Objective: minimize non-renewable resource overflow (as penalty), then makespan.
"""

import gzip
import re
import sys
from pathlib import Path
from typing import Iterator

import optalcp as cp

# Command-line options:
# Add redundant cumulative constraints on main job intervals (variable pulse heights)
use_redundant_cumuls = False
# Add a single cumulative constraint summing all renewable resources
use_global_cumul = False
# Add a single constraint summing all non-renewable resources
use_global_non_renewable = False


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


def skip_expected(data: Iterator[int], expected: int) -> None:
    """Read and verify the next value equals expected."""
    v = next(data)
    assert v == expected, f"Expected {expected}, got {v}"


def define_model(filename: str) -> cp.Model:
    """Define the MMRCPSP model."""
    input_txt = read_file(filename)
    model = cp.Model(name=make_model_name("mmrcpsp", filename))

    has_project_information = bool(re.search(r"PROJECT INFORMATION:", input_txt))

    # Remove text labels from the input file, keeping only numbers:
    input_txt = re.sub(r"^\*+$", "", input_txt, flags=re.MULTILINE)
    input_txt = re.sub(r"file with basedata *: .*", "", input_txt)
    input_txt = re.sub(r"initial value random generator: [0-9]*", "", input_txt)
    input_txt = re.sub(r"projects +: {2}1", "", input_txt)
    input_txt = re.sub(r"jobs *\(incl. supersource/sink \):", "", input_txt)
    input_txt = re.sub(r"RESOURCES", "", input_txt)
    input_txt = re.sub(r"- renewable *: *([0-9]*) *R", r"\1", input_txt)
    input_txt = re.sub(r"- nonrenewable *: *([0-9]*) *N", r"\1", input_txt)
    input_txt = re.sub(r"- doubly constrained *: *0 *D", "", input_txt)
    input_txt = re.sub(r"horizon[ \t]*:[ \t]*[0-9]*", "", input_txt)
    input_txt = re.sub(r"PROJECT INFORMATION:", "", input_txt)
    input_txt = re.sub(r"pronr\. *#jobs rel.date duedate tardcost *MPM-Time", "", input_txt)
    input_txt = re.sub(r"PRECEDENCE RELATIONS:", "", input_txt)
    input_txt = re.sub(r"jobnr. *#modes *#successors *successors", "", input_txt)
    input_txt = re.sub(r"REQUESTS/DURATIONS:?", "", input_txt)
    input_txt = re.sub(r"jobnr.[ \t]*mode[ \t]*dur(ation)?[ \t]*[ \tNR0-9]*", "", input_txt)
    input_txt = re.sub(r"^-+$", "", input_txt, flags=re.MULTILINE)
    input_txt = re.sub(r"RESOURCE ?AVAILABILITIES:?", "", input_txt)
    input_txt = re.sub(r"^[\t ]*R 1[\t NR0-9]*$", "", input_txt, flags=re.MULTILINE)

    # After this preprocessing there should be only numbers:
    if not re.match(r"^[ \t0-9\r\n]*$", input_txt):
        print("Failed to remove garbage from the input file. Result after replace:")
        print(input_txt)
        sys.exit(1)

    # Convert the input into an iterator of numbers:
    data = iter(int(x) for x in input_txt.split())

    # Problem dimensions:
    nb_jobs = next(data)
    nb_real_jobs = nb_jobs - 2  # Excluding dummy source and sink jobs
    nb_resources = next(data)  # Renewable resources
    nb_non_renewable = next(data)

    if has_project_information:
        pronr = next(data)
        nb_non_dummy_jobs = next(data)
        release_date = next(data)
        _due_date = next(data)  # unused
        _tard_cost = next(data)  # unused
        _mpm_time = next(data)  # unused
        assert pronr == 1
        assert nb_non_dummy_jobs == nb_real_jobs
        assert release_date == 0

    # Create main interval variable for each job (mode selection via alternative below):
    jobs = [model.interval_var(name=f"J{j + 1}") for j in range(nb_real_jobs)]

    # Skip precedence relations for the dummy source job:
    skip_expected(data, 1)  # job ID
    skip_expected(data, 1)  # number of modes
    nb_successors = next(data)
    for _ in range(nb_successors):
        next(data)

    nb_modes: list[int] = []  # Number of modes for each job (read from precedence section)
    ends: list[cp.IntExpr] = []  # End times of jobs with no successors (for makespan)

    # Read precedence relations and add end_before_start constraints:
    for j in range(nb_real_jobs):
        skip_expected(data, j + 2)  # job ID
        nb_modes.append(next(data))
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

    # Skip precedence relations of the dummy sink job:
    skip_expected(data, nb_jobs)  # jobID
    skip_expected(data, 1)  # mode
    skip_expected(data, 0)  # number of successors

    # Cumulative expressions for renewable resources (per-resource capacity limits):
    cumuls: list[list[cp.CumulExpr]] = [[] for _ in range(nb_resources)]
    redundant_cumuls: list[list[cp.CumulExpr]] = [[] for _ in range(nb_resources)]
    global_cumul: list[cp.CumulExpr] = []
    # Integer expressions for non-renewable resources (total usage across project):
    non_renewables: list[list[cp.IntExpr]] = [[] for _ in range(nb_non_renewable)]
    global_non_renewable: list[cp.IntExpr] = []

    # Skip duration and resource requirements of dummy source job:
    skip_expected(data, 1)  # jobID
    skip_expected(data, 1)  # mode
    skip_expected(data, 0)  # duration
    for _ in range(nb_resources):
        skip_expected(data, 0)  # required capacity
    for _ in range(nb_non_renewable):
        skip_expected(data, 0)  # required capacity

    # Parse job modes with durations and resource requirements:
    for j in range(nb_real_jobs):
        skip_expected(data, j + 2)  # jobID
        modes: list[cp.IntervalVar] = []  # Optional interval for each mode

        renewable_requirements: list[list[int]] = [[] for _ in range(nb_resources)]
        for a in range(nb_modes[j]):
            skip_expected(data, a + 1)  # mode
            duration = next(data)
            mode = model.interval_var(
                optional=True, length=duration, name=f"J{j + 1}M{a + 1}"
            )
            modes.append(mode)
            total_c = 0
            for r in range(nb_resources):
                c = next(data)
                renewable_requirements[r].append(c)
                total_c += c
            global_cumul.append(model.pulse(modes[a], total_c))
            total_c = 0
            for n in range(nb_non_renewable):
                c = next(data)
                non_renewables[n].append(mode.presence() * c)
                total_c += c
            global_non_renewable.append(mode.presence() * total_c)

        # Add cumulative pulses for renewable resources:
        for r in range(nb_resources):
            min_c = renewable_requirements[r][0]
            max_c = min_c
            for a in range(1, nb_modes[j]):
                min_c = min(min_c, renewable_requirements[r][a])
                max_c = max(max_c, renewable_requirements[r][a])
            if max_c == 0:
                continue  # Job doesn't use this resource in any mode
            if min_c == max_c:
                # All modes have the same requirement: use main job interval
                cumuls[r].append(model.pulse(jobs[j], min_c))
                redundant_cumuls[r].append(model.pulse(jobs[j], min_c))
                continue
            # Variable requirement: add pulse for each mode interval
            heights: list[cp.IntExpr] = []
            for a in range(nb_modes[j]):
                c = renewable_requirements[r][a]
                heights.append(modes[a].presence() * c)
                if c == 0:
                    continue
                cumuls[r].append(model.pulse(modes[a], c))
            # Redundant: pulse on main interval with variable height
            redundant_cumuls[r].append(model.pulse(jobs[j], model.sum(heights)))

        # Exactly one mode must be selected for each job:
        model.alternative(jobs[j], modes)

    # Skip duration and resource requirements of dummy sink job:
    skip_expected(data, nb_jobs)  # jobID
    skip_expected(data, 1)  # mode
    skip_expected(data, 0)  # duration
    for _ in range(nb_resources):
        skip_expected(data, 0)  # required capacity
    for _ in range(nb_non_renewable):
        skip_expected(data, 0)  # required capacity

    # Renewable resource capacity constraints:
    global_c = 0
    for r in range(nb_resources):
        c = next(data)
        assert c > 0
        global_c += c
        model.enforce(model.sum(cumuls[r]) <= c)
        if use_redundant_cumuls:
            model.enforce(model.sum(redundant_cumuls[r]) <= c)
    if use_global_cumul:
        model.enforce(model.sum(global_cumul) <= global_c)

    # Non-renewable resource constraints (soft: overflow adds to cost):
    cost: list[cp.IntExpr] = []
    global_c = 0
    for n in range(nb_non_renewable):
        c = next(data)
        global_c += c
        used = model.sum(non_renewables[n])
        overflow = model.max2(0, used - c)
        cost.append(overflow)
    if use_global_non_renewable:
        used = model.sum(global_non_renewable)
        overflow = model.max2(0, used - global_c)
        cost.append(overflow)

    # Objective: minimize overflow penalty (*1000) + makespan (lexicographic-like):
    model.minimize(model.sum(cost) * 1000 + model.max(ends))

    return model


def main() -> None:
    global use_redundant_cumuls, use_global_cumul, use_global_non_renewable

    usage = (
        "Usage: python mmrcpsp.py [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n"
        "MMRCPSP options:\n"
        "  --redundantCumuls     Add redundant cumulative constraints\n"
        "  --globalCumul         Add global cumulative constraint\n"
        "  --globalNonRenewable  Add global non-renewable resource constraint"
    )
    params, rest_args = cp.parse_known_parameters(usage=usage)

    # Filter custom options from rest_args:
    input_files: list[str] = []
    for arg in rest_args:
        if arg == "--redundantCumuls":
            use_redundant_cumuls = True
        elif arg == "--globalCumul":
            use_global_cumul = True
        elif arg == "--globalNonRenewable":
            use_global_non_renewable = True
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
