import * as CP from '@scheduleopt/optalcp';
import * as utils from '../../utils/utils.mjs';

export function defineModel(filename: string): CP.Model {
  let input = utils.readFileAsNumberArray(filename);
  let model = new CP.Model(utils.makeModelName("jobshop-tt", filename));
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
      let operation = model.intervalVar({
        length: duration,
        name: "J" + (i + 1) + "O" + (j + 1) + "M" + machineId
      });
      // Operation requires some machine:
      machines[machineId].push(operation);
      // Operation has a predecessor:
      if (prev !== undefined)
        prev.endBeforeStart(operation);
      prev = operation;
    }
    // End time of the job is end time of the last operation:
    ends.push((prev as CP.IntervalVar).end());
  }

  // Tasks on each machine cannot overlap:
  const maxTT = 20;
  for (let j = 0; j < nbMachines; j++) {
    // Create random transition times. Start by creating an array 2D points:
    let points: { x: number, y: number }[] = [];
    for (let i = 0; i < nbJobs; i++)
      points.push({ x: Math.round(Math.random() * maxTT), y: Math.round(Math.random() * maxTT) });
    let matrix: number[][] = [];
    let types: number[] = [];
    for (let i = 0; i < nbJobs; i++) {
      types[i] = i;
      matrix[i] = [];
      for (let k = 0; k < nbJobs; k++)
        matrix[i][k] = Math.round(Math.sqrt(Math.pow(points[i].x - points[k].x, 2) + Math.pow(points[i].y - points[k].y, 2)));
    }
    model.noOverlap(model.sequenceVar(machines[j], types), matrix);
  }

  // Minimize the makespan:
  let makespan = model.max(ends);
  makespan.minimize();

  return model;
}

// Default time limit unless specified on command line:
let params = {
  usage: "Usage: node jobshop.js [OPTIONS] INPUT_FILE1 [INPUT_FILE2] .."
};
// Let CP parse the remaining options:
let restArgs = CP.parseSomeBenchmarkParameters(params);
CP.benchmark(defineModel, restArgs, params);
