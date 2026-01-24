/**
 * Multi-Mode Resource-Constrained Project Scheduling Problem (MMRCPSP).
 *
 * Jobs must be scheduled respecting precedence constraints. Each job has multiple
 * execution modes with different durations and resource requirements. Renewable
 * resources have per-time-step capacity limits. Non-renewable resources have
 * total capacity limits across the entire project.
 *
 * Objective: minimize non-renewable resource overflow (as penalty), then makespan.
 */

import { strict as assert } from 'node:assert';
import * as fs from "node:fs";
import { exit } from 'node:process';
import * as zlib from "node:zlib";
import * as CP from "@scheduleopt/optalcp";

function readFile(filename: string): string {
  return filename.endsWith(".gz")
    ? zlib.gunzipSync(fs.readFileSync(filename), {}).toString()
    : fs.readFileSync(filename, "utf8");
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

function skipExpected(arr: Array<number>, idx: number, expected: number): number {
  const v = arr[idx];
  assert(v === expected);
  return idx + 1;
}

// Command-line options:
// Add redundant cumulative constraints on main job intervals (variable pulse heights)
let useRedundantCumuls = false;
// Add a single cumulative constraint summing all renewable resources
let useGlobalCumul = false;
// Add a single constraint summing all non-renewable resources
let useGlobalNonRenewable = false;

function defineModel(filename: string): CP.Model {
  let inputTxt = readFile(filename);
  const model = new CP.Model(makeModelName("mmrcpsp", filename));

  const hasProjectInformation = /PROJECT INFORMATION:/.test(inputTxt);
  // Remove text labels from the input file, keeping only numbers:
  inputTxt = inputTxt.
    // e.g.: ************************************************************************
    replace(/^\*\**$/gm, '')
    // e.g.: file with basedata            : J12022_.BAS
    .replace(/file with basedata *: .*/, '')
    // e.g.: initial value random generator: 22936
    .replace(/initial value random generator: [0-9]*/, '')
    // e.g.: projects                      :  1
    .replace(/projects +: {2}1/, '')
    // e.g.: jobs (incl. supersource/sink ):
    .replace(/jobs *\(incl. supersource\/sink \):/, '')
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

  // After this preprocessing there should be only numbers:
  if (!inputTxt.match(/^[ \t0-9\r\n]*$/)) {
    console.log("Failed to remove garbage from the input file. Result after replace:");
    console.log(inputTxt);
    exit(1);
  }

  // Convert the input into an array of numbers:
  const input = inputTxt.trim().split(/\s+/).map(Number);
  let idx = 0;

  // Problem dimensions:
  const nbJobs = input[idx++];
  const nbRealJobs = nbJobs - 2; // Excluding dummy source and sink jobs
  const nbResources = input[idx++]; // Renewable resources
  const nbNonRenewable = input[idx++];

  if (hasProjectInformation) {
    const pronr = input[idx++];
    const nbNonDummyJobs = input[idx++];
    const releaseDate = input[idx++];
    const dueDate = input[idx++]; // unused
    const tardCost = input[idx++]; // unused
    const mpmTime = input[idx++]; // unused
    assert(pronr === 1);
    assert(nbNonDummyJobs === nbRealJobs);
    assert(releaseDate === 0);
  }

  // Create main interval variable for each job (mode selection via alternative below):
  const jobs: CP.IntervalVar[] = [];
  for (let j = 0; j < nbRealJobs; j++) {
    const itv = model.intervalVar({ name: `J${j + 1}` });
    jobs.push(itv);
  }

  // Skip precedence relations for the dummy source job:
  idx = skipExpected(input, idx, 1); // job ID
  idx = skipExpected(input, idx, 1); // number of modes
  let nbSuccessors = input[idx++];
  for (let s = 0; s < nbSuccessors; s++)
    idx++;

  const nbModes: number[] = []; // Number of modes for each job (read from precedence section)
  const ends: CP.IntExpr[] = []; // End times of jobs with no successors (for makespan)

  // Read precedence relations and add endBeforeStart constraints:
  for (let j = 0; j < nbRealJobs; j++) {
    idx = skipExpected(input, idx, j + 2); // job ID
    nbModes[j] = input[idx++];
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

  // Skip precedence relations of the dummy sink job:
  idx = skipExpected(input, idx, nbJobs); // jobID
  idx = skipExpected(input, idx, 1); // mode
  idx = skipExpected(input, idx, 0); // number of successors

  // Cumulative expressions for renewable resources (per-resource capacity limits):
  const cumuls: CP.CumulExpr[][] = Array.from({ length: nbResources }, () => []);
  const redundantCumuls: CP.CumulExpr[][] = Array.from({ length: nbResources }, () => []);
  const globalCumul: CP.CumulExpr[] = [];
  // Integer expressions for non-renewable resources (total usage across project):
  const nonRenewables: CP.IntExpr[][] = Array.from({ length: nbNonRenewable }, () => []);
  const globalNonRenewable: CP.IntExpr[] = [];

  // Skip duration and resource requirements of dummy source job:
  idx = skipExpected(input, idx, 1); // jobID
  idx = skipExpected(input, idx, 1); // mode
  idx = skipExpected(input, idx, 0); // duration
  for (let r = 0; r < nbResources; r++)
    idx = skipExpected(input, idx, 0); // required capacity
  for (let n = 0; n < nbNonRenewable; n++)
    idx = skipExpected(input, idx, 0); // required capacity

  // Parse job modes with durations and resource requirements:
  for (let j = 0; j < nbRealJobs; j++) {
    idx = skipExpected(input, idx, j + 2); // jobID
    const modes: CP.IntervalVar[] = []; // Optional interval for each mode

    const renewableRequirements: number[][] = Array.from({ length: nbResources }, () => []);
    for (let a = 0; a < nbModes[j]; a++) {
      idx = skipExpected(input, idx, a + 1); // mode
      const duration = input[idx++];
      const mode = model.intervalVar({ optional: true, length: duration, name: `J${j + 1}M${a + 1}` });
      modes.push(mode);
      let totalC = 0;
      for (let r = 0; r < nbResources; r++) {
        const c = input[idx++];
        renewableRequirements[r][a] = c;
        totalC += c;
      }
      globalCumul.push(modes[a].pulse(totalC));
      totalC = 0;
      for (let n = 0; n < nbNonRenewable; n++) {
        const c = input[idx++];
        nonRenewables[n].push(mode.presence().times(c));
        totalC += c;
      }
      globalNonRenewable.push(mode.presence().times(totalC));
    }
    // Add cumulative pulses for renewable resources:
    for (let r = 0; r < nbResources; r++) {
      let minC = renewableRequirements[r][0];
      let maxC = minC;
      for (let a = 1; a < nbModes[j]; a++) {
        minC = Math.min(minC, renewableRequirements[r][a]);
        maxC = Math.max(maxC, renewableRequirements[r][a]);
      }
      if (maxC === 0)
        continue; // Job doesn't use this resource in any mode
      if (minC === maxC) {
        // All modes have the same requirement: use main job interval
        cumuls[r].push(jobs[j].pulse(minC));
        redundantCumuls[r].push(jobs[j].pulse(minC));
        continue;
      }
      // Variable requirement: add pulse for each mode interval
      const heights: CP.IntExpr[] = [];
      for (let a = 0; a < nbModes[j]; a++) {
        const c = renewableRequirements[r][a];
        heights.push(modes[a].presence().times(c));
        if (c === 0)
          continue;
        cumuls[r].push(modes[a].pulse(c));
      }
      // Redundant: pulse on main interval with variable height
      redundantCumuls[r].push(jobs[j].pulse(model.sum(heights)));
    }
    // Exactly one mode must be selected for each job:
    model.alternative(jobs[j], modes);
  }

  // Skip duration and resource requirements of dummy sink job:
  idx = skipExpected(input, idx, nbJobs); // jobID
  idx = skipExpected(input, idx, 1); // mode
  idx = skipExpected(input, idx, 0); // duration
  for (let r = 0; r < nbResources; r++)
    idx = skipExpected(input, idx, 0); // required capacity
  for (let n = 0; n < nbNonRenewable; n++)
    idx = skipExpected(input, idx, 0); // required capacity

  // Renewable resource capacity constraints:
  let globalC = 0;
  for (let r = 0; r < nbResources; r++) {
    const c = input[idx++];
    assert(c > 0);
    globalC += c;
    model.sum(cumuls[r]).le(c);
    if (useRedundantCumuls)
      model.sum(redundantCumuls[r]).le(c);
  }
  if (useGlobalCumul)
    model.sum(globalCumul).le(globalC);

  // Non-renewable resource constraints (soft: overflow adds to cost):
  const cost: CP.IntExpr[] = [];
  globalC = 0;
  for (let n = 0; n < nbNonRenewable; n++) {
    const c = input[idx++];
    globalC += c;
    const used = model.sum(nonRenewables[n]);
    const overflow = model.max2(0, used.minus(c));
    cost.push(overflow);
  }
  if (useGlobalNonRenewable) {
    const used = model.sum(globalNonRenewable);
    const overflow = model.max2(0, used.minus(globalC));
    cost.push(overflow);
  }

  // Objective: minimize overflow penalty (×1000) + makespan (lexicographic-like):
  model.minimize(model.sum(cost).times(1000).plus(model.max(ends)));

  return model;
}


// Default parameter settings that can be overridden on command line:
const params: CP.BenchmarkParameters = {
  usage:
    "Usage: node mmrcpsp.mjs [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n" +
    "MMRCPSP options:\n" +
    "  --redundantCumuls     Add redundant cumulative constraints\n" +
    "  --globalCumul         Add global cumulative constraint\n" +
    "  --globalNonRenewable  Add global non-renewable resource constraint",
};
const restArgs = CP.parseSomeBenchmarkParameters(params);

const instanceFiles = restArgs.filter((arg) => {
  if (arg === "--redundantCumuls") { useRedundantCumuls = true; return false; }
  if (arg === "--globalCumul") { useGlobalCumul = true; return false; }
  if (arg === "--globalNonRenewable") { useGlobalNonRenewable = true; return false; }
  return true;
});

CP.benchmark(defineModel, instanceFiles, params);
