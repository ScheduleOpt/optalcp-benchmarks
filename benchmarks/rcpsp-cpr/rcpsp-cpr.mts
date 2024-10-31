import { strict as assert } from 'assert';
import * as CP from '@scheduleopt/optalcp';
import * as utils from '../../utils/utils.mjs'

function defineModel(filename: string) {
  let input = utils.readFileAsNumberArray(filename);
  let model = new CP.Model(utils.makeModelName('rcpsp-cpr', filename));

  // Read initial numbers at the beginning of the file:
  let nbJobs = input.shift() as number;
  let nbRenewables = input.shift() as number;
  let nbReservoirs = input.shift() as number;
  let nbRealJobs = nbJobs - 2;

  // Read resource capacities and initialize their cumuls:
  let renewableCapacities: number[] = [];
  let renewables: CP.CumulExpr[][] = [];
  for (let r = 0; r < nbRenewables; r++) {
    renewableCapacities[r] = input.shift() as number;
    renewables[r] = [];
  }
  let reservoirs: CP.CumulExpr[][] = [];
  for (let r = 0; r < nbReservoirs; r++)
    reservoirs[r] = [model.stepAt(CP.IntervalMin, input.shift() as number)];

  // Create interval variables
  let jobs: CP.IntervalVar[] = [];
  for (let j = 0; j < nbRealJobs; j++) {
    let itv = model.intervalVar().setName("T" + (j + 1));
    jobs.push(itv);
  }

  // Ignore precedence relations for the dummy source job at the beginning:
  assert(input.shift() == 0); // Length
  for (let r = 0; r < nbRenewables; r++) {
    let c = input.shift() as number;
    // In classical RCPSP c is always zero for dummy source job. However here it
    // is not the case. Still, it can be ignored because length is zero
    // (asserted above).
    if (c > 0)
      console.log("Warning: " + model.getName() + " has source job with non-zero renewable requirement.");
  }
  for (let r = 0; r < nbReservoirs; r++) {
    let consumption = input.shift() as number;
    let production = input.shift() as number;
    // As noted in README.md, consumption and production of dummy tasks is
    // ignored, because otherwise the number of infeasible instances does not
    // much the results from literature.
    //    reservoirs[r].push(model.step(0, production - consumption));
  }
  let nbSuccessors = input.shift() as number;
  for (let s = 0; s < nbSuccessors; s++)
    input.shift(); // Successor id

  // Preparation for the makespan: array of end times of the last jobs
  let ends: CP.IntExpr[] = [];

  // Read individual jobs.
  let maxMakespan = 0;
  for (let j = 0; j < nbRealJobs; j++) {
    let duration = input.shift() as number;
    jobs[j].setLength(duration);
    maxMakespan += duration;
    for (let r = 0; r < nbRenewables; r++) {
      let requirement = input.shift() as number;
      renewables[r].push(jobs[j].pulse(requirement));
    }
    for (let r = 0; r < nbReservoirs; r++) {
      let consumption = input.shift() as number;
      let production = input.shift() as number;
      if (jobs[j].getLengthMin() as number > 0) {
        if (consumption != 0) {
          // OptalCP supports steps with negative height:
          //    reservoirs[r].push(jobs[j].stepAtStart(-consumption));
          // But CP Optimizer does not. Since we want to be able to export into
          // .cpo file format, we use -step instead:
          reservoirs[r].push(jobs[j].stepAtStart(consumption).cumulNeg());
        } if (production != 0)
          reservoirs[r].push(jobs[j].stepAtEnd(production));
      }
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
  for (let r = 0; r < nbRenewables; r++)
    assert(input.shift() == 0); // Resource requirement
  for (let r = 0; r < nbReservoirs; r++) {
    let consumption = input.shift() as number;
    let production = input.shift() as number;
    // As noted in README.md, consumption and production of dummy tasks is
    // ignored, because otherwise the number of infeasible instances does not
    // much the results from literature.
  }
  assert(input.shift() == 0); // Number of successors

  // Constraint height of cumuls:
  for (let r = 0; r < nbRenewables; r++)
    model.cumulSum(renewables[r]).cumulLe(renewableCapacities[r]);
  for (let r= 0; r < nbReservoirs; r++)
    model.cumulSum(reservoirs[r]).cumulGe(0);

  // Search can easily introduce a cycle between jobs. E.g. there is precedence
  // endBeforeStart(job1, job2) but job2 is the only way to produce reservoir R
  // needed for job1. So we have to put a limit on makespan in order to cut
  // those propagation loops:
  for (let j = 0; j < nbRealJobs; j++)
    jobs[j].setEndMax(maxMakespan);

  // Minimize makespan:
  model.max(ends).minimize();

  // There shouldn't be anything more in the input:
  assert(input.length == 0);

  return model;
}


// Default parameter settings that can be overridden on the command line:
let params: CP.BenchmarkParameters = {
  usage: "Usage: node rcpsp-cpr.mjs [OPTIONS] INPUT_FILE.rcp [INPUT_FILE2.rcp] .."
};
let restArgs = CP.parseSomeBenchmarkParameters(params);
CP.benchmark(defineModel, restArgs, params);
