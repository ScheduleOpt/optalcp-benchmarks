#!/usr/bin/env python3
"""
Job shop with operators: each operation requires both a machine and an operator.
The number of operators is limited, adding a cumulative resource constraint.
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


def make_model_name(benchmark_name: str, filename: str, nb_operators: int) -> str:
    """Generate model identifier from benchmark name and filename."""
    instance = re.sub(r"[/\\]", "_", filename)
    instance = re.sub(r"^data_", "", instance)
    instance = re.sub(r"\.gz$", "", instance)
    instance = re.sub(r"\.json$", "", instance)
    instance = re.sub(r"\...?$", "", instance)
    return f"{benchmark_name}_{instance}_{nb_operators}opers"


def define_model(filename: str, nb_operators: int) -> cp.Model:
    """Define the job shop with operators model."""
    data = iter(read_file_as_number_array(filename))
    model = cp.Model(name=make_model_name("jobshop-operators", filename, nb_operators))

    nb_jobs = next(data)
    nb_machines = next(data)

    # For each machine, an array of operations executed on it:
    machines: list[list[cp.IntervalVar]] = [[] for _ in range(nb_machines)]

    # End times of each job:
    ends: list[cp.IntExpr] = []

    # Cumulative pulses for operator requirements:
    operator_requirements: list[cp.CumulExpr] = []

    for i in range(nb_jobs):
        prev: cp.IntervalVar | None = None
        for j in range(nb_machines):
            machine_id = next(data)
            duration = next(data)
            operation = model.interval_var(
                length=duration,
                name=f"J{i + 1}O{j + 1}M{machine_id + 1}",
            )
            machines[machine_id].append(operation)
            # Each operation requires an operator:
            operator_requirements.append(model.pulse(operation, 1))
            # Chain with previous operation:
            if prev is not None:
                prev.end_before_start(operation)
            prev = operation
        assert prev is not None
        ends.append(prev.end())

    # Tasks on each machine cannot overlap:
    for j in range(nb_machines):
        model.no_overlap(machines[j])

    # Limited number of operators:
    model.enforce(model.sum(operator_requirements) <= nb_operators)

    # Minimize the makespan:
    makespan = model.max(ends)
    model.minimize(makespan)

    return model


def get_int_option(name: str, default: int, args: list[str]) -> int:
    """Parse and remove an integer option from args."""
    try:
        index = args.index(name)
        value = int(args[index + 1])
        del args[index : index + 2]
        return value
    except (ValueError, IndexError):
        return default


def main() -> None:
    usage = (
        "Usage: python jobshop-operators.py --nbOperators <n> [OPTIONS] INPUT_FILE ..\n\n"
        "Jobshop-operators options:\n"
        "  --nbOperators <number>  Number of available operators (required)"
    )
    params, rest_args = cp.parse_known_parameters(usage=usage)

    nb_operators = get_int_option("--nbOperators", 0, rest_args)

    if nb_operators <= 0:
        print("Missing or invalid --nbOperators argument.", file=sys.stderr)
        sys.exit(1)

    if not rest_args:
        print(usage, file=sys.stderr)
        print("Use --help for available options.", file=sys.stderr)
        sys.exit(1)

    for filename in rest_args:
        define_model(filename, nb_operators).solve(params)


if __name__ == "__main__":
    main()
