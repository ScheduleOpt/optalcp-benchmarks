# compare - Solver Comparison Tool

Generates static HTML pages comparing the performance of two solvers (or two versions of the same solver) on a benchmark set.

**Live example:** [OptalCP vs CP Optimizer on Flexible Jobshop](https://optalcp.com/benchmarks/flexible-jobshop/main.html)

## Features

The generated pages include:

- Summary table with status, objective, bounds, and timing for all instances
- Normalized performance plot showing average solution quality over time
- Individual instance pages with detailed objective and lower bound history charts
- Static HTML that works offline (can be opened locally, sent by email, etc.)

## Prerequisites

Requires [Node.js](https://nodejs.org/) 20+.

This is a separate npm project from the main benchmark repository.

## Building

```sh
cd compare
npm install
npx tsc
npx webpack
```

## Input Files

The tool compares two JSON result files. These can come from:

- **OptalCP benchmarks** using the `--result` option
- **CP Optimizer** via [solveCPOs](../solveCPOs/) using the `--output` option
- **Existing results** in `benchmarks/*/results/` directories

Gzipped files (`.json.gz`) are supported.

## Usage

```sh
node compare.mjs <title> <nameA> <fileA.json> <nameB> <fileB.json> <outputDir>
```

| Argument | Description |
|----------|-------------|
| `title` | Page heading |
| `nameA` | Display name for first solver |
| `fileA.json` | Results file for first solver |
| `nameB` | Display name for second solver |
| `fileB.json` | Results file for second solver |
| `outputDir` | Output directory (created if needed) |

### Example

Compare OptalCP and CP Optimizer on the Flexible Jobshop benchmark:

```sh
node compare.mjs "Flexible Jobshop" \
  "OptalCP" ../benchmarks/flexible-jobshop/results/Optal-4W-2FDS.json \
  "CP Optimizer" ../benchmarks/flexible-jobshop/results/CPO-4W.json \
  html-flexible-jobshop
```

## Output

The output directory contains:

- `main.html` - Entry point with summary table and normalized plots
- `<instance>.html` - Detailed page for each problem instance
- Supporting JS/CSS files

Open `main.html` in a browser to view the comparison.
