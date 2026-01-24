#!/usr/bin/env python3
"""
Resource-Constrained Project Scheduling Problem with Consumption and Production
of Resources (RCPSP-CPR). Extends classical RCPSP by introducing storage resources
(reservoirs) that track cumulative levels based on consumption at activity start
and production at activity end.
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
    """Define the RCPSP-CPR model."""
    data = iter(read_file_as_number_array(filename))
    model = cp.Model(name=make_model_name("rcpsp-cpr", filename))

    # Read problem dimensions:
    nb_jobs = next(data)
    nb_renewables = next(data)
    nb_reservoirs = next(data)
    nb_real_jobs = nb_jobs - 2

    # Read resource capacities and initial reservoir levels:
    renewable_capacities = [next(data) for _ in range(nb_renewables)]
    renewables: list[list[cp.CumulExpr]] = [[] for _ in range(nb_renewables)]
    reservoirs: list[list[cp.CumulExpr]] = [
        [model.step_at(cp.IntervalMin, next(data))] for _ in range(nb_reservoirs)
    ]

    # Create interval variables:
    jobs = [model.interval_var(name=f"T{j + 1}") for j in range(nb_real_jobs)]

    # Skip dummy source job (length must be zero):
    assert next(data) == 0
    for _ in range(nb_renewables):
        c = next(data)
        # Non-zero requirement is OK because length is zero.
        if c > 0:
            print(
                f"Warning: {model.name} has source job with non-zero renewable requirement."
            )
    # As noted in README.md, consumption and production of dummy jobs is
    # ignored, because otherwise the number of infeasible instances does not
    # match the results from literature.
    for _ in range(nb_reservoirs):
        next(data)  # consumption
        next(data)  # production
    nb_successors = next(data)
    for _ in range(nb_successors):
        next(data)  # Skip successor IDs

    # End times of jobs without successors (for makespan):
    ends: list[cp.IntExpr] = []

    # Read individual jobs:
    max_makespan = 0
    for j in range(nb_real_jobs):
        duration = next(data)
        jobs[j].length_min = duration
        jobs[j].length_max = duration
        max_makespan += duration
        for r in range(nb_renewables):
            requirement = next(data)
            renewables[r].append(jobs[j].pulse(requirement))
        for r in range(nb_reservoirs):
            consumption = next(data)
            production = next(data)
            if duration > 0:
                if consumption != 0:
                    # Using -step instead of negative height for CP Optimizer compatibility:
                    reservoirs[r].append(-jobs[j].step_at_start(consumption))
                if production != 0:
                    reservoirs[r].append(jobs[j].step_at_end(production))
        nb_successors = next(data)
        is_last = True
        for _ in range(nb_successors):
            s_id = next(data)
            assert 2 <= s_id <= nb_jobs
            # Don't add precedence to sink job:
            if s_id < nb_jobs:
                jobs[j].end_before_start(jobs[s_id - 2])
                is_last = False
        if is_last:
            ends.append(jobs[j].end())

    # Skip dummy sink job:
    assert next(data) == 0  # Length
    for _ in range(nb_renewables):
        assert next(data) == 0  # Renewable requirement
    # Consumption and production of dummy sink job is ignored (see above).
    for _ in range(nb_reservoirs):
        next(data)  # consumption
        next(data)  # production
    assert next(data) == 0  # Number of successors

    # Renewable resources must not exceed capacity, reservoirs must stay non-negative:
    for r in range(nb_renewables):
        model.enforce(model.sum(renewables[r]) <= renewable_capacities[r])
    for r in range(nb_reservoirs):
        model.enforce(model.sum(reservoirs[r]) >= 0)

    # Limit makespan to prevent propagation cycles, e.g., end_before_start(job1, job2)
    # but job2 is the only way to produce a reservoir needed for job1:
    for j in range(nb_real_jobs):
        jobs[j].end_max = max_makespan

    # Minimize makespan:
    model.minimize(model.max(ends))

    return model


def main() -> None:
    usage = "Usage: python rcpsp-cpr.py [OPTIONS] INPUT_FILE.rcp [INPUT_FILE2.rcp] .."
    params, input_files = cp.parse_known_parameters(usage=usage)

    if not input_files:
        print(usage, file=sys.stderr)
        print("Use --help for available options.", file=sys.stderr)
        sys.exit(1)

    for filename in input_files:
        define_model(filename).solve(params)


if __name__ == "__main__":
    main()
