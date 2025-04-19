# Generate static HTML comparison of two solvers

The scripts in this directory generate static HTML pages that compare the performance of two solvers (or two versions of the same solver) on a given benchmark set. For example, look here: <https://optalcp.com/benchmarks/flexible-jobshop/main.html>.

Two JSON files generated using the benchmark scripts' `--result` option are the input for the comparison.
In the case of IBM ILOG CP Optimizer, it is possible to generate the JSON file using [`solveCPOs`](../solveCPOs).
Some results files are in the repository in the `benchmarks/*/results` directories.

First, install the necessary dependencies and build the tool:

```sh
cd optalcp-benchmark/compare
npm install
npx tsc
npx webpack
```

Then, for example, to compare OptalCP and CP Optimizer on the Flexible Jobshop benchmark, run:

```sh
node compare.mjs "Flexible Jobshop" OptalCP ../benchmarks/flexible-jobshop/results/Optal-4W-2FDS.json "CP Optimizer" ../benchmarks/flexible-jobshop/results/CPO-4W.json html-flexible-jobshop
```

Where:

* `Flexible Jobshop` is the heading of the main generated page
* `OptalCP` is the name of the first solver
* `../benchmarks/flexible-jobshop/results/Optal-4W-2FDS.json` is a data file with the results of the first solver
* `CP Optimizer` is the name of the second solver
* `../benchmarks/flexible-jobshop/results/CPO-4W.json` is a data file with the results of the second solver
* `html-flexible-jobshop` is the output directory (will be created if it doesn't exist)

The output directory will contain the file `main.html,` which is the entry point for the generated pages. It will contain links to individual problem instances and a summary table with the results. The generated pages are static; they can be directly opened in a web browser, sent by email, etc.
