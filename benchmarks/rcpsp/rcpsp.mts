import { strict as assert } from 'assert';
import * as CP from '@scheduleopt/optalcp';
import * as utils from '../../utils/utils.mjs'

type CumulDemand = {
  demand: number,
  interval: CP.IntervalVar
};

const useCap2Relaxation = false;

/** Read RCPSP data file in '.rcp' format */
function defineModelRCP(filename: string) {
  let input = utils.readFileAsNumberArray(filename);
  let model = new CP.Model(utils.makeModelName('rcpsp', filename));

  // Read initial numbers at the beginning of the file:
  let nbJobs = input.shift() as number;
  let nbResources = input.shift() as number;
  let nbRealJobs = nbJobs - 2;

  // Read resource capacities and initialize their cumuls:
  let resourceCapacities: number[] = [];
  let resources: CP.CumulExpr[][] = [];

  let disjunctives: CP.IntervalVar[][] = [];
  let longestHalf: CP.IntervalVar[] = [];

  let cumulDemands: CumulDemand[][] = [];

  for (let r = 0; r < nbResources; r++) {
    resourceCapacities[r] = input.shift() as number;
    resources[r] = [];
    disjunctives[r] = [];
    cumulDemands[r] = [];
  }

  // Create interval variables
  let jobs: CP.IntervalVar[] = [];
  for (let j = 0; j < nbRealJobs; j++) {
    let itv = model.intervalVar({ name: `T${j + 1}` });
    jobs.push(itv);
  }

  // Ignore precedence relations for the dummy source job at the beginning:
  assert(input.shift() == 0); // Length
  for (let r = 0; r < nbResources; r++)
    assert(input.shift() == 0); // Resource requirement
  let nbSuccessors = input.shift() as number;
  for (let s = 0; s < nbSuccessors; s++)
    input.shift(); // Successor id

  // Preparation for the makespan: array of end times of the last jobs
  let ends: CP.IntExpr[] = [];

  // Read individual jobs
  for (let j = 0; j < nbRealJobs; j++) {
    let duration = input.shift() as number;
    jobs[j].setLength(duration);
    for (let r = 0; r < nbResources; r++) {
      let requirement = input.shift() as number;
      resources[r].push(jobs[j].pulse(requirement));
      if (requirement > resourceCapacities[r] / 2)
        disjunctives[r].push(jobs[j]);
      else if (requirement == resourceCapacities[r] / 2) {
        let prevLongestHalf = longestHalf[r];
        if (!prevLongestHalf || prevLongestHalf.length() < jobs[j].length())
          longestHalf[r] = jobs[j];
      }
      if (requirement > 0)
        cumulDemands[r].push({ demand: requirement, interval: jobs[j] });
    }
    nbSuccessors = input.shift() as number;
    let isLast = true;
    let predecessor = jobs[j];
    for (let s = 0; s < nbSuccessors; s++) {
      let sID = input.shift() as number;
      assert(sID >= 2 && sID <= nbJobs);
      // Ignore sink job:
      if (sID < nbJobs) {
        let successor = jobs[sID - 2];
        predecessor.endBeforeStart(successor);
        isLast = false;
      }
    }
    if (isLast)
      ends.push(predecessor.end());
  }

  // Ignore dummy sink task
  assert(input.shift() == 0); // Length
  for (let r = 0; r < nbResources; r++)
    assert(input.shift() == 0); // Resource requirement
  assert(input.shift() == 0); // Number of successors

  // Constraint height of cumuls:
  for (let r = 0; r < nbResources; r++) {
    model.cumulSum(resources[r]).cumulLe(resourceCapacities[r]);

    if (useCap2Relaxation) {
      if (longestHalf[r])
        disjunctives[r].push(longestHalf[r]);
      if (disjunctives[r].length > 2)
        model.noOverlap(disjunctives[r]);

      let minC2 = Math.ceil((resourceCapacities[r] + 1) / 2);
      let minC1 = Math.ceil((resourceCapacities[r] + 1) / 3);
      let maxC2 = resourceCapacities[r] - minC1 + 1;
      for (let c2 = minC2; c2 <= maxC2; c2++) {
        let c1 = resourceCapacities[r] - c2 + 1;
        assert(c1 >= minC1);
        //console.log("C1: ", c1, " C2: ", c2);
        let pulses: CP.CumulExpr[] = [];
        for (const demand of cumulDemands[r]) {
          if (demand.demand >= c2)
            pulses.push(demand.interval.pulse(2));
          else if (demand.demand >= c1)
            pulses.push(demand.interval.pulse(1));
        }
        model.cumulSum(pulses).cumulLe(2);
      }
    }
  }

  // Minimize makespan:
  model.max(ends).minimize();

  // There shouldn't be anything more in the input:
  assert(input.length == 0);

  return model;
}

