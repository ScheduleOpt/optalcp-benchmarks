# Flexible Job Shop Scheduling Problem with Worker Flexibility (FJSSP-W)

## Problem Description

The Flexible Job Shop Scheduling Problem with Worker Flexibility (FJSSP-W) extends
the classical Flexible Job Shop Scheduling Problem (FJSSP) by incorporating
workforce constraints.

In FJSSP-W:
- A set of **n jobs** must be processed on **m machines** by **w workers**.
- Each job consists of a sequence of **operations** that must be executed in order.
- Each operation can be processed on one of several **eligible machines**.
- Additionally, each operation requires a **worker** to be present during processing.
- The **processing time** of an operation depends on both the assigned machine
  and the assigned worker.

## Constraints

1. **Precedence**: Operations within a job must be executed sequentially.
2. **Machine capacity**: Each machine can process at most one operation at a time.
3. **Worker capacity**: Each worker can work on at most one operation at a time.
4. **Assignment**: Each operation must be assigned to exactly one (machine, worker) pair
   from the set of eligible combinations.

## Objective

Minimize the **makespan**: the total time required for completing all jobs
(i.e., the maximum completion time across all jobs).

## Input Format

The input file format is as follows:
```
<nbJobs> <nbMachines> <nbWorkers> [(<avgMachinesPerOp>)]
<nbOperations for job 1>
  <nbMachineChoices for op 1> <machine1> <nbWorkerChoices> <worker1> <duration1> <worker2> <duration2> ... <machine2> <nbWorkerChoices> ...
  <nbMachineChoices for op 2> ...
<nbOperations for job 2>
  ...
```

Machines and workers are numbered starting from 1 in the input files.

## Model Options

- `--flatAlternatives`: Use a flat alternative constraint structure instead of the
  default hierarchical structure. By default, the model creates hierarchical
  alternatives: first selecting a machine, then selecting a worker for that machine.
  With this option, all (machine, worker) combinations are presented as a single
  flat alternative. **This matches the CP formulation in the reference paper.**

- `--redundantCumul`: Add a redundant cumulative constraint limiting the number of
  operations that can be processed simultaneously to `min(nbMachines, nbWorkers)`.
  This constraint is implied by the machine and worker no-overlap constraints but
  can help the solver prune the search space.

Note: The reference paper uses flat alternatives without redundant cumulative
constraints. The default hierarchical structure in this implementation is an
alternative formulation that may improve constraint propagation but creates
more constraints.

## Data files

The 402 instances in the `data/` directory were downloaded from
<https://github.com/jrc-rodec/FJSSP-W-Benchmarking>
(directory `instances/Example_Instances_FJSSP-WF`).

The files were renamed from `.fjs` to `.fjsw` to distinguish them from standard
FJSSP instances which use a different format.

## Reference

Hutter, D. et al. "A Benchmarking Environment for Worker Flexibility in Flexible
Job Shop Scheduling Problems", arXiv:2501.16159, 2025.

- https://arxiv.org/abs/2501.16159
- https://github.com/jrc-rodec/FJSSP-W-Benchmarking
