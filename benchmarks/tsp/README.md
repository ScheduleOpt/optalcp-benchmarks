# Traveling Salesman Problem

## Credits

Major corrections and improvements of the benchmark was done by Vít Knobloch.
He is also the author of _triangular correction_ described below.

## Instances

Taken from [TSPLIB](http://comopt.ifi.uni-heidelberg.de/software/TSPLIB95/).
The format is described in the paper [TSPLIB 95](http://comopt.ifi.uni-heidelberg.de/software/TSPLIB95/tsp95.pdf).

## Implementation

The format is rather complex. Only 2D distances (`EUC_2D`, `CEIL_2D`) and geographical distances (`GEO`) are implemented. It is possible that computation of `GEO` distances is not correct because some known optimal solutions do not match.

## Triangular correction

The distance matrix may not fulfill triangular inequality. It can happen even in
2D case due to rounding errors. For example, let's consider 3 points with the following distances:

```text
|AB| = 5.4  rounded to 5
|BC| = 5.4  rounded to 5
|AC| = 10.6 rounded to 11
```

After the rounding, the triangular inequality is violated. Increasing the precision (by multiplying all distances by a constant) helps, but doesn't eliminate the problem.

OptalCP applies distance matrix not only to direct successors on the path. In the example above, the path `A -> B -> C` cannot be shorter than 11 for OptalCP. Therefore, OptalCP may ignore some solutions and may claim optimality even if the solution is not optimal (when considering only direct successors).

To be able to make a fair comparison, benchmark instances with the triangular inequality fulfilled are needed. Triangular correction shortens some of the distances to fulfill the inequality. It is time consuming to compute the correction. Therefore the correction is precomputed and stored in `data/*.corr` files. To apply the correction, use command line parameter `--triangularCorrection`.

Note that triangular correction changes the instance. Therefore, the results are not directly comparable with the results on the original instances.

## Direction symmetry

The problem is symmetric with respect to the order of the cities. I.e., the order of the cities in the solution can be reversed without changing the cost. By default, the provided model does not break this symmetry. To break it, use command line parameter `--breakDirectionSymmetry`.

Breaking the symmetry can be helpful for optimality proofs with `searchType=FDS`. However, it may slow down the LNS search.
