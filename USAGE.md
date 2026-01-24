# Advanced Usage

This guide covers advanced features of the OptalCP benchmarks. For basic installation and running, see [README.md](README.md).

## Solver Parameters

### Presets

Presets configure multiple solver parameters at once. Use `--preset` to select one:

| Preset | Description |
|--------|-------------|
| `Auto` | Automatically selects based on problem size (default) |
| `Default` | Balanced configuration with mixed search strategies |
| `Large` | Optimized for problems with 100k+ variables |

```sh
node benchmarks/jobshop/jobshop.mjs benchmarks/jobshop/data/ta80.txt --preset Large
```

### Common Parameters

| Parameter | Description |
|-----------|-------------|
| `--timeLimit <seconds>` | Stop search after N seconds |
| `--nbWorkers <n>` | Number of CPU threads (default: all cores) |
| `--randomSeed <n>` | Random seed for reproducibility |

### Search Types

Override the search strategy with `--searchType`:

| Type | Description |
|------|-------------|
| `LNS` | Large Neighborhood Search - fast solution finding |
| `FDS` | Failure-Directed Search - good for optimality proofs |
| `FDSLB` | Iteratively proves better lower bounds |
| `SetTimes` | Basic chronological construction |

### Propagation Levels

Higher levels mean stronger propagation but more computation per node:

| Parameter | Range | Default |
|-----------|-------|---------|
| `--noOverlapPropagationLevel` | 1-4 | 2 |
| `--cumulPropagationLevel` | 1-3 | 1 |
| `--reservoirPropagationLevel` | 1-2 | 1 |

### Per-Worker Parameters

Parameters can be set for individual workers using `--workerN.param`:

```sh
node benchmarks/jobshop/jobshop.mjs benchmarks/jobshop/data/la17.txt \
  --nbWorkers 2 \
  --worker0.searchType FDS \
  --worker0.noOverlapPropagationLevel 4 \
  --worker1.searchType LNS
```

Workers cooperate by sharing solutions.

## Running Multiple Instances (TypeScript)

Run multiple instances in sequence by providing multiple files:

```sh
node benchmarks/jobshop/jobshop.mjs benchmarks/jobshop/data/la0*.txt
```

Output is a summary table showing status, objective, bounds, and timing for each instance.

### Parallel Runs

Run multiple instances in parallel with `--nbParallelRuns`:

```sh
node benchmarks/jobshop/jobshop.mjs benchmarks/jobshop/data/la3*.txt \
  --nbParallelRuns 5 \
  --nbWorkers 2
```

This runs 5 instances simultaneously, each using 2 workers.

### Multiple Seeds

Run each instance multiple times with different random seeds:

```sh
node benchmarks/jobshop/jobshop.mjs benchmarks/jobshop/data/la17.txt --nbSeeds 10
```

## Collecting Results (TypeScript)

Save results to files with `--summary` and `--result`:

```sh
node benchmarks/jobshop/jobshop.mjs benchmarks/jobshop/data/la*.txt \
  --summary results.csv \
  --result results.json
```

- **CSV** (`--summary`): Contains the summary table data
- **JSON** (`--result`): Detailed results including all solutions found and timestamps

## Exporting Models (TypeScript)

### JSON Export

Export a model to JSON format:

```sh
node benchmarks/jobshop/jobshop.mjs benchmarks/jobshop/data/la17.txt \
  --exportJSON la17.json \
  --dontSolve
```

Solve the exported model with `npx optalcp`:

```sh
npx optalcp la17.json --nbWorkers 4
```

The `optalcp` command accepts the same parameters as benchmark scripts.

### Text/CPO Export

Export to a format similar to [IBM ILOG CP Optimizer](https://www.ibm.com/products/ilog-cplex-optimization-studio/cplex-cp-optimizer) `.cpo` files:

```sh
node benchmarks/jobshop/jobshop.mjs benchmarks/jobshop/data/la17.txt \
  --exportText la17.cpo \
  --dontSolve
```

The exported file can be solved with the `cpoptimizer` command-line tool. Compatibility is not guaranteed since OptalCP and CP Optimizer languages differ (e.g., OptalCP supports optional expressions that CP Optimizer does not). The export works for all benchmarks in this repository.

## Comparing with CP Optimizer

The [`solveCPOs`](solveCPOs/) directory contains a C++ program that solves exported `.cpo` models using CP Optimizer and produces results in the same JSON format as OptalCP benchmarks. See [solveCPOs/README.md](solveCPOs/README.md).

The [`compare`](compare/) directory contains a tool that generates HTML comparison pages from JSON result files. See [compare/README.md](compare/README.md).

Example comparisons are available at [optalcp.com/docs/benchmarks](https://optalcp.com/docs/benchmarks/).

## Citation

Use the "Cite this repository" link on GitHub to get citations in various formats. The citation is generated from [`CITATION.cff`](CITATION.cff).

Consider citing specific benchmarks by checking their individual README files for credits and references. Adding the access date (`urldate` field) or git commit ID helps with reproducibility.
