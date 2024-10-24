# Utility to solve CP Optimizer models

This utility requires the installation of IBM ILOG CPLEX Studio; see [`Makefile`](Makefile) for details.

The utility `solveCPOs` uses CP Optimizer to solve models in `.cpo` file format. It accepts similar command-line arguments as other benchmarks in this repository. In particular, it supports `--summary` and `--result` options to store the results in CSV or JSON files. The generated JSON files can be used to compare different solvers using [compare](../compare) utility.

Solver parameters can be specified on the command line, too. For example, `--workers 2`.

Use `make` to build `solveCPOs` from the source code. See [`Makefile`](Makefile) for details.