/**
 * Auxiliary function. Asserts that `arr[0]` is `expected` and removes this
 * value from the array.
 */
function removeExpected(arr: number[], expected: number) {
  let v = arr.shift();
  assert(v == expected);
}

/** Read RCPSP data file in '.sm' format */
function defineModelSM(filename: string) {
  let model = new CP.Model(utils.makeModelName('rcpsp', filename));
  // Read the whole file into memory:
  let inputTxt = utils.readFile(filename).
    // .. and get rid of unnecessary strings:
    // e.g.: ************************************************************************
    replace(/^\*\**$/gm, '')
    // e.g.: file with basedata            : J12022_.BAS
    .replace(/file with basedata *: .*/, '')
    // e.g.: initial value random generator: 22936
    .replace(/initial value random generator: [0-9]*/, '')
    // e.g.: projects                      :  1
    .replace(/projects  *:  1/, '')
    // e.g.: jobs (incl. supersource/sink ):
    .replace(/jobs \(incl. supersource\/sink \): /, '')
    // e.g.: horizon                       :
    .replace(/horizon *:/, '')
    // e.g.: RESOURCES
    .replace(/RESOURCES/, '')
    // e.g.:  - renewable                 :  4   R
    .replace(/- renewable *: *([0-9]*) *R/, "\$1")
    // e.g.:  - nonrenewable              :  0   N
    .replace(/- nonrenewable *: *0 *N/, '')
    // e.g.:  - doubly constrained        :  0   D
    .replace(/- doubly constrained *: *0 *D/, '')
    // e.g.: PROJECT INFORMATION:
    .replace(/PROJECT INFORMATION:/, '')
    // e.g.: pronr.  #jobs rel.date duedate tardcost  MPM-Time
    .replace(/pronr\. *#jobs rel.date duedate tardcost *MPM-Time/, '')
    // e.g.: PRECEDENCE RELATIONS:
    .replace(/PRECEDENCE RELATIONS:/, '')
    // e.g.: jobnr.    #modes  #successors   successors
    .replace(/jobnr. *#modes *#successors *successors/, '')
    // e.g.: REQUESTS/DURATIONS:
    .replace(/REQUESTS\/DURATIONS:/, '')
    // e.g.: jobnr. mode duration  R 1  R 2  R 3  R 4
    .replace(/jobnr. mode duration [ R0-9]*/, '')
    // e.g.: ------------------------------------------------------------------------
    .replace(/^--*$/gm, '')
    // e.g.: RESOURCEAVAILABILITIES:
    .replace(/RESOURCEAVAILABILITIES:/, '')
    // e.g.: R 1  R 2  R 3  R 4
    .replace(/^ *R 1 [ R0-9]*$/gm, '')

  // After this preprocessing the there should be only numbers:
  if (!inputTxt.match(/^[ 0-9\n]*$/)) {
    console.log("Failed to remove garbage from the input file. Result after replace:");
    console.log(inputTxt);
    process.exit(1);
  }

  // Convert the input into an array of numbers:
  let input = inputTxt.trim().split(/\s+/).map(Number);

  // Read initial numbers at the beginning of the file:
  let nbJobs = input.shift() as number;
  // console.log("nbJobs: ", nbJobs)
  let inFileHorizon = input.shift() as number;
  // console.log("horizon: ", inFileHorizon)
  let nbResources = input.shift() as number;
  // console.log("nbResources: ", nbResources)
  let pronr = input.shift() as number;
  // console.log("pronr: ", pronr)
  let nbRealJobs = input.shift() as number;
  let releaseDate = input.shift() as number;
  let dueDate = input.shift() as number;
  let tardCost = input.shift() as number;
  let mpmTime = input.shift() as number;

  assert(pronr == 1);
  assert(nbRealJobs == nbJobs - 2);
  assert(releaseDate == 0);

  // Create interval variables
  let jobs: CP.IntervalVar[] = [];
  for (let j = 0; j < nbRealJobs; j++) {
    let itv = model.intervalVar({ name: `T${j + 1}` });
    jobs.push(itv);
  }

  // Ignore precedence relations for the dummy source job at the beginning:
  removeExpected(input, 1); // job ID
  removeExpected(input, 1); // mode
  let nbSuccessors = input.shift() as number;
  for (let s = 0; s < nbSuccessors; s++)
    input.shift();

  // Preparation for the makespan: array of end times of the last jobs
  let ends: CP.IntExpr[] = [];

  // Read precedence relations for the real jobs:
  for (let j = 0; j < nbRealJobs; j++) {
    removeExpected(input, j + 2); // job ID
    removeExpected(input, 1); // number of modes
    let isLast = true;
    let predecessor = jobs[j];
    nbSuccessors = input.shift() as number;
    for (let s = 0; s < nbSuccessors; s++) {
      let sID = input.shift() as number;
      assert(sID >= 2 && sID <= nbJobs);
      // Ignore sink job:
      if (sID < nbJobs) {
        let successor = jobs[sID - 2];
        predecessor.endBeforeStart(successor);
        isLast = false;
      }
    }
    if (isLast)
      ends.push(predecessor.end());
  }

  // Minimize makespan:
  model.max(ends).minimize();

  // Ignore precedence relations of the sink:
  removeExpected(input, nbJobs); // jobID
  removeExpected(input, 1); // mode
  removeExpected(input, 0); // number of successors

  // Prepare cumulative resources:
  let cumuls: CP.CumulExpr[][] = []
  for (let r = 0; r < nbResources; r++)
    cumuls.push([]);

  // Ignore duration and resource requirements of source job:
  removeExpected(input, 1); // jobID
  removeExpected(input, 1); // mode
  removeExpected(input, 0); // duration
  for (let r = 0; r < nbResources; r++)
    removeExpected(input, 0); // required capacity

  let cumulDemands: CumulDemand[][] = [];
  for (let r = 0; r < nbResources; r++)
    cumulDemands.push([]);

  // Parse job durations and resource requirements
  for (let j = 0; j < nbRealJobs; j++) {
    removeExpected(input, j + 2); // jobID
    removeExpected(input, 1); // mode
    let duration = input.shift() as number;
    let job = jobs[j];
    job.setLength(duration);
    for (let r = 0; r < nbResources; r++) {
      let c = input.shift() as number;
      if (c == 0)
        continue;
      cumuls[r].push(job.pulse(c));
      cumulDemands[r].push({ demand: c, interval: job });
    }
  }

  // Ignore duration and resource requirements of the sink:
  removeExpected(input, nbJobs); // jobID
  removeExpected(input, 1); // mode
  removeExpected(input, 0); // duration
  for (let r = 0; r < nbResources; r++)
    removeExpected(input, 0); // required capacity

  // Read available resource capacities:
  let capacities: number[] = []
  for (let r = 0; r < nbResources; r++) {
    let c = input.shift() as number;
    assert(c > 0);
    model.cumulSum(cumuls[r]).cumulLe(c);
    capacities.push(c);
  }

  // There shouldn't be anything more in the input:
  assert(input.length == 0);

  if (useCap2Relaxation) {
    for (let r = 0; r < nbResources; r++) {
      let disjunctives = [];
      let longestHalf = null;
      for (const demand of cumulDemands[r]) {
        if (demand.demand > capacities[r] / 2)
          disjunctives.push(demand.interval);
        else if (demand.demand == capacities[r] / 2) {
          if (!longestHalf || longestHalf.length() < demand.interval.length())
            longestHalf = demand.interval;
        }
      }
      if (longestHalf)
        disjunctives.push(longestHalf);
      if (disjunctives.length > 2)
        model.noOverlap(disjunctives);

      let minC2 = Math.ceil((capacities[r] + 1) / 2);
      let minC1 = Math.ceil((capacities[r] + 1) / 3);
      let maxC2 = capacities[r] - minC1 + 1;
      for (let c2 = minC2; c2 <= maxC2; c2++) {
        let c1 = capacities[r] - c2 + 1;
        assert(c1 >= minC1);
        // console.log("C1: ", c1, " C2: ", c2);
        let pulses: CP.CumulExpr[] = [];
        for (const demand of cumulDemands[r]) {
          if (demand.demand >= c2)
            pulses.push(demand.interval.pulse(2));
          else if (demand.demand >= c1)
            pulses.push(demand.interval.pulse(1));
        }
        if (pulses.length > 2)
          model.cumulSum(pulses).cumulLe(2);
      }
    }
  }

  return model;
}

function defineModel(filename: string): CP.Model {
  // There are two different file formats: `.sm` and `.rcp`.
  // Check to filename to find out which format it is.
  if (filename.includes('.rcp'))
    return defineModelRCP(filename);
  if (filename.includes('.sm'))
    return defineModelSM(filename);

  console.log("Unable to guess data format of '" + filename + "'. Unknown file extensions are .rcp and .sm.");
  process.exit(1);
}


// Default parameter settings that can be overridden on the command line:
let params: CP.BenchmarkParameters = {
  usage: "Usage: node rcpsp.mjs [OPTIONS] INPUT_FILE [INPUT_FILE2] .."
};
let restArgs = CP.parseSomeBenchmarkParameters(params);
CP.benchmark(defineModel, restArgs, params);
