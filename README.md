# OptalCP Benchmark Collection

This repository contains various benchmarks and results for the [OptalCP](https://www.optalcp.com) solver.

Benchmarks include:

* [Jobshop (JSSP)](benchmarks/jobshop/)
* [Jobshop with operators](benchmarks/jobshop-operators/)
* [Blocking Jobshop](benchmarks/blocking-jobshop/)
* [Flexible Jobshop](benchmarks/flexible-jobshop/)
* [Openshop](benchmarks/openshop/)
* [(Non-permutation) Flowshop](benchmarks/non-permutation-flowshop/)
* [RCPSP](benchmarks/rcpsp/)
* [Multi-Mode RCPSP](benchmarks/mmrcpsp/)
* [RCPSP Max](benchmarks/rcpsp-max/)
* [RCPSP CPR](benchmarks/rcpsp-cpr/)
* [Distributed Flowshop](benchmarks/distributed-flowshop)

For each benchmark, there are usually [OptalCP](https://www.optalcp.com) and [IBM ILOG CPLEX CP Optimizer](https://www.ibm.com/products/ilog-cplex-optimization-studio/cplex-cp-optimizer) results (directories `benchmarks/*/results`) and also reference values from the literature (directories `benchmark/*/references`).

Visualizations of the results contained in this repository can be found [here](https://optalcp.com/docs/benchmarks/).

## License

This collection of benchmarks is open source under the MIT license (although [OptalCP](https://www.optalcp.com) itself isn't open source).

Benchmark data in directories `benchmarks/*/data` is taken from various sources listed in `README.md` files in these directories. We don't claim any rights to these data, please consider them a mirror of the existing sources. Similarly, for the best-known lower and upper bounds and other benchmark results in directories `benchmarks/*/reference.`

## Contributing

Any contribution you can make is welcome. In particular, we are looking for:

* New benchmark suggestions.
* Links to research papers with benchmarks.
* More results for existing benchmarks (best known or improved bounds, historical results).
* More instances of the existing benchmarks.

Don't hesitate to contact `petr@vilim.eu`, create a pull request or [report an issue](https://github.com/ScheduleOpt/optalcp-benchmarks/issues).

## Citation

If you use this benchmark collection in your research, please cite it as:

```bibtex
@software{OptalCPBenchmarks,
  title = {OptalCP Benchmark Collection},
  author = {Vil{\'i}m, Petr and Pons, Diego Olivier Fernandez and others},
  url = {https://github.com/ScheduleOpt/optalcp-benchmarks},
}
```

You can add the date you accessed the repository (usually using the `urldate` field), cite only a specific benchmark, or add more authors.

## Installation

First, you need to install [Node.js](https://nodejs.org/) and [git](https://git-scm.com/). Then, on the command line:

```sh
git clone https://github.com/ScheduleOpt/optalcp-benchmarks.git
cd optalcp-benchmarks
npm install
npx tsc
```

The commands above will copy the repository (command `git clone`), install necessary npm packages into `optalcp-benchmarks/node-modules` (command `npm install`), and finally compile TypeScript files into JavaScript (command `npx tsc`).

Note that the `npm install` command also installs the preview version of [OptalCP solver](https://www.optalcp.com/). The preview version is enough, it can solve all the benchmarks. However, the preview version reports only objective values, not values of the individual variables. If you can access the full version, you can install it using `npm install` instead of the preview version.

## Running a single benchmark instance

Each benchmark has its subdirectory in `optalcp-benchmarks/benchmarks`.
For example, to run jobshop benchmark instance `la17`, do the following on the command line:

```sh
cd optalcp-benchmark/benchmarks/jobshop
node jobshop.mjs data/la17.txt --nbWorkers 2 --searchType fds
```

The output will look like this (shortened):

```text
--------------------------------------------------------------------------------
                              ScheduleOpt OptalCP
                          version 0.7.1.144 4380b690
--------------------------------------------------------------------------------
Input parse time: 00:00
Parameters:
   NbWorkers = 2
   SearchType = FDS
Solver input:
   0 integer variables, 100 interval variables, 101 constraints, 35.1kB
   00:00 Presolving..
Presolved:
   0 integer variables, 100 interval variables, 101 constraints, 42.3kB
   00:00 Starting the search using 2 workers (nbWorkers parameter).
--------------------------------------------------------------------------------
   00:00 Lower bound 646 Worker 0
   ...
   00:00 Lower bound 738 Worker 0
   00:00 Solution 922 Worker 1
   ...
   00:00 Solution 785 Worker 1
   00:00 Lower bound 780 Worker 1
   00:00 Solution 784 Worker 1
   00:00 Worker 1: The current best solution is optimal.
--------------------------------------------------------------------------------
   Objective value: 784 (optimal)
       Lower bound: 784
         Solutions: 47
         LNS steps: 0 (0.00 per second)
          Restarts: 26 (1010.39 per second)
          Branches: 12200 (474107.94 per second)
             Fails: 2720 (105702.75 per second)
    Total duration: 00:00.03
            Memory: 1.87MB
--------------------------------------------------------------------------------
```

All benchmarks have similar command-line arguments (implemented by the function [benchmark](https://optalcp.com/docs/api/functions/benchmark) from OptalCP). In particular, all benchmarks accept `--help`, which prints the list of all available arguments.

## Setting engine and benchmark parameters

All [engine parameters](https://optalcp.com/docs/api/type-aliases/Parameters) and [benchmark parameters](https://optalcp.com/docs/api/type-aliases/BenchmarkParameters) can be set on the command line. The most commonly used engine parameters are:

* `--timeLimit seconds`: stop the search after the given number of seconds (unless the search is already finished).
* `--nbWorkers n`: number of workers (CPU threads) to use. By default, OptalCP will use all available physical CPU cores.
* `--searchType LNS|FDS|FDSLB|SetTimes`: sets the search type. The default is `LNS`. In short:
  * `LNS` (Large Neighborhood Search) is suitable for quickly finding high-quality solutions,
  * `FDS` (Failure-Directed Search) is suitable for optimality proofs,
  * `FDSLB` iteratively proves better and better lower bounds,
  * `SetTimes` is a basic search that constructs the solution chronologically.
* Propagation levels for individual types of constraints. A higher level means a more complex algorithm and more propagation but also more time spent on the propagation. Basic propagation levels are usually enough for `LNS` search type. On the other hand, `FDS` works better with higher propagation levels. Propagation levels are:
  * `--noOverlapPropgationLevel 1-4`. The default is 2.
  * `--cumulPropagationLevel 1-3`. The default is 1.
  * `--reservoirPropagationLevel 1-2`. The default is 1.

### Parameters for individual workers

Engine parameters can also be set for individual workers. The syntax is `--workerN.param value`, where `N` is a worker number (starting from 0). Workers cooperate by sharing information about the best solution found so far. A combination of multiple search types usually works better than a single search type. For example, to run `FDS` search on worker 0 with more propagation and `LNS` search (the default) on the second worker, use the following command line:

```sh
node jobshop.mjs data/la17.txt --nbWorkers 2 --worker0.searchType fds --worker0.noOverlapPropagationLevel 4
```

## Running multiple benchmarks

Besides running each benchmark instance separately, running multiple instances (of the same benchmark) in a sequence is also possible. Just provide multiple data files on the command line. For example, let's run nine jobshop instances `la0*`:

```sh
node jobshop.mjs data/la0*.txt --nbWorkers 2 --worker0.searchType fds --worker0.noOverlapPropagationLevel 4
```

The output will look like this:

```text
Number of solves to run: 9
   Run Model              Status   Objective  LowerBound        Time    Sol.time   Solutions   LNS steps    Restarts    Branches
--------------------------------------------------------------------------------------------------------------------------------
     1 jobshop_la01      Optimum         666         666        0.00        0.00           5          11           0        1028
     2 jobshop_la02      Optimum         655         655        0.02        0.01          23         188           7       14704
     3 jobshop_la03      Optimum         597         597        0.01        0.01          23          84           4       10316
     4 jobshop_la04      Optimum         590         590        0.01        0.01          24          85           3        9822
     5 jobshop_la05      Optimum         593         593        0.00        0.00           2           4           0         246
     6 jobshop_la06      Optimum         926         926        0.00        0.00           3           4           0         348
     7 jobshop_la07      Optimum         890         890        0.01        0.00          15          20           2        3995
     8 jobshop_la08      Optimum         863         863        0.00        0.00           4          10           1        1280
     9 jobshop_la09      Optimum         951         951        0.00        0.00           3           4           0         327
--------------------------------------------------------------------------------------------------------------------------------
                          Mean:   747.888889  747.888889        0.01        0.00       11.33          46           2        4674
                      Std. Dev:   155.501161  155.501161        0.00        0.00        9.79          63           2        5493
                           Min:   590.000000  590.000000        0.00        0.00        2.00           4           0         246
                           Max:   951.000000  951.000000        0.02        0.01       24.00         188           7       14704
```

Instead of individual engine logs, the benchmark will print a table with statistics for all runs. The logs can be saved using the `--log` [option](https://optalcp.com/docs/api/type-aliases/BenchmarkParameters#log).

Similarly, a benchmark instance can be run multiple times with different [random seeds](https://optalcp.com/docs/api/type-aliases/Parameters#randomseed) using command-line parameter `--nbSeeds`.

On a CPU with enough cores, multiple benchmarks can run in parallel. For example, to run ten instances of `la3*`, five instances in parallel, each instance using two workers, use the following command line:

```sh
node jobshop.mjs data/la3*.txt --nbParallelRuns 5 --nbWorkers 2 --worker0.searchType fds --worker0.noOverlapPropagationLevel 4
```
In this case, as individual instances run in parallel, they don't have to finish in the same order as they were started. As a result, the order of the models in the output does not have to be the same as the order in the command line.

## Collecting the results

Besides printing the results on the standard output, the benchmark can save them to a CSV or JSON file. To do so, use the `--summary filename.csv` and/or `--result filename.json`:

```sh
node jobshop.mjs data/la3*.txt --summary la3_2w.csv --result la3_2w.json --worker0.searchType fds --worker0.noOverlapPropagationLevel 4 --nbWorkers 2
```

The produced CSV file contains all the information printed on the console and a few additional columns. The JSON file contains even more information (such as objective values of all solutions found and the times when they were found). In particular, the JSON file contains an array of [BenchmarkResults](https://optalcp.com/docs/api/type-aliases/BenchmarkResult).

## Exporting models in JSON

Node.js communicates with the solver executable `optalcp` using JSON messages. To solve a benchmark instance, Node.js first encodes it in JSON and sends it to the solver. JSON encoding of a benchmark can also be saved to a file. To do so, use the `--exportJSON` option. In combination with `--dontSolve`, the solver is not called, and only the JSON file is created:

```sh
node jobshop.mjs data/la17.txt --exportJSON la17.json --dontSolve --nbWorkers 2
```

Note that engine parameters are also saved in the JSON file. The model stored in a JSON file can solved using `utils/solveJSON.mjs`:

```sh
node utils/solveJSON.mjs la17.json --nbWorkers 4
```

Note that the parameters stored in the file can be overridden. The script `utils/solveJSON.mjs` accepts the same command-line options as any other benchmark script and can also solve multiple models (even in parallel).

## Running benchmarks with CP Optimizer

Benchmark models can also be exported into a text format that is very similar to the `.cpo` file format used by [IBM ILOG CPLEX CP Optimizer](https://www.ibm.com/products/ilog-cplex-optimization-studio/cplex-cp-optimizer). The exported file is not guaranteed to be the correct `.cpo` file as OptalCP and CP Optimizer languages are slightly different (for example, OptalCP supports optional integer expressions, but CP Optimizer doesn't). However, for the current benchmarks, the export works well. To export a model, use the `--exportTxt` option:

```sh
node jobshop.mjs data/la17.txt --exportTxt la17.cpo --dontSolve
```

Unlike the JSON export, the file does not contain engine parameters. The model can then be solved, e.g., by the `cpoptimizer` command-line tool.

Alternatively, the directory [`solveCPOs`](solveCPOs) provides a C++ source code of a simple program that can solve the exported `.cpo` models using CP Optimizer (you need CP Optimizer to compile it). In addition, `solveCPOs` can export the results in CSV and JSON files with the same structure as all the other OptalCP benchmarks. This way, it is possible to compare the results of OptalCP and CP Optimizer.

## Comparing the results

Results store in JSON files can be compared using [`compare`](compare) utility. The utility generates static HTML pages such as [this comparison of OptalCP and CP Optimizer on Flexible Jobshop benchmark](https://optalcp.com/benchmarks/flexible-jobshop/main.html).
