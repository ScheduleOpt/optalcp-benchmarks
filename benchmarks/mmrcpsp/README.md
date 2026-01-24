# Multi-Mode Resource-Constrained Project Scheduling Problem

## Problem Description

The Multi-Mode Resource-Constrained Project Scheduling Problem (MMRCPSP) extends the
classical RCPSP by allowing each job to be executed in one of several modes, each with
different durations and resource requirements.

**Setting:** A project consists of n jobs with precedence constraints forming a
directed acyclic graph. Each job has multiple execution modes with different
duration/resource trade-offs.

**Resources:**
- **Renewable resources:** Have a capacity limit per time step (e.g., machines, workers).
  Usage resets after each time step.
- **Non-renewable resources:** Have a total capacity limit for the entire project
  (e.g., budget, raw materials). Once consumed, they are not replenished.

**Decisions:**
1. **Mode selection:** Choose exactly one execution mode for each job.
2. **Scheduling:** Determine the start time for each job.

**Constraints:**
- Precedence: Jobs must respect the precedence graph (a job cannot start before all
  its predecessors finish).
- Renewable capacity: At any time step, the total usage of each renewable resource
  must not exceed its capacity.
- Non-renewable capacity: The total usage of each non-renewable resource across all
  jobs must not exceed its capacity.

**Objective:** Minimize the makespan (project completion time).

## Implementation

The model creates a main interval variable for each job and optional interval variables
for each mode. The `alternative` constraint ensures exactly one mode is selected per job.
Precedence constraints use `endBeforeStart`. Renewable resources use cumulative constraints
with pulses.

**Objective function:** The objective is `overflow * 1000 + makespan`, where `overflow`
is the total violation of non-renewable resource capacities. This formulation allows the
solver to find solutions even when satisfying all non-renewable constraints is difficult.
The large multiplier (1000) ensures that minimizing overflow takes priority over minimizing
makespan. A solution with `overflow = 0` is feasible for the original problem.

**Command-line options:**
- `--redundantCumuls` - Add redundant cumulative constraints on main job intervals
  (with variable pulse heights). May improve propagation.
- `--globalCumul` - Add a global cumulative constraint summing all renewable resources.
- `--globalNonRenewable` - Add a global constraint summing all non-renewable resources.

## References

See the [MMRCPSP page](https://www.projectmanagement.ugent.be/research/project_scheduling/mmrcpsp)
of the Operations Research and Scheduling research group at Ghent University.
