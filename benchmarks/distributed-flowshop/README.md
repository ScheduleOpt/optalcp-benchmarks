# Distributed FlowShop

## Problem Description

The Distributed Permutation Flow-Shop Scheduling Problem (DPFSP) is a generalization
of the classical Permutation Flow-Shop Scheduling Problem (PFSP) for distributed
manufacturing environments.

**Setting:** There are F identical factories, each equipped with m machines arranged
in series (every job visits machine 1, then machine 2, etc.). A set of n jobs must
be processed.

**Decisions:**
1. **Assignment:** Each job must be assigned to exactly one factory (jobs cannot
   be transferred between factories once assigned).
2. **Sequencing:** Jobs assigned to each factory must be sequenced for processing.

**Constraints:**
- Each job must pass through all m machines sequentially (flow-shop constraint).
- All factories have identical machine configurations.
- Processing times for each job are the same regardless of which factory processes it.
- Machines can process only one job at a time.

**Objective:** Minimize the makespan (maximum completion time across all factories).

**Variants:**
- **Permutation (DPFSP):** Jobs must be processed in the same order on all machines
  within each factory.
- **Non-permutation (DFSP):** Jobs can be processed in different orders on different
  machines within a factory.

This implementation supports both variants.

## Implementation

The model creates optional interval variables for each job/factory/machine combination.
Each job must be assigned to exactly one factory (enforced via a sum-of-presences constraint).
Sequence variables with no-overlap constraints ensure machines process one job at a time.
The permutation variant uses position variables with identity constraints to enforce
the same job order across all machines within each factory.

**Command-line options:**
- `--no-permutation` - Disable permutation constraint (allow different job orders on different machines)
- `--no-symmetryBreaking` - Disable symmetry breaking constraints
- `--redundantCumul` - Use alternative modeling with redundant cumulative constraints

**Complexity:** The problem is NP-hard. The assignment of jobs to factories adds
complexity beyond the classical flow-shop, requiring construction of a distinct
schedule for each factory.

## Paper

[Christos Gogos: _Solving the Distributed Permutation Flow-Shop Scheduling
Problem Using Constrained Programming_](https://www.mdpi.com/2076-3417/13/23/12562)

And related GitHub repository: <https://github.com/chgogos/DPFSP_CP>
