import * as zlib from 'node:zlib';
import * as fs from 'node:fs'
import { once, EventEmitter } from 'node:events';
import * as readline from 'node:readline';
import * as timersPromisses from 'node:timers/promises';

// This code is a simple heuristic solver for the jobshop scheduling problem.
// It generates solutions in JSON format and outputs them to stdout, one
// solution per line.
// The format of the JSON is:
//  {
//     makespan: number,
//     schedule: [{ name: string, start: number, end: number }]
//  }
//  It also listens to stdin for external solutions. However only makespan is
//  used, so the incoming JSON messages are expected to be in the format:
//   { makespan: number }

// Input jobshop data as read from a file
type Data = {
  instance: string;
  nbJobs: number;
  nbMachines: number;
  durations: number[][];
  machines: number[][];
  names: string[][];
  preferences: number[][]; // Random numbers that are used to randomize the heuristics
};

function readData(filename: string): Data {

  const s = filename.split('/')
  const instance = s[s.length - 1].replace(/.txt/, '')

  let rawData: string|null = null;
  if (filename.endsWith(".gz"))
    rawData = zlib.gunzipSync(fs.readFileSync(filename), {}).toString();
  else
    rawData = fs.readFileSync(filename, 'utf8')
  const f = rawData.split(/\r?\n/)

  const header = f[0].trim().split(/\s+/)
  const nbJobs = Number(header[0])
  const nbMachines = Number(header[1])

  if (nbJobs <= 0 || nbMachines <= 0) {
    console.error(`Error in ${instance} data`)
    process.exit(1);
  }

  const durations = Array(nbJobs)
  const machines = Array(nbJobs)
  const preferences = Array(nbJobs);
  const names = Array(nbJobs);

  for (let j = 0; j < nbJobs; j++) {
    const data = f[j + 1].trim().split(/\s+/)
    const nbTasks = data.length / 2;
    durations[j] = Array(nbTasks)
    machines[j] = Array(nbTasks)
    preferences[j] = Array(nbTasks)
    names[j] = Array(nbTasks)
    for (let r = 0; r < nbTasks; r++) {
      machines[j][r] = Number(data[2 * r])
      durations[j][r] = Number(data[2 * r + 1])
      preferences[j][r] = 0;
      names[j][r] = `J${j+1}O${r+1}M${machines[j][r]+1}`
    }
  }

  return { instance, nbJobs, nbMachines, durations, machines, names, preferences }
}

// Represents a machine during heuristic search for a solution
type Machine = {
  occupiedUntil: number;    // Time when the last already scheduled task ends
  // Tasks that are ready to be scheduled on this machine.
  // Sorted by heuristicValue.
  candidates: Array<{
    heuristicValue: number,  // We schedule a task with the smallest heuristicValue = minEnd + preference
    minEnd: number,          // Minimum end the tasks. Takes into account predecessor operations in the job and occupiedUntil.
    duration: number,        // Duration of the tasks
    job: number,             // Job number of the task
    operation: number,       // Operation number of the task within the job
    preference: number,      // A random number for heuristic randomization
    name: string             // Name of the task. Cached so we don't have to deal with strings during heuristics
  }>;
};

type ScheduleTask = {
  start: number,
  end: number,
  name: string
}

function updateCandidates(m: Machine) {
  for (let c of m.candidates) {
    c.minEnd = Math.max(m.occupiedUntil + c.duration, c.minEnd);
    c.heuristicValue = c.minEnd + c.preference;
  }
  m.candidates.sort();
}

