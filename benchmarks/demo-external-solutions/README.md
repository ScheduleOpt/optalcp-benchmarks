# Demo: external solutions during the search

OptalCP solver can run in parallel with another solver (e.g., a hand-written heuristics). The two solvers can share solutions asynchronously. OptalCP can use external solutions to limit the search space (search only for better solutions) and further improve the solutions through the Large Neighborhood Search (when `searchType=LNS`).

The implementation is based on the function [`Solver.sendSolution`](https://optalcp.com/docs/api/classes/Solver#sendsolution).

This directory contains a demo of such a setup for the jobshop problem. There are two files:

* [`jobshop-heuristics.mts`](jobshop-heuristics.mts): simplistic randomized greedy heuristic that generates solutions for the jobshop problem. For the demo, the heuristic is implemented in TypeScript. However, it can be implemented in any language as it runs as a separate process.
* [`jobshop-talk.mts`](jobshop-talk.mts): a script that runs OptalCP and the heuristics in parallel.

The `jobshop-heuristics` writes the solutions in JSON format to the standard output, one solution per line. The format of each generated JSON message is:

```jsonschema
{
  makespan: number,
  schedule: [{ name: string, start: number, end: number }]
}
```

Then, `jobshop-talk` reads the solutions from the standard output of `jobshop-heuristics`, converts them to the format expected by OptalCP, and sends them asynchronously to OptalCP using the `Solver.sendSolution` function.

On the other hand, when OptalCP finds a solution, then `jobshop-talk` converts it to the format expected by `jobshop-heuristics` and (asynchronously) writes it to the standard input of `jobshop-heuristics`. As `jobshop-heuristics` is a greedy heuristic, it is interested only in the makespan of the solution. Therefore, the format of the JSON message sent from OptalCP to `jobshop-heuristics` is as follows:

```jsonschema
{
  makespan: number
}
```

Once OptalCP stops (due to optimality proof or a time limit), `jobshop-talk` kills the `jobshop-heuristics` process. Therefore, the time limit is not implemented in `jobshop-heuristics.`

## How to run the demo

TypeScript files must be compiled to JavaScript before running the demo (using `npx tsc`, see [`../../README.md`](../../README.md)). Then, run the following commands:

```sh
cd optalcp-benchmarks/benchmarks/demo-external-solutions
node jobshop-talk.mjs --nbWorkers 2 --worker0.searchType FDS --worker0.noOverlapPropagationLevel 4 ../jobshop/data/taillard/ta80.txt
```

`jobshop-talk` accepts the same arguments as all other benchmarks. In the above command, we use FDS search in worker 0 and LNS search in worker 1.
