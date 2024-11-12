import { exit } from 'process';
import { strict as assert } from 'assert';
import * as CP from '@scheduleopt/optalcp';
import * as utils from '../../utils/utils.mjs';

function removeExpected(arr: Array<number>, expected: number) {
  let v = arr.shift();
  assert(v == expected);
}

// Effect on MMLIB50/J5079_4 with UB 67 (infeasible): 17% slower, 37% less branches
let useRedundantCumuls = false;

// Effect on MMLIB50/J5079_4 with UB 67 (infeasible): 25% slower, 1% less branches
let useGlobalCumul = false;

// Effect on MMLIB50/J5079_4 with UB 67 (infeasible): 19% faster, 36% less branches
let useGlobalNonRenewable = false;

// Effect of useGlobalNonRenewable + useRedundantCumuls
// on MMLIB50/J5079_4 with UB 67 (infeasible): 10% faster, 50% less branches

function defineModel(filename: string) {
  let inputTxt = utils.readFile(filename);
  let model = new CP.Model(utils.makeModelName("mmrcpsp", filename));

  let hasProjectInformation = /PROJECT INFORMATION:/.test(inputTxt);
  inputTxt = inputTxt.
    //  Get rid of unnecessary strings:
    // e.g.: ************************************************************************
    replace(/^\*\**$/gm, '')
    // e.g.: file with basedata            : J12022_.BAS
    .replace(/file with basedata *: .*/, '')
    // e.g.: initial value random generator: 22936
    .replace(/initial value random generator: [0-9]*/, '')
    // e.g.: projects                      :  1
    .replace(/projects  *:  1/, '')
    // e.g.: jobs (incl. supersource/sink ):
    .replace(/jobs *\(incl. supersource\/sink \):/, '')
    // e.g.: horizon                       :
    // e.g.: RESOURCES
    .replace(/RESOURCES/, '')
    // e.g.:  - renewable                 :  4   R
    .replace(/- renewable *: *([0-9]*) *R/, "\$1")
    // e.g.:  - nonrenewable              :  0   N
    .replace(/- nonrenewable *: *([0-9]*) *N/, "\$1")
    // e.g.:  - doubly constrained        :  0   D
    .replace(/- doubly constrained *: *0 *D/, '')
    // e.g: horizon                       :  122
    .replace(/horizon[ \t]*:[ \t]*[0-9]*/, '')
    // e.g.: PROJECT INFORMATION:
    .replace(/PROJECT INFORMATION:/, '')
    // e.g.: pronr.  #jobs rel.date duedate tardcost  MPM-Time
    .replace(/pronr\. *#jobs rel.date duedate tardcost *MPM-Time/, '')
    // e.g.: PRECEDENCE RELATIONS:
    .replace(/PRECEDENCE RELATIONS:/, '')
    // e.g.: jobnr.    #modes  #successors   successors
    .replace(/jobnr. *#modes *#successors *successors/, '')
    // e.g.: REQUESTS/DURATIONS:
    .replace(/REQUESTS\/DURATIONS:?/, '')
    // e.g.: jobnr. mode duration  R 1  R 2  R 3  R 4
    .replace(/jobnr.[ \t]*mode[ \t]*dur(ation)?[ \t]*[ \tNR0-9]*/, '')
    // e.g.: ------------------------------------------------------------------------
    .replace(/^--*$/gm, '')
    // e.g.: RESOURCEAVAILABILITIES:
    .replace(/RESOURCE ?AVAILABILITIES:?/, '')
    // e.g.: R 1  R 2  N 1  N 2
    .replace(/^[\t ]*R 1[\t NR0-9]*$/gm, '')

  // After this preprocessing the there should be only numbers:
  if (!inputTxt.match(/^[ \t0-9\r\n]*$/)) {
    console.log("Failed to remove garbage from the input file. Result after replace:");
    console.log(inputTxt);
    exit(1);
  }

  // Convert the input into an array of numbers:
  let input = inputTxt.trim().split(/\s+/).map(Number);

  // Read initial numbers at the beginning of the file:
  let nbJobs = input.shift() as number;
  let nbRealJobs = nbJobs - 2;
  let nbResources = input.shift() as number;
  let nbNonRenewable = input.shift() as number;

  if (hasProjectInformation) {
    let pronr = input.shift() as number;
    let nbNonDummyJobs = input.shift() as number;
    let releaseDate = input.shift() as number;
    let dueDate = input.shift() as number; // unused
    let tardCost = input.shift() as number; // unused
    let mpmTime = input.shift() as number; // unused
    assert(pronr == 1);
    assert(nbNonDummyJobs == nbRealJobs);
    assert(releaseDate == 0);
  }

  // Create interval variables
  let jobs: CP.IntervalVar[] = [];
  for (let j = 0; j < nbRealJobs; j++) {
    let itv = model.intervalVar({ name: "J" + (j + 1) });
    jobs.push(itv);
  }

  // Ignore precedence relations for the dummy source job at the beginning:
  removeExpected(input, 1); // job ID
  removeExpected(input, 1); // number of modes
  let nbSuccessors = input.shift() as number;
  for (let s = 0; s < nbSuccessors; s++)
    input.shift();

  // Number of modes for the given job:
  let nbModes: number[] = [];
  // Preparation for the makespan: array of end times of the last jobs
  let ends: CP.IntExpr[] = [];

  // Read precedence relations for the real jobs:
  for (let j = 0; j < nbRealJobs; j++) {
    removeExpected(input, j + 2); // job ID
    nbModes[j] = input.shift() as number;
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

  // Ignore precedence relations of the sink:
  removeExpected(input, nbJobs); // jobID
  removeExpected(input, 1); // mode
  removeExpected(input, 0); // number of successors

  // Prepare cumulative resources:
  let cumuls: CP.CumulExpr[][] = []
  let redundantCumuls: CP.CumulExpr[][] = [];
  let globalCumul: CP.CumulExpr[] = [];
  for (let r = 0; r < nbResources; r++) {
    cumuls.push([]);
    redundantCumuls.push([]);
  }
  // Prepare non-renewable resources
  let nonRenewables: CP.IntExpr[][] = [];
  let globalNonRenewable: CP.IntExpr[] = [];
  for (let n = 0; n < nbNonRenewable; n++)
    nonRenewables.push([]);

  // Ignore duration and resource requirements of source job:
  removeExpected(input, 1); // jobID
  removeExpected(input, 1); // mode
  removeExpected(input, 0); // duration
  for (let r = 0; r < nbResources; r++)
    removeExpected(input, 0); // required capacity
  for (let n = 0; n < nbNonRenewable; n++)
    removeExpected(input, 0); // required capacity

  // Parse job durations and resource requirements
  for (let j = 0; j < nbRealJobs; j++) {
    removeExpected(input, j + 2); // jobID
    let modes: CP.IntervalVar[] = [];

    let renewableRequirements: number[][] = [];
    for (let r = 0; r < nbResources; r++)
      renewableRequirements[r] = [];
    for (let a = 0; a < nbModes[j]; a++) {
      removeExpected(input, a + 1); // mode
      let duration = input.shift() as number;
      let mode = model.intervalVar({ optional: true, length: duration, name: "J" + (j + 1) + "M" + (a + 1) });
      modes.push(mode);
      let totalC =  0;
      for (let r = 0; r < nbResources; r++) {
        let c = input.shift() as number;
        renewableRequirements[r][a] = c;
        totalC += c;
      }
      globalCumul.push(modes[a].pulse(totalC));
      totalC = 0;
      for (let n = 0; n < nbNonRenewable; n++) {
        let c = input.shift() as number;
        nonRenewables[n].push(mode.presence().times(c));
        totalC += c;
      }
      globalNonRenewable.push(mode.presence().times(totalC));
    }
    for (let r = 0; r < nbResources; r++) {
      // TODO:1 This kind of presolve should be done in the engine itself
      let minC = renewableRequirements[r][0];
      let maxC = minC;
      for (let a = 1; a < nbModes[j]; a++) {
        minC = Math.min(minC, renewableRequirements[r][a]);
        maxC = Math.max(maxC, renewableRequirements[r][a]);
      }
      if (maxC == 0)
        continue;
      if (minC == maxC) {
        cumuls[r].push(jobs[j].pulse(minC));
        redundantCumuls[r].push(jobs[j].pulse(minC));
        continue;
      }
      let heights: CP.IntExpr[] = [];
      for (let a = 0; a < nbModes[j]; a++) {
        let c = renewableRequirements[r][a];
        heights.push(modes[a].presence().times(c));
        if (c == 0)
          continue;
        cumuls[r].push(modes[a].pulse(c));
      }
      redundantCumuls[r].push(jobs[j].pulse(model.sum(heights)));
    }
    model.alternative(jobs[j], modes);
  }

  // Ignore duration and resource requirements of the sink:
  removeExpected(input, nbJobs); // jobID
  removeExpected(input, 1); // mode
  removeExpected(input, 0); // duration
  for (let r = 0; r < nbResources; r++)
    removeExpected(input, 0); // required capacity
  for (let n = 0; n < nbNonRenewable; n++)
    removeExpected(input, 0); // required capacity

  // Read available resource capacities:
  let globalC = 0;
  for (let r = 0; r < nbResources; r++) {
    let c = input.shift() as number;
    assert(c > 0);
    globalC += c;
    model.cumulSum(cumuls[r]).cumulLe(c);
    if (useRedundantCumuls)
      model.cumulSum(redundantCumuls[r]).cumulLe(c);
  }
  if (useGlobalCumul)
    model.cumulSum(globalCumul).cumulLe(globalC);

  let cost: CP.IntExpr[] = [];
  globalC = 0;
  for (let n = 0; n < nbNonRenewable; n++) {
    let c = input.shift() as number;
    globalC += c;
    let used = model.sum(nonRenewables[n]);
    let overflow = model.max2(0, used.minus(c));
    cost.push(overflow);
  }
  if (useGlobalNonRenewable) {
    let used = model.sum(globalNonRenewable);
    let overflow = model.max2(0, used.minus(globalC));
    cost.push(overflow);
  }
  model.minimize(model.sum(cost).times(1000).plus(model.max(ends)));

  return model;
}


// Default parameter settings that can be overridden on command line:
let params: CP.BenchmarkParameters = {
  usage: "Usage: node mmrcpsp.mjs [OPTIONS] INPUT_FILE [INPUT_FILE2] .."
};
let restArgs = CP.parseSomeBenchmarkParameters(params);

// Search for --redundantCumuls in the command line arguments:
let i = 0;
while (i < restArgs.length) {
  if (restArgs[i] == "--redundantCumuls") {
    useRedundantCumuls = true;
    restArgs.splice(i, 1);
  }
  else if (restArgs[i] == "--globalCumul") {
    useGlobalCumul = true;
    restArgs.splice(i, 1);
  }
  else if (restArgs[i] == "--globalNonRenewable") {
    useGlobalNonRenewable = true;
    restArgs.splice(i, 1);
  }
  else
    i++;
}

CP.benchmark(defineModel, restArgs, params);
