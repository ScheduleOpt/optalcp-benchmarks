# OptalCP Benchmark Collection

This repository contains benchmarks for the [OptalCP](https://www.optalcp.com) constraint programming solver. Each benchmark includes data, solver implementations (TypeScript and Python), and reference results.

Visualizations of the results can be found at [optalcp.com/docs/benchmarks](https://optalcp.com/docs/benchmarks/).

## Benchmarks

### Scheduling

| Benchmark | Description |
|-----------|-------------|
| [Jobshop (JSSP)](benchmarks/jobshop/) | Classic job shop scheduling |
| [Jobshop with operators](benchmarks/jobshop-operators/) | Machines require operators to run |
| [Jobshop with travel times](benchmarks/jobshop-tt/) | Travel time between machines |
| [Blocking Jobshop](benchmarks/blocking-jobshop/) | No intermediate buffers between machines |
| [Flexible Jobshop](benchmarks/flexible-jobshop/) | Operations can use alternative machines |
| [Flexible Jobshop with workers](benchmarks/flexible-jobshop-w/) | Flexible jobshop with worker assignment |
| [Openshop](benchmarks/openshop/) | Operations can be processed in any order |
| [Permutation Flowshop](benchmarks/permutation-flowshop/) | Same job order on all machines |
| [Non-permutation Flowshop](benchmarks/non-permutation-flowshop/) | Job order can vary per machine |
| [Distributed Flowshop](benchmarks/distributed-flowshop/) | Flowshop across multiple factories |

### Project Scheduling (RCPSP)

| Benchmark | Description |
|-----------|-------------|
| [RCPSP](benchmarks/rcpsp/) | Resource-constrained project scheduling |
| [Multi-Mode RCPSP](benchmarks/mmrcpsp/) | Activities with alternative modes |
| [RCPSP Max](benchmarks/rcpsp-max/) | Generalized precedence constraints |
| [RCPSP CPR](benchmarks/rcpsp-cpr/) | Critical path with resources |

### Vehicle Routing

| Benchmark | Description |
|-----------|-------------|
| [TSP](benchmarks/tsp/) | Traveling salesman problem |
| [Capacitated VRP](benchmarks/cvrp/) | Vehicle routing with capacity constraints |
| [VRP with Time Windows](benchmarks/vrp-tw/) | Vehicle routing with delivery windows |

### Demos

| Demo | Description |
|------|-------------|
| [External solutions](benchmarks/demo-external-solutions/) | Hybrid search with custom heuristics |

## Installation

### TypeScript

Requires [Node.js](https://nodejs.org/) 20+ and [git](https://git-scm.com/).

```sh
git clone https://github.com/ScheduleOpt/optalcp-benchmarks.git
cd optalcp-benchmarks
npm install
npx tsc
```

### Python

Requires Python 3.11+ and [uv](https://docs.astral.sh/uv/).

```sh
git clone https://github.com/ScheduleOpt/optalcp-benchmarks.git
cd optalcp-benchmarks
uv sync
```

Both installations include the preview version of OptalCP, which can solve all benchmarks. The preview version reports objective values but not individual variable values. Academic and commercial editions with full functionality are available at [optalcp.com](https://www.optalcp.com). Academic licenses are free.

## Running a Benchmark

Each benchmark has a subdirectory in `benchmarks/`. For example, to solve jobshop instance `la17`:

**TypeScript:**
```sh
node benchmarks/jobshop/jobshop.mjs benchmarks/jobshop/data/la17.txt
```

**Python:**
```sh
uv run benchmarks/jobshop/jobshop.py benchmarks/jobshop/data/la17.txt
```

Common options:

```sh
--timeLimit 60      # Stop after 60 seconds
--nbWorkers 4       # Use 4 CPU threads
--preset Large      # Use preset for large problems
```

All benchmarks accept `--help` for the full list of options.

**Note:** The TypeScript version supports additional features like parallel benchmark runs, result collection, and model export. These features are coming to Python soon. See [USAGE.md](USAGE.md) for details.

## Advanced Usage

See [USAGE.md](USAGE.md) for:

- Solver presets and parameters
- Running multiple instances
- Collecting results (CSV/JSON)
- Exporting models
- Comparing with CP Optimizer

## Repository Structure

```
benchmarks/<name>/              Benchmark implementations with data and results
              ├── README.md     Problem description and data sources
              ├── <name>.mts    TypeScript implementation
              ├── <name>.py     Python implementation
              ├── data/         Instance files
              ├── results/      Solver results
              └── references/   Known bounds from literature

compare/       Result comparison tool (see compare/README.md)
solveCPOs/     CP Optimizer wrapper (see solveCPOs/README.md)
```

## License

This benchmark collection is open source under the MIT license. [OptalCP](https://www.optalcp.com) itself is not open source.

Benchmark data in `benchmarks/*/data` comes from various sources listed in each benchmark's README. Most original sources do not specify a license; we provide the data as a mirror for research purposes. Reference bounds in `benchmarks/*/references` are collected from the literature.

## Contributing

Contributions are welcome:

- New benchmark suggestions
- Links to research papers with benchmarks
- Improved bounds or historical results
- Additional instances for existing benchmarks

Contact `petr@vilim.eu`, create a pull request, or [report an issue](https://github.com/ScheduleOpt/optalcp-benchmarks/issues).