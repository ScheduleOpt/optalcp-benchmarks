# Capacitated Vehicle Routing Problem

## Credits

Vít Knobloch wrote the initial version, and then it was significantly improved.

## Data files

Data files were downloaded from [CVRPLIB](http://vrp.galgos.inf.puc-rio.br/index.php/en/). Set XML was omitted because it is too large. Currently, the benchmark is not able to parse sets D and E (for the same reason as some [TSP benchmarks](../tsp/README.md).

## Known solutions

Knows solutions (also from [CVRPLIB](http://vrp.galgos.inf.puc-rio.br/index.php/en/)) can be found in the directory [`known-solutions`](known-solutions). Note that the node numbers in the solution files are shifted by 1. In the input files, node 1 is the depot. In the solution files, node 1 does not appear at all (it is implicitly the first and last node of every route). Instead, node 1 in the solution file is the node 2 from the input file.

## Benchmark-specific options

```text
  --nbVehicles <number>        Number of vehicles
  --objective <makespan|total> Objective function
  --checkTriangularInequality  Warn if triangular inequality is not respected
  --visitDuration <number>     Duration of each visit (the default is 0)
  --forceCeil                  Round up during distance computation
  --checkDirectionSymmetry     Warn if the directions are not symmetrical
  --breakDirectionSymmetry     Break the direction symmetry of the solution
  --breakVehicleSymmetry       Order vehicles by the minimum city visited
```

See below for more details.

## Number of vehicles

The number of vehicles is not given in the input files, but often, it is part of the instance name after `k`. For example, instance `A-n32-k5.vrp` has five vehicles. By default, the benchmark tries to decode the number of vehicles from the file name. The command line parameter `--nbVehicles` can set the number of vehicles directly.

## Triangular inequality

Many benchmark instances do not fulfill triangular inequality due to rounding errors (distances computed by `EUC_2D`). It causes the same issues as in
[TSP benchmark](../tsp/README.md#triangular-inequality), see more details there. Therefore, CVRP benchmark also supports command-line options
`--checkTriangularInequality`, `--visitDuration`, and `--forceCeil` from the TSP benchmark.

Known optimal solutions are using rounding errors to get to some nodes faster. Let's consider the instance `A-n32-k5`. The optimal solution is using the following two shortcuts (node numbers are shifted by 1 as usual in the solutions):

```text
31 -> 19 -> 17:   5 + 2 < 8
16 -> 30 -> 0:   9 + 16 < 2
```

Here are the results of OptalCP with different options to compensate for the triangular inequality:

* Without `--forceCeil` and without `--visitDuration`, the optimal solution is found. But it's length is computed as 786.
* With `--forceCeil`, OptalCP says that the optimal length is 807.
* With `--visitDuration 1`, the optimal solution is found, and its length is 784.

## Makespan objective

The default objective is to minimize the total length of the routes. However, there is also an option `--objective makespan` to minimize the length of the longest route. In this case, we compute the time when the last vehicle returns to the depot.

Note that the makespan objective includes the lengths of the visits as given by `--visitDuration`. In contrast, the default objective "total" deduces the durations of the visits from the total length of the routes.

## Symmetry breaking

CVRP is a highly symmetrical problem. There are two main symmetries: direction symmetry and route order symmetry.

Symmetry breaking implemented in the benchmark is partially inspired by the following paper:

___Maryam Darvish, Leandro C. Coelho, Raf Jans:___ [Comparison of Symmetry Breaking and Input Ordering Techniques for Routing Problems](https://www.cirrelt.ca/documentstravail/cirrelt-2020-22.pdf)

In general, symmetry breaking is helpful for FDS search, but it may slow down LNS search.

### Direction symmetry

In the input files, all the transition matrixes are symmetrical (could be checked by `--checkDirectionSymmetry`, as described in [TSP benchmark](../tsp/README.md). Therefore, reversing the order of nodes in a route leads to the equivalent solution. To break it, use the command-line parameter `--breakDirectionSymmetry`.

### Vehicle symmetry

Changing the order of the vehicles/routes also leads to an equivalent solution. To break it, use the command-line parameter `--breakVehicleSymmetry`.
