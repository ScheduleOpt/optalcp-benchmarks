#!/usr/bin/env python3
"""
Demo: Run OptalCP and a heuristic solver in parallel.

The two processes exchange solutions asynchronously via stdin/stdout.
OptalCP uses external solutions to prune the search space and improve them
using Large Neighborhood Search (when searchType=LNS).
See README.md for more details.
"""

import asyncio
import gzip
import json
import re
import signal
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
    return f"jobshop_{instance}"


def define_model(filename: str) -> cp.Model:
    """Define the jobshop scheduling model."""
    data = iter(read_file_as_number_array(filename))
    model = cp.Model(name=make_model_name(filename))

    nb_jobs = next(data)
    nb_machines = next(data)

    # For each machine, an array of operations executed on it:
    machines: list[list[cp.IntervalVar]] = [[] for _ in range(nb_machines)]

    # End times of each job:
    ends: list[cp.IntExpr] = []

    for i in range(nb_jobs):
        prev: cp.IntervalVar | None = None
        for j in range(nb_machines):
            machine_id = next(data)
            duration = next(data)
            operation = model.interval_var(
                length=duration, name=f"J{i + 1}O{j + 1}M{machine_id + 1}"
            )
            machines[machine_id].append(operation)
            if prev is not None:
                prev.end_before_start(operation)
            prev = operation
        assert prev is not None
        ends.append(prev.end())

    for j in range(nb_machines):
        model.no_overlap(machines[j])

    makespan = model.max(ends)
    model.minimize(makespan)

    return model


async def main() -> None:
    usage = "Usage: python jobshop-hybrid.py [OPTIONS] INPUT_FILE"
    params, rest_args = cp.parse_known_parameters(usage=usage)

    if len(rest_args) != 1:
        print(usage, file=sys.stderr)
        sys.exit(1)

    filename = rest_args[0]

    solver = cp.Solver()
    model = define_model(filename)

    # Handle Ctrl-C gracefully: stop the solver and print summary instead of
    # terminating immediately.
    signal.signal(signal.SIGINT, lambda sig, frame: solver.stop("Interrupted"))

    # Create a dict from variable names to variables for fast access:
    vars_map: dict[str, cp.IntervalVar] = {}
    for v in model.get_interval_vars():
        assert v.name is not None
        vars_map[v.name] = v

    # Launch the heuristic solver as a child subprocess:
    print("Starting heuristics subprocess...")
    heuristics_process = await asyncio.create_subprocess_exec(
        sys.executable,
        "jobshop-heuristics.py",
        filename,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=None,  # Inherit stderr
        limit=2**20,  # 1MB buffer for long JSON lines
    )

    assert heuristics_process.stdout is not None
    assert heuristics_process.stdin is not None

    # Task to read solutions from heuristics and send them to solver
    async def read_heuristics_output() -> None:
        assert heuristics_process.stdout is not None
        while True:
            line = await heuristics_process.stdout.readline()
            if not line:
                break
            data = json.loads(line.decode())
            solution = cp.Solution()
            solution.set_objective(data["makespan"])
            # We assume the solution contains all variables with correct names
            for t in data["schedule"]:
                v = vars_map.get(t["name"])
                assert v is not None, f"Unknown variable: {t['name']}"
                solution.set_value(v, t["start"], t["end"])
            solver.send_solution(solution)

    # Handler for solutions found by OptalCP
    def on_solution(event: cp.SolutionEvent) -> None:
        solution = event.solution
        schedule: list[dict[str, str | int]] = []
        for v in model.get_interval_vars():
            # Absent intervals are simply omitted from the schedule
            if solution.is_absent(v):
                continue
            start = solution.get_start(v)
            end = solution.get_end(v)
            assert start is not None and end is not None and v.name is not None
            schedule.append({"name": v.name, "start": start, "end": end})
        makespan = solution.get_objective()
        output = json.dumps({"makespan": makespan, "schedule": schedule}) + "\n"
        assert heuristics_process.stdin is not None
        heuristics_process.stdin.write(output.encode())

    solver.on_solution = on_solution

    # Start reading heuristics output in background
    reader_task = asyncio.create_task(read_heuristics_output())

    try:
        # Solve the model
        await solver.solve(model, params)
    finally:
        # Kill the heuristics process if still running
        heuristics_process.kill()
        await heuristics_process.wait()
        reader_task.cancel()
        try:
            await reader_task
        except asyncio.CancelledError:
            pass


if __name__ == "__main__":
    asyncio.run(main())
