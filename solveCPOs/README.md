# solveCPOs - CP Optimizer Benchmark Runner

A utility that solves `.cpo` models using [IBM ILOG CP Optimizer](https://www.ibm.com/products/ilog-cplex-optimization-studio/cplex-cp-optimizer) and produces results in the same format as OptalCP benchmarks. This enables direct comparison between solvers using the [compare](../compare/) tool.

## Prerequisites

- IBM ILOG CPLEX Studio installed
- Environment variable `CPLEXINSTALL` pointing to the installation directory (the directory should contain `cpoptimizer/examples` subdirectory)
- Linux with CPLEX 22.0 (Mac and Windows require Makefile modifications - contributions welcome)

## Building

```sh
export CPLEXINSTALL=/path/to/cplex/studio
cd solveCPOs
make
```

See the [Makefile](Makefile) for compiler flags. If you have a different platform or CPLEX version, check how CP Optimizer examples in `$CPLEXINSTALL/cpoptimizer/examples` are compiled and adjust accordingly.

## Usage

```sh
./solveCPOs [options] [CP Optimizer parameters] model1.cpo [model2.cpo ...]
```

### Options

| Option | Description |
|--------|-------------|
| `--help` | Show usage information |
| `--summary <file.csv>` | Write results summary to CSV |
| `--output <file.json>` | Write detailed results to JSON |
| `--cpu <name>` | CPU name for reports (recommended) |
| `--nbParallelRuns <n>` | Run multiple models in parallel |

### CP Optimizer Parameters

Any unrecognized `--param value` argument is passed to CP Optimizer:

```sh
./solveCPOs --workers 4 --timeLimit 60 model.cpo
```

## Example Workflow

Export a model from OptalCP, solve with CP Optimizer, then compare:

```sh
# Export model
node benchmarks/jobshop/jobshop.mjs benchmarks/jobshop/data/la17.txt \
  --exportText la17.cpo --dontSolve

# Solve with CP Optimizer
./solveCPOs --workers 4 --timeLimit 60 \
  --summary cpo_results.csv --output cpo_results.json \
  --cpu "Intel Core i7-10700" \
  la17.cpo

# Compare results (see ../compare/README.md)
```

## Output Format

The JSON output is compatible with OptalCP benchmark results and includes:
- Objective value and lower bound
- Solution history with timestamps
- Lower bound history
- Statistics (branches, fails, memory, etc.)

This allows using the [compare](../compare/) tool to generate comparison reports.
