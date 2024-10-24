import * as CP from '@scheduleopt/optalcp';
import * as utils from '../../utils/utils.mjs';
import { strict as assert } from 'assert';

function defineModel(filename: string): CP.Model {
  // Read the input file into a string, possibly unzip it if it ends with .gz:
  let inputText = utils.readFile(filename);
  // The first line may contain 2 or 3 numbers. The third number should be ignored.
  // Therefore find end of the first line:
  let firstEOL = inputText.indexOf('\n');
  // Convert first line into an array of numbers:
  let firstLine = inputText.slice(0, firstEOL).trim().split(/\s+/).map(Number);
  // Similarly convert the rest of the file into an array of numbers:
  let input = inputText.slice(firstEOL+1).trim().split(/\s+/).map(Number);

  let model = new CP.Model(utils.makeModelName('flexible-jobshop', filename));
  const nbJobs = firstLine[0] as number;
  const nbMachines = firstLine[1] as number;
  // console.log("Flexible JobShop with " + nbMachines + " machines and " + nbJobs + " jobs.");

  // For each machine create an array of operations executed on it.
  // Initialize all machines by empty arrays:
  let machines: CP.IntervalVar[][] = [];
  for (let j = 0; j < nbMachines; j++)
    machines[j] = [];

  // End times of each job:
  let ends: CP.IntExpr[] = [];

  // Redundant cumul resource.
  // For example, with this redundant constraint instance data/Dauzere/02a.fjs,
  // has trivial lower bound 2228 (just by propagation). According to Quintiq
  // there is a solution with that objective. Without the redundant cumul it
  // takes ages to prove that there is no solution with makespan 2227.
  // It also seems that in this particular instance duration is the same in all
  // modes (what makes this redundant constraint stronger).
  let allMachines: CP.CumulExpr[] = [];
  // TODO:2 We may need more fine-grained redundant cumul(s) depending on what
  // resources are most often combined together.

  for (let i = 0; i < nbJobs; i++) {
    let nbOperations = input.shift() as number;
    // Previous task in the job:
    let prev: CP.IntervalVar | undefined = undefined;
    for (let j = 0; j < nbOperations; j++) {
      // Create a new operation (master of alternative constraint):
      let operation = model.intervalVar().setName("J" + (i + 1) + "O" + (j + 1));
      let nbModes = input.shift() as number;
      let modes: CP.IntervalVar[] = [];
      for (let k = 0; k < nbModes; k++) {
        const machineId = input.shift() as number;
        const duration = input.shift() as number;
        let mode = model.intervalVar({ length: duration, optional: true, name: "J" + (i + 1) + "O" + (j + 1) + "_M" + machineId });
        // In the input file machines are counted from 1, we count from 0:
        machines[machineId - 1].push(mode);
        modes.push(mode);
      }
      model.alternative(operation, modes);
      // Operation has a predecessor:
      if (prev !== undefined)
        prev.endBeforeStart(operation);
      prev = operation;
      allMachines.push(operation.pulse(1));
    }
    // End time of the job is end time of the last operation:
    ends.push((prev as CP.IntervalVar).end());
  }

  // Tasks on each machine cannot overlap:
  for (let j = 0; j < nbMachines; j++)
    model.noOverlap(machines[j]);

  // TODO:1 The following constraint should be marked as redundant and shouldn't
  // be used with LNS:
  model.cumulSum(allMachines).cumulLe(nbMachines);

  // Minimize the makespan:
  let makespan = model.max(ends);
  makespan.minimize();

  // There shouldn't be anything more in the input:
  assert(input.length == 0);

  return model;
}


// Default parameter settings that can be overridden on command line:
let params: CP.BenchmarkParameters = {
  usage: "Usage: node flexible-jobshop.js [OPTIONS] INPUT_FILE1 [INPUT_FILE2] .."
};
let restArgs = CP.parseSomeBenchmarkParameters(params);
CP.benchmark(defineModel, restArgs, params);
