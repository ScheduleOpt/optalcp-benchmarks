import * as CP from '@scheduleopt/optalcp';
import * as utils from '../../utils/utils.mjs';

function defineModel(filename: string): CP.Model {
  let input = utils.readFileAsNumberArray(filename);
  let model = new CP.Model(utils.makeModelName("openshop", filename));

  const nbJobs = input.shift() as number;
  const nbMachines = input.shift() as number;

  // For each machine create an array of operations executed on it.
  // Initialize all machines by empty arrays:
  let machines: CP.IntervalVar[][] = [];
  for (let m = 0; m < nbMachines; m++)
    machines[m] = [];

  // Similarly for each job create an array of its operations:
  let jobs: CP.IntervalVar[][] = [];
  for (let j = 0; j < nbJobs; j++)
    jobs[j] = [];

  // End times of all operations:
  let ends: CP.IntExpr[] = [];

  // Longest operation (for symmetry breaking):
  let longest: CP.IntervalVar|null = null;
  let maxLength = 0;

  for (let j = 0; j < nbJobs; j++) {
    for (let m = 0; m < nbMachines; m++) {
      // Create a new operation:
      const duration = input.shift() as number;
      let operation = model.intervalVar().setLength(duration).setName("J" + (j + 1) + "M" + (m + 1));
      machines[m].push(operation);
      jobs[j].push(operation);
      ends.push(operation.end());
      if (maxLength < duration) {
        maxLength = duration;
        longest = operation;
      }
    }
  }

  // Tasks on each machine cannot overlap:
  for (let m = 0; m < nbMachines; m++)
    model.noOverlap(machines[m]);
  // Similarly operation of a job cannot overlap:
  for (let j = 0; j < nbJobs; j++)
    model.noOverlap(jobs[j]);

  // Minimize the makespan:
  let makespan = model.max(ends);
  makespan.minimize();

  // Break symmetry.
  // The symmetry is that the backward schedule is a valid solution. So force
  // the longest variable in the first half of the makespan.
  if (longest !== null)
    model.constraint(makespan.minus(longest.length()).div(2).ge(longest.start()));
  // For discussion about symmetry breaking see the following paper:
  // Malapert, Cambazard, Guéret, Jussien, Langevin, Rousseau:
  //   An Optimal Constraint Programming Approach to the Open-Shop Problem

  return model;
}


// Default parameter settings that can be overridden on command line:
let params: CP.BenchmarkParameters = {
  usage: "Usage: node openshop.mjs [OPTIONS] INPUT_FILE1 [INPUT_FILE2] .."
};
let restArgs = CP.parseSomeBenchmarkParameters(params);
CP.benchmark(defineModel, restArgs, params);
