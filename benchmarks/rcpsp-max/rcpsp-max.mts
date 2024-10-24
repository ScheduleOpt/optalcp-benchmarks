import { strict as assert } from 'assert';
import * as CP from '@scheduleopt/optalcp';
import * as utils from '../../utils/utils.mjs'

function defineModel(filename: string) {
  let inputText = utils.readFile(filename);
  // Input files contains characters '[' and ']'. Ignore them and convert the
  // text into an array of numbers:
  let input = inputText.replaceAll(/[\[\]]/g, '').trim().split(/\s+/).map(Number);

  let model = new CP.Model(utils.makeModelName('rcpsp-max', filename));

  // Read initial numbers at the beginning of the file:
  let nbRealJobs = input.shift() as number;
  let nbResources = input.shift() as number;
  assert(input.shift() == 0); // number of non-renewable resources?
  assert(input.shift() == 0); // number of doubly constrained resources?

  // Create interval variables
  let jobs: CP.IntervalVar[] = [];
  // To compute scheduling horizon, it is good to know the maximum delay in of
  // precedences starting at the given job:
  let maxDelayAfter: number[] = [];
  for (let j = 0; j < nbRealJobs; j++) {
    let itv = model.intervalVar().setName("T" + (j + 1));
    jobs.push(itv);
    maxDelayAfter.push(0);
  }

  // Ignore precedence relations for the dummy source job at the beginning:
  assert(input.shift() == 0); // Job ID
  assert(input.shift() == 1); // Mode ID
  let nbSuccessors = input.shift() as number;
  for (let s = 0; s < nbSuccessors; s++)
    input.shift(); // Successor id
  for (let s = 0; s < nbSuccessors; s++)
    assert(input.shift() == 0); // Precedence length

  // Preparation for the makespan: array of end times of the last jobs
  let ends: CP.IntExpr[] = [];

  // Read precedence relations for normal jobs:
  for (let j = 0; j < nbRealJobs; j++) {
    assert(input.shift() == j + 1); // Job ID
    assert(input.shift() == 1); // Mode ID
    nbSuccessors = input.shift() as number;
    let countInMakespan = false;
    let predecessor = jobs[j];
    let successors: Array<CP.IntervalVar | null> = [];
    // First there are IDs of the successors:
    for (let s = 0; s < nbSuccessors; s++) {
      let sID = input.shift() as number;
      assert(sID >= 1 && sID <= nbRealJobs + 1);
      if (sID <= nbRealJobs) {
        // Successor is a normal job:
        successors.push(jobs[sID - 1]);
      } else {
        // Successor is the sink dummy job. Include the predecessor in makespan
        // computation:
        countInMakespan = true;
        successors.push(null);
      }
    }
    // Then read delays and create precedences:
    for (let s = 0; s < nbSuccessors; s++) {
      let delay = input.shift() as number;
      let successor = successors[s];
      if (successor !== null) {
        // Standard successor
        predecessor.startBeforeStart(successor, delay);
      }
      else {
        // Successor is the dummy end job. The length should be the same as the
        // length of the intervalVar. However we don't know the length yet.
        // So we set it and then we verify that we set it correctly.
        assert(predecessor.getLengthMin() == 0);
        predecessor.setLength(delay);
      }
      if (countInMakespan)
        ends.push(predecessor.end());
      maxDelayAfter[j] = Math.max(maxDelayAfter[j], delay);
    }
  }

  // Ignore precedences for the dummy sink job:
  assert(input.shift() == nbRealJobs + 1); // Job ID
  assert(input.shift() == 1); // Mode Id
  assert(input.shift() == 0); // Number of successors

  // Read durations and resource usage.
  // But ignore the first dummy job:
  assert(input.shift() == 0); // Job ID
  assert(input.shift() == 1); // Mode ID
  assert(input.shift() == 0); // Duration
  for (let r = 0; r < nbResources; r++)
    assert(input.shift() == 0); // Resource requirement

  // Prepare arrays for resources:
  let resources: CP.CumulExpr[][] = [];
  for (let r = 0; r < nbResources; r++)
    resources[r] = [];

  // We're going to compute rough UB (maximum end time) for all interval
  // variables:
  let horizon = 0;

  // Read durations and resource usage for real jobs
  for (let j = 0; j < nbRealJobs; j++) {
    assert(input.shift() == j + 1); // Job ID
    assert(input.shift() == 1); // Mode ID
    let duration = input.shift() as number;
    // We could already set the length as we saw the precedence to dummy sink
    // job. Verify that it is correct:
    assert(jobs[j].getLengthMin() == 0 || jobs[j].getLengthMin() == duration);
    horizon += duration + Math.max(0, maxDelayAfter[j] - duration);
    jobs[j].setLength(duration);
    for (let r = 0; r < nbResources; r++) {
      let requirement = input.shift() as number;
      resources[r].push(jobs[j].pulse(requirement));
    }
  }

  // Apply computed horizon:
  for (let j = 0; j < nbRealJobs; j++)
    jobs[j].setEndMax(horizon);
  // console.log("Computed horizon: ", horizon);

  // Ignore resource requirements of the dummy sink job:
  assert(input.shift() == nbRealJobs + 1); // Job ID
  assert(input.shift() == 1); // Mode ID
  assert(input.shift() == 0); // Duration
  for (let r = 0; r < nbResources; r++)
    assert(input.shift() == 0); // Resource usage

  // Read resource capacities
  for (let r = 0; r < nbResources; r++) {
    let capacity = input.shift() as number;
    model.cumulSum(resources[r]).cumulLe(capacity);
  }

  // Read resource capacities and initialize their cumuls:
  let resourceCapacities: number[] = [];
  for (let r = 0; r < nbResources; r++) {
    resourceCapacities[r] = input.shift() as number;
    resources[r] = [];
  }

  // There shouldn't be anything more in the input:
  assert(input.length == 0);

  // Minimize makespan:
  model.max(ends).minimize();

  return model;
}


// Default parameter settings that can be overridden on the command line:
let params: CP.BenchmarkParameters = {
  usage: "Usage: node rcpsp-max.js [OPTIONS] INPUT_FILE [INPUT_FILE2] .."
};
let restArgs = CP.parseSomeBenchmarkParameters(params);
CP.benchmark(defineModel, restArgs, params);
