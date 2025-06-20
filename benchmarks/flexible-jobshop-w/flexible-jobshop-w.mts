import * as CP from '@scheduleopt/optalcp';
import * as utils from '../../utils/utils.mjs';
import { strict as assert } from 'assert';
import * as fs from 'fs';

type ModelWithVariables = {
  model: CP.Model;
  // For each operation (order by job and then by operation), all its possible modes:
  allModes: CP.IntervalVar[][];
}

function defineModelAndModes(filename: string): ModelWithVariables {
  // Read the input file into a string, possibly unzip it if it ends with .gz:
  let inputText = utils.readFile(filename);
  // The first line may contain 2 or 3 numbers. The third number should be ignored.
  // Therefore find end of the first line:
  let firstEOL = inputText.indexOf('\n');
  // The first line has the following format:
  // <nbJobs> <nbMachines> <nbWorkers> (avg number of machines per operation)
  // The avg number of machines per operation is optional and it is in brackets. This model does not use it.
  // Convert first line into an array of numbers. Ignore characters '(' and ')'.
  let firstLine = inputText.slice(0, firstEOL).trim().replace(/[()]/g, '').split(/\s+/).map(Number);
  // Similarly convert the rest of the file into an array of numbers:
  let input = inputText.slice(firstEOL+1).trim().split(/\s+/).map(Number);

  let model = new CP.Model(utils.makeModelName('flexible-jobshop-w', filename));
  const nbJobs = firstLine[0] as number;
  const nbMachines = firstLine[1] as number;
  const nbWorkers = firstLine[2] as number;
  console.log(`FJSSP-W with ${nbMachines} machines, ${nbJobs} jobs and ${nbWorkers} workers.`);

  // For each machine create an array of operations executed on it.
  // Initialize all machines by empty arrays:
  let machines: CP.IntervalVar[][] = [];
  for (let j = 0; j < nbMachines; j++)
    machines[j] = [];
  // Similarly for workers:
  let workers: CP.IntervalVar[][] = [];
  for (let w = 0; w < nbWorkers; w++)
    workers[w] = [];

  // End times of each job:
  let ends: CP.IntExpr[] = [];

  let allModes: CP.IntervalVar[][] = [];

  for (let i = 0; i < nbJobs; i++) {
    let nbOperations = input.shift() as number;
    // Previous task in the job:
    let prev: CP.IntervalVar | undefined = undefined;
    for (let j = 0; j < nbOperations; j++) {
      // Create a new operation (master of alternative constraint):
      let operation = model.intervalVar({ name: `J${i + 1}O${j + 1}` });
      let nbMachineChoices = input.shift() as number;
      let modes: CP.IntervalVar[] = [];
      for (let k = 0; k < nbMachineChoices; k++) {
        const machineId = input.shift() as number;
        let nbWorkerChoices = input.shift() as number;
        for (let w = 0; w < nbWorkerChoices; w++) {
          const workerId = input.shift() as number;
          const duration = input.shift() as number;
          let mode = model.intervalVar({ length: duration, optional: true, name: `J${i + 1}O${j + 1}_M${machineId}W${workerId}` });
          // In the input file machines are counted from 1, we count from 0. The same for workers.
          machines[machineId - 1].push(mode);
          workers[workerId - 1].push(mode);
          modes.push(mode);
        }
      }
      model.alternative(operation, modes);
      allModes.push(modes);
      // Operation has a predecessor:
      if (prev !== undefined)
        prev.endBeforeStart(operation);
      prev = operation;
    }
    // End time of the job is end time of the last operation:
    ends.push((prev as CP.IntervalVar).end());
  }

  // Tasks on each machine cannot overlap:
  for (let j = 0; j < nbMachines; j++)
    model.noOverlap(machines[j]);
  // Tasks on each worker cannot overlap:
  for (let w = 0; w < nbWorkers; w++)
    model.noOverlap(workers[w]);

  // Minimize the makespan:
  let makespan = model.max(ends);
  makespan.minimize();

  // There shouldn't be anything more in the input:
  assert(input.length == 0);

  return { model, allModes };
}

// Run the FJSSP-W model and write the solution to a JSON file.
// The solution consists of 3 vectors for the FJSSP-W:
//   * the first one containing the start times of each operation,
//   * the second the assigned machine for each operation,
//   * and the third the assigned worker for each operation.
// The order of the operations is fixed across all of these vectors.
async function runFJSSPWJson(inputFilename: string, outputJSON: string, params: CP.BenchmarkParameters) {
  let { model, allModes } = defineModelAndModes(inputFilename);
  let result = await CP.solve(model, params);
  let solution = result.bestSolution;
  let startTimes = [];
  let machineAssignments = [];
  let workerAssignments = [];
  if (solution) {
    for (const modes of allModes) {
      for (const modeVar of modes) {
        if (solution.isAbsent(modeVar))
          continue;
        const start = solution.getStart(modeVar);
        const machineId = modeVar.getName()!.match(/M(\d+)/)?.[1];
        assert(machineId !== undefined);
        const workerId = modeVar.getName()!.match(/W(\d+)/)?.[1];
        assert(workerId !== undefined);
        startTimes.push(start);
        machineAssignments.push(parseInt(machineId));
        workerAssignments.push(parseInt(workerId));
        break; // Only one mode can be assigned to the operation.
      }
    }
  }
  let output = {
    objectiveHistory: result.objectiveHistory,
    lowerBoundHistory: result.lowerBoundHistory,
    startTimes,
    machineAssignments,
    workerAssignments
  };
  fs.writeFileSync(outputJSON, JSON.stringify(output));
}

// A function usable for CP.benchmark():
function defineModel(filename: string): CP.Model {
  return defineModelAndModes(filename).model;
}

// Default parameter settings that can be overridden on command line:
let params: CP.BenchmarkParameters = {
  usage: "Usage: node flexible-jobshop-w.mjs [OPTIONS] INPUT_FILE1 [INPUT_FILE2] ..\n\n" +
    "Output options:\n" +
    "  --fjssp-w-json <filename>  Write the solution, LB and UB history to a JSON file.\n" +
    "                             Only single input file is supported."
};

let commandLineArgs = process.argv.slice(2);
let fjsspWJsonFilename = utils.getStringOption("--fjssp-w-json", "", commandLineArgs);

if (fjsspWJsonFilename === "") {
  let restArgs = CP.parseSomeBenchmarkParameters(params, commandLineArgs);
  CP.benchmark(defineModel, restArgs, params);
} else {
  let restArgs = CP.parseSomeParameters(params, commandLineArgs);
  if (restArgs.length !== 1) {
    console.error("Error: --fjssp-w-json option requires exactly one input file.");
    process.exit(1);
  }
  runFJSSPWJson(restArgs[0], fjsspWJsonFilename, params);
}
