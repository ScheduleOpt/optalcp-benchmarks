import { strict as assert } from 'assert';
import * as CP from '@scheduleopt/optalcp';
import * as utils from '../../utils/utils.mjs';
import * as jobshopModeler from '../jobshop/modeler.mjs';

let useRanks = false;
let useSameSequence = true;

function defineModel(filename: string): CP.Model {
  let input = utils.readFileAsNumberArray(filename);

  const nbJobs = input.shift() as number;
  const nbMachines = input.shift() as number;

  // There are two input formats for FlowShop:
  // * Taillard-like:
  //   Durations are given in the following order: J1M1 J2M1 J3M1 ...
  // * OR-Library like:
  //   Durations are given in the following order: 0 J1M1 1 J1M2 2 J1M3 ...
  //   i.e., machine IDs (starting from 0) are given before each duration.
  //   This way, the format is the same as JobShop (FlowShop is a special case
  //   of JobShop).
  // In particular, an instance in the OR-Library format should have the value 0
  // now in the input. If not, it is probably in Taillard-like format, and we
  // can reuse function defineModel from jobshop/jobshop.ts:
  let hasMachineIDs: boolean = (input[0] == 0);
  if (hasMachineIDs) {
    // TODO:0
    console.error("Not implemented: OR-Library-like format for permutation FlowShop.");
    process.exit(1);
    let model = jobshopModeler.defineModel(filename);
    // Jobshop models are named "jobshop" by default, but we want to use
    // "non-permutation-flowshop" instead:
    model.setName(utils.makeModelName('non-permutation-flowshop', filename));
    return model;
  }

  // Taillard format:

  let model = new CP.Model(utils.makeModelName('permutation-flowshop', filename));

  let rankVars: CP.IntVar[] = [];
  if (useRanks) {
    // TODO:0 Auxiliary int vars?
    for (let i = 0; i < nbJobs; i++)
      rankVars.push(model.intVar({ name: "rank" + (i + 1) }));
  }
  // Current last operation for each job:
  let last: CP.IntervalVar[] = [];
  let sequences: CP.SequenceVar[] = [];
  for (let j = 0; j < nbMachines; j++) {
    // Operations on the current machine:
    let machine: CP.IntervalVar[] = [];
    for (let i = 0; i < nbJobs; i++) {
      const duration = input.shift() as number;
      let operation = model.intervalVar().setLength(duration).setName("J" + (i + 1) + "M" + (j + 1));
      machine.push(operation);
      if (last[i])
        last[i].endBeforeStart(operation);
      last[i] = operation;
    }
    let seq = model.sequenceVar(machine);
    sequences.push(seq);
    model.noOverlap(seq);
    if (useRanks) {
      for (let i = 0; i < nbJobs; i++)
        model.constraint(rankVars[i].eq(model._rank(machine[i], seq)));
    }
  }

  if (useSameSequence) {
    for (let i = 1; i < sequences.length; i++)
      model._sameSequence(sequences[i - 1], sequences[i]);
  }

  // Minimize the makespan:
  let ends: CP.IntExpr[] = [];
  for (let i = 0; i < nbJobs; i++)
    ends.push(last[i].end());
  let makespan = model.max(ends);
  makespan.minimize();

  // There shouldn't be anything more in the input:
  assert(input.length == 0);

  return model;
}

// Default parameter settings that can be overridden on command line:
let params: CP.BenchmarkParameters = {
  usage: "Usage: node permutation-flowshop.js [OPTIONS] INPUT_FILE1 [INPUT_FILE2] .."
};
let restArgs = CP.parseSomeBenchmarkParameters(params);
CP.benchmark(defineModel, restArgs, params);
