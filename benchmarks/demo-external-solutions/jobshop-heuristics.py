#!/usr/bin/env python3
"""
Simple heuristic solver for the jobshop scheduling problem.

Generates solutions in JSON format to stdout, one solution per line.
Format: {"makespan": number, "schedule": [{"name": string, "start": number, "end": number}]}

Also listens to stdin for external solutions in the same format.
This is just a demo; the heuristic is simplistic and only uses the makespan.
"""

import gzip
import json
import math
import random
import sys
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Data:
    """Input jobshop data as read from a file."""

    instance: str
    nb_jobs: int
    nb_machines: int
    durations: list[list[int]]
    machines: list[list[int]]
    names: list[list[str]]
    preferences: list[list[int]]  # Random numbers for heuristic randomization


@dataclass
class Candidate:
    """A candidate task ready to be scheduled on a machine."""

    heuristic_value: int  # We schedule tasks with smallest value (min_end + preference)
    min_end: int  # Minimum end of the task (considers predecessor operations and machine occupancy)
    duration: int
    job: int
    operation: int
    preference: int  # Random number for heuristic randomization
    name: str


@dataclass
class Machine:
    """Represents a machine during heuristic search for a solution."""

    occupied_until: int = 0  # Time when the last already scheduled task ends
    candidates: list[Candidate] = field(
        default_factory=list
    )  # Tasks ready to be scheduled


@dataclass
class ScheduleTask:
    """A scheduled task with start and end times."""

    start: int
    end: int
    name: str


def read_data(filename: str) -> Data:
    """Read jobshop data from a file."""
    # Extract instance name from filename
    instance = Path(filename).name.removesuffix(".txt")

    # Read file content
    if filename.endswith(".gz"):
        with gzip.open(filename, "rt") as f:
            content = f.read()
    else:
        content = Path(filename).read_text()

    lines = content.strip().split("\n")

    # Parse header
    header = lines[0].split()
    nb_jobs = int(header[0])
    nb_machines = int(header[1])

    if nb_jobs <= 0 or nb_machines <= 0:
        print(f"Error in {instance} data", file=sys.stderr)
        sys.exit(1)

    durations: list[list[int]] = []
    machines: list[list[int]] = []
    preferences: list[list[int]] = []
    names: list[list[str]] = []

    for j in range(nb_jobs):
        data_line = lines[j + 1].split()
        nb_tasks = len(data_line) // 2
        job_durations: list[int] = []
        job_machines: list[int] = []
        job_preferences: list[int] = []
        job_names: list[str] = []

        for r in range(nb_tasks):
            machine_id = int(data_line[2 * r])
            duration = int(data_line[2 * r + 1])
            job_machines.append(machine_id)
            job_durations.append(duration)
            job_preferences.append(0)
            job_names.append(f"J{j + 1}O{r + 1}M{machine_id + 1}")

        durations.append(job_durations)
        machines.append(job_machines)
        preferences.append(job_preferences)
        names.append(job_names)

    return Data(
        instance=instance,
        nb_jobs=nb_jobs,
        nb_machines=nb_machines,
        durations=durations,
        machines=machines,
        names=names,
        preferences=preferences,
    )


def update_candidates(m: Machine) -> None:
    """Update candidate heuristic values and sort by heuristic value."""
    for c in m.candidates:
        c.min_end = max(m.occupied_until + c.duration, c.min_end)
        c.heuristic_value = c.min_end + c.preference
    m.candidates.sort(key=lambda c: c.heuristic_value)


def heuristics(data: Data, best_makespan: float) -> tuple[int, bool]:
    """
    Heuristic search for a solution.

    If the solution is better than best_makespan, outputs it in JSON format.
    Returns the makespan and whether a new best was found.
    """
    machines_state = [Machine() for _ in range(data.nb_machines)]

    # Initial candidates are first operations of all jobs
    for j in range(data.nb_jobs):
        duration = data.durations[j][0]
        preference = data.preferences[j][0]
        m = data.machines[j][0]
        name = data.names[j][0]
        machines_state[m].candidates.append(
            Candidate(
                heuristic_value=duration + preference,
                min_end=duration,
                duration=duration,
                job=j,
                operation=0,
                preference=preference,
                name=name,
            )
        )

    # Sort candidates by heuristic value
    for m in range(data.nb_machines):
        update_candidates(machines_state[m])

    schedule: list[ScheduleTask] = []

    while True:
        # Find candidate with smallest heuristic value across all machines
        min_heuristic_value = math.inf
        chosen_machine = -1

        for m in range(data.nb_machines):
            if not machines_state[m].candidates:
                continue  # No more candidates on this machine
            c = machines_state[m].candidates[0]
            if c.heuristic_value < min_heuristic_value:
                min_heuristic_value = c.heuristic_value
                chosen_machine = m

        if min_heuristic_value == math.inf:
            break  # No more candidates, everything is scheduled

        # Schedule the selected candidate
        machine = machines_state[chosen_machine]
        candidate = machine.candidates.pop(0)
        schedule.append(
            ScheduleTask(
                start=candidate.min_end - candidate.duration,
                end=candidate.min_end,
                name=candidate.name,
            )
        )
        machine.occupied_until = candidate.min_end
        update_candidates(machine)

        # Successor of the selected candidate becomes a candidate
        job = candidate.job
        next_operation = candidate.operation + 1
        if next_operation < len(data.durations[job]):
            duration = data.durations[job][next_operation]
            preference = data.preferences[job][next_operation]
            name = data.names[job][next_operation]
            min_end = candidate.min_end + duration
            m = data.machines[job][next_operation]
            machines_state[m].candidates.append(
                Candidate(
                    heuristic_value=min_end + preference,
                    min_end=min_end,
                    duration=duration,
                    job=job,
                    operation=next_operation,
                    preference=preference,
                    name=name,
                )
            )
            update_candidates(machines_state[m])

    # Compute makespan of the schedule
    makespan = max(t.end for t in schedule) if schedule else 0

    found_better = False
    if makespan < best_makespan:
        # Output the schedule in JSON format
        output = {
            "makespan": makespan,
            "schedule": [
                {"name": t.name, "start": t.start, "end": t.end} for t in schedule
            ],
        }
        print(json.dumps(output), flush=True)
        found_better = True

    return makespan, found_better


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python jobshop-heuristics.py <filename>", file=sys.stderr)
        sys.exit(1)

    filename = sys.argv[1]
    data = read_data(filename)

    # Best makespan found so far (by this process or received from solver)
    best_makespan: float = math.inf

    # Set up non-blocking stdin reading using select
    import select

    # First run heuristics without any randomization
    best_makespan, _ = heuristics(data, math.inf)

    # Compute max duration of all tasks
    max_duration = max(d for job in data.durations for d in job)

    # Infinite loop - we expect to be killed by parent process
    while True:
        # Check for input from solver (non-blocking)
        while select.select([sys.stdin], [], [], 0)[0]:
            try:
                line = sys.stdin.readline()
                if line:
                    external = json.loads(line)
                    best_makespan = min(best_makespan, external["makespan"])
            except (json.JSONDecodeError, KeyError):
                pass  # Ignore malformed input

        # Randomize the preferences
        for job_prefs in data.preferences:
            for i in range(len(job_prefs)):
                job_prefs[i] = random.randint(0, max_duration - 1)

        makespan, _ = heuristics(data, best_makespan)
        best_makespan = min(best_makespan, makespan)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass  # Silently exit on Ctrl-C
