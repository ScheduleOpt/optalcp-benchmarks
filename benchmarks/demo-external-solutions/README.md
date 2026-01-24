# Demo: external solutions during the search

OptalCP solver can run in parallel with another solver (e.g., hand-written heuristics). The two solvers can share solutions asynchronously. OptalCP can use external solutions to limit the search space (search only for better solutions) and further improve the solutions through the Large Neighborhood Search (when `searchType=LNS`).

The implementation is based on the function [`Solver.sendSolution`](https://optalcp.com/docs/api/classes/Solver#sendsolution).

This directory contains a demo of the `Solver.sendSolution` API for the jobshop problem. There are two files (in both TypeScript and Python):

* `jobshop-heuristics`: a randomized greedy heuristic that generates solutions for the jobshop problem.
* `jobshop-hybrid`: a script that runs OptalCP and the heuristics in parallel.

**Note:** This is just a demo of the API. The heuristic is simplistic and typically contributes only one solution at the beginning of the search (before OptalCP finds a better one). It is implemented in TypeScript/Python for simplicity. The heuristic can be implemented in any language since communication is via stdin/stdout JSON.

**OptalCP editions:** The preview edition of OptalCP (which is free) hides solution values (all variables appear as 'absent'). However, the objective value is valid. This demo works with the preview edition since only the objective value is used. For full exchange of solutions, the academic or commercial edition is needed. The academic edition is free for academia.

**Performance note:** Processing solutions can have high load. The heuristic should only send solutions that improve upon previously sent ones to avoid overloading the communication. For heuristics that generate many solutions, TypeScript is significantly faster than Python. For best performance, consider implementing the heuristics in a compiled language such C++.

The `jobshop-heuristics` writes the solutions in JSON format to the standard output, one solution per line. The format of each generated JSON message is:

```jsonschema
{
  makespan: number,
  schedule: [{ name: string, start: number, end: number }]
}
```

`jobshop-hybrid` reads the solutions from the standard output of `jobshop-heuristics`, converts them to the format expected by OptalCP, and sends them asynchronously to OptalCP using the `Solver.sendSolution` function.

Conversely, when OptalCP finds a solution, `jobshop-hybrid` converts it to the same JSON format and writes it to the standard input of `jobshop-heuristics`. The current `jobshop-heuristics` implementation only uses the makespan, but the full schedule is available for more sophisticated heuristics.

Once OptalCP stops (due to optimality proof or a time limit), `jobshop-hybrid` kills the `jobshop-heuristics` process. Therefore, the time limit is not implemented in `jobshop-heuristics`.

## How to run the demo

### TypeScript

TypeScript files must be compiled to JavaScript before running the demo (using `npx tsc`, see [`../../README.md`](../../README.md)). Then, run the following commands:

```sh
cd optalcp-benchmarks/benchmarks/demo-external-solutions
node jobshop-hybrid.mjs --nbWorkers 2 ../jobshop/data/taillard/ta80.txt
```

### Python

```sh
cd optalcp-benchmarks/benchmarks/demo-external-solutions
python jobshop-hybrid.py --nbWorkers 2 ../jobshop/data/taillard/ta80.txt
```

`jobshop-hybrid` accepts the same arguments as all other benchmarks. In the above command, we use only 2 workers.
