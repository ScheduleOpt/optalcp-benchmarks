/**
 * Resource-Constrained Project Scheduling Problem (RCPSP).
 *
 * Schedule jobs with precedence constraints and limited renewable resources.
 * Each job has a fixed duration and resource requirements. Resources have
 * per-time-step capacity limits. Objective: minimize makespan.
 */

import { strict as assert } from 'node:assert';
import * as fs from "node:fs";
import * as zlib from "node:zlib";
import * as CP from "@scheduleopt/optalcp";

function readFile(filename: string): string {
  return filename.endsWith(".gz")
    ? zlib.gunzipSync(fs.readFileSync(filename), {}).toString()
    : fs.readFileSync(filename, "utf8");
}

function readFileAsNumberArray(filename: string): number[] {
  return readFile(filename).trim().split(/\s+/).map(Number);
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

/** Asserts that `arr[idx]` equals `expected` and returns incremented index. */
function skipExpected(arr: number[], idx: number, expected: number): number {
  assert(arr[idx] === expected);
  return idx + 1;
}

/** Read RCPSP data file in '.rcp' format */
function defineModelRCP(filename: string) {
  const input = readFileAsNumberArray(filename);
  const model = new CP.Model(makeModelName('rcpsp', filename));
  let idx = 0; // Index for reading input array

  // Read initial numbers at the beginning of the file:
  const nbJobs = input[idx++];
  const nbResources = input[idx++];
  const nbRealJobs = nbJobs - 2;

  // Read resource capacities and initialize their cumuls:
  const capacities: number[] = [];
  const cumuls: CP.CumulExpr[][] = [];

  for (let r = 0; r < nbResources; r++) {
    capacities[r] = input[idx++];
    cumuls[r] = [];
  }

  // Create interval variables
  const jobs: CP.IntervalVar[] = [];
  for (let j = 0; j < nbRealJobs; j++) {
    const itv = model.intervalVar({ name: `T${j + 1}` });
    jobs.push(itv);
  }

  // Skip dummy source job:
  idx = skipExpected(input, idx, 0); // duration
  for (let r = 0; r < nbResources; r++)
    idx = skipExpected(input, idx, 0); // resource requirement
  let nbSuccessors = input[idx++];
  idx += nbSuccessors; // successor IDs

  // Preparation for the makespan: array of end times of the last jobs
  const ends: CP.IntExpr[] = [];

  // Read individual jobs
  for (let j = 0; j < nbRealJobs; j++) {
    const duration = input[idx++];
    jobs[j].lengthMin = duration;
    jobs[j].lengthMax = duration;
    for (let r = 0; r < nbResources; r++) {
      const requirement = input[idx++];
      cumuls[r].push(jobs[j].pulse(requirement));
    }
    nbSuccessors = input[idx++];
    let isLast = true;
    const predecessor = jobs[j];
    for (let s = 0; s < nbSuccessors; s++) {
      const sID = input[idx++];
      assert(sID >= 2 && sID <= nbJobs);
      // Ignore sink job:
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
  idx = skipExpected(input, idx, 0); // duration
  for (let r = 0; r < nbResources; r++)
    idx = skipExpected(input, idx, 0); // resource requirement
  idx = skipExpected(input, idx, 0); // number of successors

  // Constraint height of cumuls:
  for (let r = 0; r < nbResources; r++)
    model.sum(cumuls[r]).le(capacities[r]);

  // Minimize makespan:
  model.max(ends).minimize();

  // There shouldn't be anything more in the input:
  assert(idx === input.length);

  return model;
}

/** Read RCPSP data file in '.sm' format */
function defineModelSM(filename: string) {
  const model = new CP.Model(makeModelName('rcpsp', filename));
  // Read the whole file into memory:
  const inputTxt = readFile(filename).
    // .. and get rid of unnecessary strings:
    // e.g.: ************************************************************************
    replace(/^\*\**$/gm, '')
    // e.g.: file with basedata            : J12022_.BAS
    .replace(/file with basedata *: .*/, '')
    // e.g.: initial value random generator: 22936
    .replace(/initial value random generator: [0-9]*/, '')
    // e.g.: projects                      :  1
    .replace(/projects +: {2}1/, '')
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

  // After this preprocessing there should be only numbers:
  if (!inputTxt.match(/^[ 0-9\n]*$/)) {
    console.log("Failed to remove garbage from the input file. Result after replace:");
    console.log(inputTxt);
    process.exit(1);
  }

  // Convert the input into an array of numbers:
  const input = inputTxt.trim().split(/\s+/).map(Number);
  let idx = 0; // Index for reading input array

  // Read initial numbers at the beginning of the file:
  const nbJobs = input[idx++];
  idx++; // horizon (unused)
  const nbResources = input[idx++];
  idx = skipExpected(input, idx, 1); // pronr
  const nbRealJobs = input[idx++];
  idx = skipExpected(input, idx, 0); // releaseDate
  idx += 3; // dueDate, tardCost, mpmTime (unused)

  assert(nbRealJobs === nbJobs - 2);

  // Create interval variables
  const jobs: CP.IntervalVar[] = [];
  for (let j = 0; j < nbRealJobs; j++) {
    const itv = model.intervalVar({ name: `T${j + 1}` });
    jobs.push(itv);
  }

  // Skip dummy source job:
  idx = skipExpected(input, idx, 1); // job ID
  idx = skipExpected(input, idx, 1); // mode
  let nbSuccessors = input[idx++];
  idx += nbSuccessors; // successor IDs

  // Preparation for the makespan: array of end times of the last jobs
  const ends: CP.IntExpr[] = [];

  // Read precedence relations for the real jobs:
  for (let j = 0; j < nbRealJobs; j++) {
    idx = skipExpected(input, idx, j + 2); // job ID
    idx = skipExpected(input, idx, 1); // number of modes
    let isLast = true;
    const predecessor = jobs[j];
    nbSuccessors = input[idx++];
    for (let s = 0; s < nbSuccessors; s++) {
      const sID = input[idx++];
      assert(sID >= 2 && sID <= nbJobs);
      // Ignore sink job:
      if (sID < nbJobs) {
        const successor = jobs[sID - 2];
        predecessor.endBeforeStart(successor);
        isLast = false;
      }
    }
    if (isLast)
      ends.push(predecessor.end());
  }

  // Minimize makespan:
  model.max(ends).minimize();

  // Skip dummy sink job (precedence):
  idx = skipExpected(input, idx, nbJobs); // jobID
  idx = skipExpected(input, idx, 1); // mode
  idx = skipExpected(input, idx, 0); // number of successors

  // Prepare cumulative resources:
  const cumuls: CP.CumulExpr[][] = Array.from({ length: nbResources }, () => []);

  // Skip dummy source job (duration/resources):
  idx = skipExpected(input, idx, 1); // jobID
  idx = skipExpected(input, idx, 1); // mode
  idx = skipExpected(input, idx, 0); // duration
  for (let r = 0; r < nbResources; r++)
    idx = skipExpected(input, idx, 0); // required capacity

  // Parse job durations and resource requirements
  for (let j = 0; j < nbRealJobs; j++) {
    idx = skipExpected(input, idx, j + 2); // jobID
    idx = skipExpected(input, idx, 1); // mode
    const duration = input[idx++];
    const job = jobs[j];
    job.lengthMin = duration;
    job.lengthMax = duration;
    for (let r = 0; r < nbResources; r++) {
      const c = input[idx++];
      if (c > 0)
        cumuls[r].push(job.pulse(c));
    }
  }

  // Skip dummy sink job (duration/resources):
  idx = skipExpected(input, idx, nbJobs); // jobID
  idx = skipExpected(input, idx, 1); // mode
  idx = skipExpected(input, idx, 0); // duration
  for (let r = 0; r < nbResources; r++)
    idx = skipExpected(input, idx, 0); // required capacity

  // Read available resource capacities:
  for (let r = 0; r < nbResources; r++) {
    const c = input[idx++];
    assert(c > 0);
    model.sum(cumuls[r]).le(c);
  }

  // There shouldn't be anything more in the input:
  assert(idx === input.length);

  return model;
}

function defineModel(filename: string): CP.Model {
  // There are two different file formats: `.sm` and `.rcp`.
  // Check to filename to find out which format it is.
  if (filename.includes('.rcp'))
    return defineModelRCP(filename);
  if (filename.includes('.sm'))
    return defineModelSM(filename);

  console.log(`Unable to guess data format of '${filename}'. Known extensions are .rcp and .sm.`);
  process.exit(1);
}


// Default parameter settings that can be overridden on the command line:
const params: CP.BenchmarkParameters = {
  usage: "Usage: node rcpsp.mjs [OPTIONS] INPUT_FILE [INPUT_FILE2] .."
};
const restArgs = CP.parseSomeBenchmarkParameters(params);
CP.benchmark(defineModel, restArgs, params);
