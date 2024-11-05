# Traveling Salesman Problem

## Credits

Vít Knobloch made significant corrections and improvements to the benchmark.

## Instances

Taken from [TSPLIB](http://comopt.ifi.uni-heidelberg.de/software/TSPLIB95/).
The format is described in the paper [TSPLIB 95](http://comopt.ifi.uni-heidelberg.de/software/TSPLIB95/tsp95.pdf).

## Implementation

The format is rather complex, and the benchmark cannot parse all the input files. In particular, only the following ways to compute the transition matrix are supported: `EUC_2D`, `CEIL_2D, ATT_2D`, `GEO`, `FULL_MATRIX`, and `UPPER_ROW`.
The computation of `GEO` distances may be incorrect because some known optimal solutions do not match.

## Benchmark-specific options

```text
  --checkTriangularInequality  Warn if triangular inequality is not respected
  --visitDuration <number>     Duration of each visit (the default is 0)
  --forceCeil                  Round up during distance computation
  --checkDirectionSymmetry     Warn if directions are not symmetrical
  --breakDirectionSymmetry     Break the direction symmetry of the solution
```

See below for more details.

## Triangular inequality

The distance matrix may not fulfill triangular inequality, particularly when the distances are given explicitly (e.g., `FULL_MATRIX`) or if the distances are rounded.
For example, let's consider 3 points with the following distances:

```text
|AB| = 5.4  rounded to 5
|BC| = 5.4  rounded to 5
|AC| = 10.6 rounded to 11
```

The triangular inequality is violated after the rounding (e.g., `EUC_2D`). Increasing the precision (by multiplying all distances by a constant) helps, but doesn't eliminate the problem. With rounding up, the problem above should not happen (e.g., CEIL_2D). However, it still occurs exceptionally in practice, even with `CEIL_2D`, due to rounding errors in the floating-point arithmetic (`sqrt`).

OptalCP applies the transition distances between every pair of nodes, not only between direct successors on the path. In the example above, the path `A -> B -> C` cannot be shorter than 11 for OptalCP. Therefore, with the default settings, OptalCP may ignore some solutions and claim optimality even if the solution is not optimal (considering direct successors only).

To check whether an instance fulfills the triangular inequality, use the parameter `--checkTriangularInequality`. With this parameter, the benchmark will print the first violation of the triangular inequality as a warning (before the solve starts). Note that the check is time-consuming.

## Compensate for the triangular inequality

It is possible to compensate for the triangular inequality by increasing the visit durations from 0 to a given number using the parameter `--visitDuration`. This way, the path `A -> B -> C` will be enlarged by the visit duration of B compared to `A -> C`, which may be enough to fulfill the triangular inequality. Then, the visit durations can be easily deduced from the total length of the path.

Increasing the visit duration does not change the instance. However, it decreases the model's propagation power and, therefore, may slow down the search.

The check `--checkTriangularInequality` takes the visit duration into account. Visit duration to 1 compensates for all rounding errors. With that, only two of the implemented instances do not fulfill 1Gthe triangular (because the transition matrix is given explicitly):

```text
* bays29
* brazil58
```

## Changing the distance computation

Sometimes, we need benchmark instances that satisfy triangular inequality to fairly compare different approaches. To increase the chance that an instance fulfills the triangular inequality, use parameter `--forceCeil` to force rounding all distances up during the computation.

Note that the change of rounding also changes the instance. Therefore, the results are not directly comparable with those of the original instances.

With `--forceCeil`, only the following instances do not fulfill the triangular inequality. Most of them are due to the explicit transition matrix:

* bays29
* brazil58
* d1291
* d1655
* d2103
* swiss42
* u2152

## Direction symmetry

All implemented benchmark instances have a symmetrical transition matrix.

Therefore, the problem is symmetric regarding the order of the nodes. I.e., the order of the nodes in the solution can be reversed without changing the cost. Use the parameter `--checkSymmetricalMatrix` to see whether the input matrix is symmetrical. If it isn't, a warning will be printed.

The provided model does not break direction symmetry by default. To break it, use the command-line parameter `--breakDirectionSymmetry`. This parameter is ignored if the transition matrix is not symmetrical.

Breaking the symmetry can be helpful for optimality proofs with `searchType=FDS`. However, it may slow down the LNS search.
