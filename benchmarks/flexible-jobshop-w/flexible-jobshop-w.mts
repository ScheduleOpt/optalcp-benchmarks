// Flexible Job Shop Scheduling Problem with Worker Flexibility (FJSSP-W)
//
// FJSSP-W extends the classical Flexible Job Shop Scheduling Problem by adding
// worker flexibility constraints. Each job consists of a sequence of operations
// that must be executed in order. Each operation can be processed on one of
// several eligible machines, and additionally requires a worker to be present.
// The processing time depends on both the machine and worker assignment.
// The goal is to minimize the makespan (total completion time of all jobs).
//
// Constraints:
//   - Operations within a job must be executed sequentially (precedence)
//   - Each machine can process at most one operation at a time (no overlap)
//   - Each worker can work on at most one operation at a time (no overlap)
//   - Each operation must be assigned to exactly one (machine, worker) pair
//
// Reference: Hutter et al. "A Benchmarking Environment for Worker Flexibility
// in Flexible Job Shop Scheduling Problems", arXiv:2501.16159, 2025.

import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as zlib from "node:zlib";
import * as CP from "@scheduleopt/optalcp";

function readFile(filename: string): string {
  return filename.endsWith(".gz")
    ? zlib.gunzipSync(fs.readFileSync(filename), {}).toString()
    : fs.readFileSync(filename, "utf8");
}

function makeModelName(benchmarkName: string, filename: string): string {
  const instance = filename
    .replaceAll(/[/\\]/g, "_")
    .replace(/^data_/, "")
    .replace(/\.gz$/, "")
    .replace(/\.json$/, "")
    .replace(/\....?$/, "");
  return `${benchmarkName}_${instance}`;
}

let flatAlternatives = false;
let redundantCumul = false;
let verbose = false;

