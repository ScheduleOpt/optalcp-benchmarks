# Permutation Flowshop

The Flowshop Scheduling Problem (FSP) involves scheduling multiple jobs on multiple machines. Each job consists of operations that must be processed on machines in a fixed order (the same for all jobs). The goal is to minimize the makespan: the total time to complete all jobs.

In **permutation flowshop** (PFSP), jobs must be processed in the same order on all machines. This is more restrictive than **non-permutation flowshop** where the order of jobs can differ between machines. See [../non-permutation-flowshop/](../non-permutation-flowshop/) for the non-permutation variant.

## Model

The model uses interval variables for operations with three types of constraints:

1. **Precedence**: Operations of the same job must be executed in machine order.
2. **No-overlap**: Each machine can process only one operation at a time.
3. **Same order**: Jobs must be processed in the same order on all machines (enforced using position variables and sequence variables).

## Benchmark instances

Permutation flowshop and non-permutation flowshop share the same benchmark instances. See [../non-permutation-flowshop/README.md](../non-permutation-flowshop/README.md) for data sources.

This benchmark supports both **Taillard format** and **OR-Library format**, with automatic format detection.

## Best known results

Best-known bounds for permutation flowshop can be found on Taillard's webpage: <http://mistic.heig-vd.ch/taillard/problemes.dir/ordonnancement.dir/ordonnancement.html>
