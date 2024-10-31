import { spawn } from 'node:child_process';
import * as readline from 'node:readline';
import * as events from 'node:events';
import * as CP from '@scheduleopt/optalcp';
// Reuse existing jobshop model:
import * as jobshopModeler from '../jobshop/modeler.mjs';

let params: CP.Parameters = {
  usage: "Usage: node jobshop-talk.mjs [OPTIONS] INPUT_FILE"
};

let restArgs = CP.parseSomeParameters(params);
if (restArgs.length != 1) {
  console.error(params.usage);
  process.exit(1);
}

let filename = restArgs[0];

let solver = new CP.Solver;
let model = jobshopModeler.defineModel(filename);

// Create a Map from variable names to variables for fast access:
let vars = new Map<string, CP.IntervalVar>();
for (const v of model.getIntervalVars())
  vars.set(v.getName()!, v);

// Launch the heuristic solver as a child subprocess:
console.log("Starting heuristics subprocess...");
let heuristics = spawn('node', ['jobshop-heuristics.mjs', filename], { windowsHide: true });
heuristics.on('error', (err: any) => {
  console.error("Failed to start the heuristics subprocess: ", err);
  process.exit(1);
});
// Create readline interface to read the output of the child process line by line:
let heuristicsPipe = readline.createInterface({ input: heuristics.stdout, terminal: false , crlfDelay: Infinity });

// Each time a line arrives, parse it as a JSON object and then pass it as a
// solution to CP:
heuristicsPipe.on('line', async line => {
  let data = JSON.parse(line);
  let solution = new CP.Solution;
  solution.setObjective(data.makespan);
  // No error checking. We assume that the solution contains all the variables
  // with correct names.
  for (const t of data.schedule)
    solution.setValue(vars.get(t.name)!, t.start, t.end);
  solver.sendSolution(solution);
});

// Each time a solution is found, let the heuristics know about it (currently
// only makespan is sent):
solver.on('solution', async (msg: CP.SolutionEvent) => {
  // SolutionEvent contains the solution and also some statistics about the solving process.
  let solution = msg.solution;
  let schedule: { name: string, start: number, end: number }[] = [];
  for (const v of model.getIntervalVars()) {
    // Absent intervals are simply omitted from the schedule:
    if (solution.isAbsent(v))
      continue;
    let start = solution.getStart(v)!;
    let end = solution.getEnd(v)!;
    schedule.push({ name: v.getName()!, start: start, end: end });
  }
  heuristics.stdin.write(JSON.stringify({ makespan: msg.solution.getObjective() }) + "\n");
});

// Just to avoid having await in the top-level code:
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