function defineModel(filename: string): CP.Model {
  // Read the input file into a string, possibly unzip it if it ends with .gz:
  const inputText = readFile(filename);
  // The first line may contain 2 or 3 numbers. The third number should be ignored.
  // Therefore find end of the first line:
  const firstEOL = inputText.indexOf('\n');
  // The first line has the following format:
  // <nbJobs> <nbMachines> <nbWorkers> (avg number of machines per operation)
  // The avg number of machines per operation is optional and it is in brackets. This model does not use it.
  // Convert first line into an array of numbers. Ignore characters '(' and ')'.
  const firstLine = inputText.slice(0, firstEOL).trim().replace(/[()]/g, '').split(/\s+/).map(Number);
  // Similarly convert the rest of the file into an array of numbers:
  const input = inputText.slice(firstEOL+1).trim().split(/\s+/).map(Number);

  const model = new CP.Model(makeModelName('flexible-jobshop-w', filename));
  const nbJobs = firstLine[0];
  const nbMachines = firstLine[1];
  const nbWorkers = firstLine[2];
  if (verbose)
    console.log(`FJSSP-W with ${nbMachines} machines, ${nbJobs} jobs and ${nbWorkers} workers.`);

  // For each machine/worker, an array of operations executed on it:
  const machines: CP.IntervalVar[][] = Array.from({ length: nbMachines }, () => []);
  const workers: CP.IntervalVar[][] = Array.from({ length: nbWorkers }, () => []);

  // End times of each job:
  const ends: CP.IntExpr[] = [];

  // For --redundantCumul: cumulative pulses across all operations
  const allOperations: CP.CumulExpr[] = [];

  let idx = 0; // Index for reading input array

  for (let i = 0; i < nbJobs; i++) {
    const nbOperations = input[idx++];
    // Previous task in the job:
    let prev: CP.IntervalVar | undefined = undefined;
    for (let j = 0; j < nbOperations; j++) {
      // Create a new operation (master of alternative constraint):
      const operation = model.intervalVar({ name: `J${i + 1}O${j + 1}` });
      if (redundantCumul)
        allOperations.push(operation.pulse(1));
      const nbMachineChoices = input[idx++];
      const modes: CP.IntervalVar[] = [];
      const variantsOnWorker: CP.IntervalVar[][] = Array.from({ length: nbWorkers }, () => []);
      const variantsOnMachine: CP.IntervalVar[][] = Array.from({ length: nbMachines }, () => []);
      for (let k = 0; k < nbMachineChoices; k++) {
        const machineId = input[idx++];
        const nbWorkerChoices = input[idx++];
        for (let w = 0; w < nbWorkerChoices; w++) {
          const workerId = input[idx++];
          const duration = input[idx++];
          const mode = model.intervalVar({ length: duration, optional: true, name: `J${i + 1}O${j + 1}_M${machineId}W${workerId}` });
          if (flatAlternatives) {
            // In the input file machines are counted from 1, we count from 0. The same for workers.
            machines[machineId - 1].push(mode);
            workers[workerId - 1].push(mode);
          } else {
            variantsOnMachine[machineId - 1].push(mode);
            variantsOnWorker[workerId - 1].push(mode);
          }
          modes.push(mode);
        }
      }
      if (flatAlternatives)
        model.alternative(operation, modes);
      else {
        const operationsOnMachine: CP.IntervalVar[] = [];
        for (let m = 0; m < nbMachines; m++) {
          if (variantsOnMachine[m].length > 0) {
            const subOperation = model.intervalVar({ name: `J${i + 1}O${j + 1}_M${m + 1}`, optional: true });
            model.alternative(subOperation, variantsOnMachine[m]);
            operationsOnMachine.push(subOperation);
            machines[m].push(subOperation);
          }
        }
        model.alternative(operation, operationsOnMachine);
        const operationsOnWorker: CP.IntervalVar[] = [];
        for (let w = 0; w < nbWorkers; w++) {
          if (variantsOnWorker[w].length > 0) {
            const subOperation = model.intervalVar({ name: `J${i + 1}O${j + 1}_W${w + 1}`, optional: true });
            model.alternative(subOperation, variantsOnWorker[w]);
            operationsOnWorker.push(subOperation);
            workers[w].push(subOperation);
          }
        }
        model.alternative(operation, operationsOnWorker);
      }

      // Operation has a predecessor:
      if (prev !== undefined)
        prev.endBeforeStart(operation);
      prev = operation;
    }
    // End time of the job is end time of the last operation:
    ends.push((prev as CP.IntervalVar).end());
  }

  // Tasks on each machine cannot overlap:
  for (let m = 0; m < nbMachines; m++)
    model.noOverlap(machines[m]);
  // Tasks on each worker cannot overlap:
  for (let w = 0; w < nbWorkers; w++)
    model.noOverlap(workers[w]);

  // Redundant cumulative: at most min(nbMachines, nbWorkers) operations simultaneously
  if (redundantCumul)
    model.sum(allOperations).le(Math.min(nbMachines, nbWorkers));

  // Minimize the makespan:
  const makespan = model.max(ends);
  makespan.minimize();

  // There shouldn't be anything more in the input:
  assert(idx === input.length);

  return model;
}

const params: CP.BenchmarkParameters = {
  usage:
    "Usage: node flexible-jobshop-w.mjs [OPTIONS] INPUT_FILE1 [INPUT_FILE2] ..\n\n" +
    "FJSSP-W specific options:\n" +
    "  --flatAlternatives  Don't use hierarchical alternative constraints (for worker and for machine)\n" +
    "  --redundantCumul    Add a redundant cumul constraint\n" +
    "  --verbose           Enable verbose output",
};
const restArgs = CP.parseSomeBenchmarkParameters(params);

const instanceFiles = restArgs.filter((arg) => {
  if (arg === "--flatAlternatives") { flatAlternatives = true; return false; }
  if (arg === "--redundantCumul") { redundantCumul = true; return false; }
  if (arg === "--verbose") { verbose = true; return false; }
  return true;
});

CP.benchmark(defineModel, instanceFiles, params);
