// Resource-Constrained Project Scheduling Problem with Consumption and Production
// of Resources (RCPSP-CPR). Extends classical RCPSP by introducing storage resources
// (reservoirs) that track cumulative levels based on consumption at activity start
// and production at activity end.

import { strict as assert } from 'node:assert';
import * as fs from "node:fs";
import * as zlib from "node:zlib";
import * as CP from "@scheduleopt/optalcp";

function readFileAsNumberArray(filename: string): number[] {
  const content = filename.endsWith(".gz")
    ? zlib.gunzipSync(fs.readFileSync(filename), {}).toString()
    : fs.readFileSync(filename, "utf8");
  return content.trim().split(/\s+/).map(Number);
}

function makeModelName(benchmarkName: string, filename: string): string {
  const instance = filename
    .replaceAll(/[/\\]/g, "_")
    .replace(/^data_/, "")
    .replace(/\.gz$/, "")
    .replace(/\.json$/, "")
    .replace(/\....?$/, "");
  return `${benchmarkName}_${instance}`;
}

function defineModel(filename: string) {
  const input = readFileAsNumberArray(filename);
  const model = new CP.Model(makeModelName('rcpsp-cpr', filename));
  let idx = 0; // Index for reading input array

  // Read problem dimensions:
  const nbJobs = input[idx++];
  const nbRenewables = input[idx++];
  const nbReservoirs = input[idx++];
  const nbRealJobs = nbJobs - 2;

  // Read resource capacities and initial reservoir levels:
  const renewableCapacities: number[] = [];
  const renewables: CP.CumulExpr[][] = [];
  for (let r = 0; r < nbRenewables; r++) {
    renewableCapacities[r] = input[idx++];
    renewables[r] = [];
  }
  const reservoirs: CP.CumulExpr[][] = [];
  for (let r = 0; r < nbReservoirs; r++)
    reservoirs[r] = [model.stepAt(CP.IntervalMin, input[idx++])];

  // Create interval variables:
  const jobs = Array.from({length: nbRealJobs}, (_, j) =>
    model.intervalVar({name: `T${j + 1}`}));

  // Skip dummy source job (length must be zero):
  assert(input[idx++] === 0);
  for (let r = 0; r < nbRenewables; r++) {
    const c = input[idx++];
    // Non-zero requirement is OK because length is zero.
    if (c > 0)
      console.log(`Warning: ${model.name} has source job with non-zero renewable requirement.`);
  }
  // As noted in README.md, consumption and production of dummy jobs is
  // ignored, because otherwise the number of infeasible instances does not
  // match the results from literature.
  idx += 2 * nbReservoirs;
  let nbSuccessors = input[idx++];
  idx += nbSuccessors; // Skip successor IDs

  // End times of jobs without successors (for makespan):
  const ends: CP.IntExpr[] = [];

  // Read individual jobs:
  let maxMakespan = 0;
  for (let j = 0; j < nbRealJobs; j++) {
    const duration = input[idx++];
    jobs[j].lengthMin = duration;
    jobs[j].lengthMax = duration;
    maxMakespan += duration;
    for (let r = 0; r < nbRenewables; r++) {
      const requirement = input[idx++];
      renewables[r].push(jobs[j].pulse(requirement));
    }
    for (let r = 0; r < nbReservoirs; r++) {
      const consumption = input[idx++];
      const production = input[idx++];
      if (duration > 0) {
        if (consumption !== 0) {
          // Using .neg() instead of negative height for CP Optimizer compatibility:
          reservoirs[r].push(jobs[j].stepAtStart(consumption).neg());
        }
        if (production !== 0)
          reservoirs[r].push(jobs[j].stepAtEnd(production));
      }
    }
    nbSuccessors = input[idx++];
    let isLast = true;
    const predecessor = jobs[j];
    for (let s = 0; s < nbSuccessors; s++) {
      const sID = input[idx++];
      assert(sID >= 2 && sID <= nbJobs);
      // Don't add precedence to sink job:
      if (sID < nbJobs) {
        const successor = jobs[sID - 2];
        predecessor.endBeforeStart(successor);
        isLast = false;
      }
    }
    if (isLast)
      ends.push(predecessor.end());
  }

  // Skip dummy sink job:
  assert(input[idx++] === 0); // Length
  for (let r = 0; r < nbRenewables; r++)
    assert(input[idx++] === 0); // Renewable requirement
  // Consumption and production of dummy sink job is ignored (see above).
  idx += 2 * nbReservoirs;
  assert(input[idx++] === 0); // Number of successors

  // Renewable resources must not exceed capacity, reservoirs must stay non-negative:
  for (let r = 0; r < nbRenewables; r++)
    model.sum(renewables[r]).le(renewableCapacities[r]);
  for (let r = 0; r < nbReservoirs; r++)
    model.sum(reservoirs[r]).ge(0);

  // Limit makespan to prevent propagation cycles, e.g., endBeforeStart(job1, job2)
  // but job2 is the only way to produce a reservoir needed for job1:
  for (let j = 0; j < nbRealJobs; j++)
    jobs[j].endMax = maxMakespan;

  // Minimize makespan:
  model.max(ends).minimize();

  // There shouldn't be anything more in the input:
  assert(idx === input.length);

  return model;
}

// Default parameter settings that can be overridden on the command line:
const params: CP.BenchmarkParameters = {
  usage: "Usage: node rcpsp-cpr.mjs [OPTIONS] INPUT_FILE.rcp [INPUT_FILE2.rcp] .."
};
const restArgs = CP.parseSomeBenchmarkParameters(params);
CP.benchmark(defineModel, restArgs, params);
