import * as CP from '@scheduleopt/optalcp';
import * as utils from '../../utils/utils.mjs';

function defineModel(filename: string): CP.Model {
  let input = utils.readFileAsNumberArray(filename);
  let model = new CP.Model(utils.makeModelName("blocking-jobshop", filename));
  const nbJobs = input.shift() as number;
  const nbMachines = input.shift() as number;

  // For each machine create an array of operations executed on it.
  // Initialize all machines by empty arrays:
  let machines: CP.IntervalVar[][] = [];
  for (let j = 0; j < nbMachines; j++)
    machines[j] = [];

  // End times of each job:
  let ends: CP.IntExpr[] = [];

  for (let i = 0; i < nbJobs; i++) {
    // Previous task in the job:
    let prev: CP.IntervalVar | undefined = undefined;
    for (let j = 0; j < nbMachines; j++) {
      // Create a new operation:
      const machineId = input.shift() as number;
      const duration = input.shift() as number;
      // Last operation of the job has fixed duration (non-blocking):
      const maxDuration = j < nbMachines - 1 ? CP.IntervalMax : duration;
      let operation = model.intervalVar({
        length: [duration, maxDuration],
        name: "J" + (i + 1) + "O" + (j + 1) + "M" + machineId
      });
      // Operation requires some machine:
      machines[machineId].push(operation);
      // Operation has a predecessor:
      if (prev !== undefined)
        prev.endAtStart(operation)
      prev = operation;
    }
    // End time of the job is end time of the last operation:
    ends.push((prev as CP.IntervalVar).end());
  }

  // Tasks on each machine cannot overlap:
  for (let j = 0; j < nbMachines; j++)
    model.noOverlap(machines[j]);

  // Minimize the makespan:
  let makespan = model.max(ends);
  makespan.minimize();

  return model;
}

let params: CP.BenchmarkParameters = {
  usage: "Usage: node blocking-jobshop.mjs [OPTIONS] INPUT_FILE [INPUT_FILE2] .."
};
let restArgs = CP.parseSomeBenchmarkParameters(params);
CP.benchmark(defineModel, restArgs, params);