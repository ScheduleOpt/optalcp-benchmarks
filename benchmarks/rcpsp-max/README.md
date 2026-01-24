# RCPSP/max

Resource-Constrained Project Scheduling Problem with generalized precedence constraints.

## Problem Description

RCPSP/max extends the classical RCPSP by replacing simple precedence constraints with
**generalized precedence constraints** that specify both minimum and maximum time lags
between activities.

In standard RCPSP, a precedence constraint `A → B` means "A must finish before B starts"
(i.e., `end(A) ≤ start(B)`). In RCPSP/max, precedence constraints have the form:

- **Minimum time lag:** `start(B) ≥ start(A) + d_min` — B must start at least `d_min`
  time units after A starts.
- **Maximum time lag:** `start(B) ≤ start(A) + d_max` — B must start at most `d_max`
  time units after A starts.

The "/max" in the name refers to these maximum time lag constraints, which are not
present in the basic RCPSP. Maximum time lags can model deadlines between activities,
such as "concrete must be poured within 2 hours of mixing."

**Constraints:**
- Generalized precedences with minimum and maximum time lags.
- Renewable resource capacity limits (same as RCPSP).

**Objective:** Minimize the makespan (project completion time).

## Data Sources

Data were downloaded from kobe-scheduling: <https://github.com/ptal/kobe-scheduling>.

In kobe-scheduling, there are files `optimum.csv` with known optimum makespans.
However, it is not clear where this data comes from.

## References

- A. Schutt, T. Feydy, P.J. Stuckey, and M. G. Wallace: *Solving RCPSP/max by Lazy
  Clause Generation*. Journal of Scheduling, 2013.
  Benchmark results: <https://people.eng.unimelb.edu.au/pstuckey/rcpsp/>
- P. Vilím, P. Laborie, P. Shaw: *Failure-Directed Search for Constraint-Based
  Scheduling*. CPAIOR 2015.
  Benchmark results: <https://vilim.eu/petr/cpaior2015-results.pdf>