// Heuristic search for a solution.  If the solution is batter than bestMakespan
// the reports the solution on stdout in JSON format.
// Returns the makespan of the solution.
async function heuristics(data: Data, bestMakespan: number): Promise<number> {

  let machines = Array(data.nbMachines);
  for (let m = 0; m < data.nbMachines; m++)
    machines[m] = {
      occupiedUntil: 0,
      schedule: [],
      candidates: []
    };

  // Initial candidates are first operations of all jobs
  for (let j = 0; j < data.nbJobs; j++) {
    const duration = data.durations[j][0];
    const preference = data.preferences[j][0];
    const m = data.machines[j][0];
    const name = data.names[j][0];
    machines[m].candidates.push({ heuristicValue: duration+preference, minEnd: duration, duration, job: j, operation: 0, preference, name });
  }
  // Sort the candidates by heuristicValue
  for (let m = 0; m < data.nbMachines; m++)
    updateCandidates(machines[m]);

  let schedule: ScheduleTask[] = [];

  for (;;) {
    // Find a candidate with the smallest heuristic value on all machines
    let minHeuristicValue = Infinity;
    let chosenMachine = -1;
    for (let m = 0; m < data.nbMachines; m++) {
      const c = machines[m].candidates[0];
      if (c === undefined)
        continue; // No more candidates on this machine
      if (c.heuristicValue < minHeuristicValue) {
        minHeuristicValue = c.heuristicValue;
        chosenMachine = m;
      }
    }

    if (minHeuristicValue === Infinity)
      break; // No more candidates, everything is scheduled

    // Schedule the selected candidate
    let machine = machines[chosenMachine];
    const candidate = machine.candidates.shift();
    schedule.push({ start: candidate.minEnd - candidate.duration, end: candidate.minEnd, name: candidate.name });
    machine.occupiedUntil = candidate.minEnd;
    updateCandidates(machine);

    // Successor of the selected candidate becomes a candidate
    const job = candidate.job;
    const nextOperation = candidate.operation + 1;
    if (nextOperation < data.durations[job].length) {
      const duration = data.durations[job][nextOperation];
      const preference = data.preferences[job][nextOperation];
      const name = data.names[job][nextOperation];
      const minEnd = candidate.minEnd + duration;
      const m = data.machines[job][nextOperation];
      machines[m].candidates.push({ heuristicValue: minEnd + preference, minEnd, duration, job, operation: nextOperation, preference, name });
      updateCandidates(machines[m]);
    }
  }

  // Compute makespan of the schedule:
  let makespan = 0;
  for (const t of schedule)
    makespan = Math.max(makespan, t.end);

  if (makespan < bestMakespan) {
    // Output the schedule in JSON format for a simple parsing
    process.stdout.write(JSON.stringify({ makespan, schedule }));
    let done = process.stdout.write("\n");
    if (!done) {
      // On Windows, stdout.write is always synchronous. On POSIX systems (e.g.
      // Linux) stdout is buffered when redirected to a pipe.  By waiting for
      // drain event, we make sure the output is flushed.  Otherwise, in the case
      // of very long lines, the buffering somehow makes the output wait for a
      // long time.
      await once(process.stdout, 'drain');
    }
  }
  return makespan;
}

if (process.argv.length != 3) {
  console.error("Usage: node jobshop-heuristics.mjs <filename>");
  process.exit(1);
}
let filename = process.argv[2];
let data = readData(filename);

// Best makespan found so far. By us or by the external solver:
let bestMakespan = Infinity;

// Create readline interface to read the stdin:
let inputPipe = readline.createInterface({ input: process.stdin, terminal: false , crlfDelay: Infinity });
// Whenever a line arrives, parse it as a JSON object and update bestMakespan:
inputPipe.on('line', line => {
  let data = JSON.parse(line);
  bestMakespan = Math.min(bestMakespan, data.makespan);
});

async function run() {
  // First run the heuristics without any randomization
  bestMakespan = await heuristics(data, Infinity);

  // Compute the maximum duration of all tasks
  let maxDuration = 0;
  for (let d of data.durations) {
    for (let dd of d)
      maxDuration = Math.max(maxDuration, dd);
  }

  // Infinite loop. We expect to be killed by the parent process.
  for (; ;) {
    // Randomize the preferences
    for (let d of data.preferences) {
      for (let i = 0; i < d.length; i++)
        d[i] = Math.floor(Math.random() * maxDuration);
    }
    let makespan = await heuristics(data, bestMakespan);
    bestMakespan = Math.min(bestMakespan, makespan);
    // Let the event loop to run so we don't block the process completely:
    await timersPromisses.setImmediate();
  }
}

run();
