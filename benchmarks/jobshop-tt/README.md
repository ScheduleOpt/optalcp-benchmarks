# Jobshop with transition times

An extension of the classic Job Shop Scheduling Problem where transition times
between consecutive operations on a machine depend on the sequence. Each job
consists of operations that must be processed on specific machines in a given
order. Operations on the same machine cannot overlap, and switching from one
operation to another incurs a setup/transition time that depends on which
operations are involved. The objective is to minimize the makespan (total
completion time).

This models real-world scenarios where machines need reconfiguration between
tasks, such as tool changes in manufacturing or cleaning between batches in
chemical processing.

## Transition times generation

Due to a lack of benchmark instances, we generate transition times randomly
using xorshift32 PRNG seeded from the sum of all input values.
This ensures reproducible results across runs and identical behavior between
TypeScript and Python implementations.

Transition times are computed as Euclidean distances between randomly placed
2D points (one point per job), creating a metric that satisfies the triangle
inequality.
