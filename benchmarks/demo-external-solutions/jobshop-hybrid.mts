// This demo runs OptalCP and a heuristic solver (jobshop-heuristics.mts) in
// parallel. The two processes exchange solutions asynchronously via stdin/stdout.
// OptalCP uses external solutions to prune the search space and improve them
// using Large Neighborhood Search (when searchType=LNS).
// See README.md for more details.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as readline from "node:readline";
import * as zlib from "node:zlib";
import * as CP from "@scheduleopt/optalcp";

function readFileAsNumberArray(filename: string): number[] {
  const content = filename.endsWith(".gz")
    ? zlib.gunzipSync(fs.readFileSync(filename), {}).toString()
    : fs.readFileSync(filename, "utf8");
  return content.trim().split(/\s+/).map(Number);
}

function makeModelName(filename: string): string {
  const instance = filename
    .replaceAll(/[/\\]/g, "_")
    .replace(/^data_/, "")
    .replace(/\.gz$/, "")
    .replace(/\.json$/, "")
    .replace(/\....?$/, "");
  return `jobshop_${instance}`;
}

function defineModel(filename: string): CP.Model {
  const input = readFileAsNumberArray(filename);
  const model = new CP.Model(makeModelName(filename));
  let idx = 0;
  const nbJobs = input[idx++];
  const nbMachines = input[idx++];

  // For each machine, an array of operations executed on it:
  const machines: CP.IntervalVar[][] = Array.from({ length: nbMachines }, () => []);

  // End times of each job:
  const ends: CP.IntExpr[] = [];

  for (let i = 0; i < nbJobs; i++) {
    let prev: CP.IntervalVar | undefined = undefined;
    for (let j = 0; j < nbMachines; j++) {
      const machineId = input[idx++];
      const duration = input[idx++];
      const operation = model.intervalVar({
        length: duration,
        name: `J${i + 1}O${j + 1}M${machineId + 1}`
      });
      machines[machineId].push(operation);
      if (prev !== undefined)
        prev.endBeforeStart(operation);
      prev = operation;
    }
    ends.push((prev as CP.IntervalVar).end());
  }

  for (let j = 0; j < nbMachines; j++)
    model.noOverlap(machines[j]);

  const makespan = model.max(ends);
  makespan.minimize();

  return model;
}

const params: CP.Parameters = {
  usage: "Usage: node jobshop-hybrid.mjs [OPTIONS] INPUT_FILE"
};

const restArgs = CP.parseSomeParameters(params);
if (restArgs.length !== 1) {
  console.error(params.usage);
  process.exit(1);
}

const filename = restArgs[0];

const solver = new CP.Solver;
const model = defineModel(filename);

// Handle Ctrl-C gracefully: stop the solver and print summary instead of
// terminating immediately.
process.on('SIGINT', () => {
  solver.stop("Interrupted");
});

// Create a Map from variable names to variables for fast access:
const vars = new Map<string, CP.IntervalVar>();
for (const v of model.getIntervalVars()) {
  assert(v.name !== undefined);
  vars.set(v.name, v);
}

// Launch the heuristic solver as a child subprocess:
console.log("Starting heuristics subprocess...");
const heuristics = spawn("node", ["jobshop-heuristics.mjs", filename], { windowsHide: true });
heuristics.on("error", (err: unknown) => {
  console.error("Failed to start the heuristics subprocess: ", err);
  process.exit(1);
});
// Create readline interface to read the output of the child process line by line:
const heuristicsPipe = readline.createInterface({ input: heuristics.stdout, terminal: false, crlfDelay: Number.POSITIVE_INFINITY });

// Each time a line arrives, parse it as a JSON object and then pass it as a
// solution to CP:
heuristicsPipe.on("line", async line => {
  const data = JSON.parse(line);
  const solution = new CP.Solution;
  solution.setObjective(data.makespan);
  // We assume that the solution contains all the variables with correct names.
  for (const t of data.schedule) {
    const v = vars.get(t.name);
    assert(v !== undefined);
    solution.setValue(v, t.start, t.end);
  }
  solver.sendSolution(solution);
});

// Each time a solution is found, let the heuristics know about it:
solver.onSolution = (msg: CP.SolutionEvent) => {
  const solution = msg.solution;
  const schedule: { name: string, start: number, end: number }[] = [];
  for (const v of model.getIntervalVars()) {
    // Absent intervals are simply omitted from the schedule:
    if (solution.isAbsent(v))
      continue;
    const start = solution.getStart(v);
    const end = solution.getEnd(v);
    assert(start != null && end != null && v.name != null);
    schedule.push({ name: v.name, start, end });
  }
  const makespan = msg.solution.getObjective();
  heuristics.stdin.write(`${JSON.stringify({ makespan, schedule })}\n`);
};

// Main function:
async function run() {
  await solver.solve(model, params);
  // We get here when the search stops. During await, the messages are passed
  // asynchronously.
  // Destroy stdout of the heuristics subprocess. This way, we destroy any
  // unfinished messages that may be in the pipe. Otherwise, we could receive
  // partial message after the kill.
  heuristics.stdout.destroy();
  // Kill the heuristics if it is still running:
  heuristics.kill();
}

run();
