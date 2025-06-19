import * as CP from '@scheduleopt/optalcp';
import * as utils from '../../utils/utils.mjs'

function defineModel(filename: string, nbOperators: number): CP.Model {
  let input = utils.readFileAsNumberArray(filename);
  let model = new CP.Model(utils.makeModelName("jobshop-operators", filename) + "-" + nbOperators + "opers");

  const nbJobs = input.shift() as number;
  const nbMachines = input.shift() as number;

  // For each machine, create an array of operations.
  // Initialize all machines by empty arrays:
  let machines: CP.IntervalVar[][] = [];
  for (let j = 0; j < nbMachines; j++)
    machines[j] = [];

  // End times of each job:
  let ends: CP.IntExpr[] = [];

  // Array of pulses for each job:
  let operatorRequirements: CP.CumulExpr[] = [];

  for (let i = 0; i < nbJobs; i++) {
    // Previous task in the job:
    let prev: CP.IntervalVar | undefined = undefined;
    for (let j = 0; j < nbMachines; j++) {
      // Create a new operation:
      const machineId = input.shift() as number;
      const duration = input.shift() as number;
      let operation = model.intervalVar({ length: duration, name: `J${i + 1}O${j + 1}M${machineId}` });
      // Operation requires some machine:
      machines[machineId].push(operation);
      // And it requires an operator:
      operatorRequirements.push(operation.pulse(1));
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

  // There is a limited number of operators:
  model.cumulSum(operatorRequirements).cumulLe(nbOperators);

  // Minimize the makespan:
  let makespan = model.max(ends);
  makespan.minimize();

  return model;
}


// Default parameter settings that can be overridden on command line:
let params: CP.BenchmarkParameters = {
  usage: "Usage: node jobshop-operators.mjs --nbOperators n [OPTIONS] INPUT_FILE1 [INPUT_FILE2] .."
};
let restArgs = CP.parseSomeBenchmarkParameters(params); // It also handles --help

// Parse '--nbOperators' in the remaining command line arguments:
let index = restArgs.indexOf('--nbOperators');
if (index === undefined) {
  console.log("Missing --nbOperators argument.");
  process.exit(1);
}
if (index == restArgs.length - 1) {
  console.log("Missing value of --nbOperators argument.");
  process.exit(1);
}
let nbOperators = Number(restArgs[index + 1]);
restArgs.splice(index, 2);
// All remaining command line arguments are file names.

function defineModelWithOperators(filename: string) {
  return defineModel(filename, nbOperators);
}

CP.benchmark(defineModelWithOperators, restArgs, params);


