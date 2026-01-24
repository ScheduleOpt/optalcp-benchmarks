/**
 * Permutation Flowshop Scheduling Problem
 * ========================================
 *
 * The Flowshop Scheduling Problem (FSP) involves scheduling multiple jobs on
 * multiple machines. Each job consists of operations that must be processed
 * on machines in a fixed order (the same for all jobs). The goal is to
 * minimize the makespan: the total time to complete all jobs.
 *
 * In "permutation flowshop" (this problem), jobs must be processed in the
 * same order on all machines. This is more restrictive than "non-permutation
 * flowshop" where the order of jobs can differ between machines.
 *
 * Model
 * -----
 *
 * For each operation, we create an interval variable with a fixed length
 * (processing time). Three types of constraints are used:
 *
 *   1. Precedence: Operations of the same job must be executed in order
 *      (job's operation on machine 1 before machine 2, etc.).
 *   2. No-overlap: Each machine can process only one operation at a time.
 *   3. Same order: Jobs must be processed in the same order on all machines.
 *      This is enforced using position variables and sequence variables.
 *
 * The objective is to minimize the maximum end time across all jobs.
 *
 * Data formats
 * ------------
 *
 * This solver supports two input formats:
 *
 *   1. Taillard format: Numbers are arranged by machine, then by job:
 *        nbJobs nbMachines
 *        J1M1 J2M1 J3M1 ...  (all jobs on machine 1)
 *        J1M2 J2M2 J3M2 ...  (all jobs on machine 2)
 *        ...
 *
 *   2. OR-Library format: Each operation includes its machine ID (0-based):
 *        nbJobs nbMachines
 *        0 J1M1 1 J1M2 2 J1M3 ...  (job 1: machineId duration pairs)
 *        0 J2M1 1 J2M2 2 J2M3 ...  (job 2: machineId duration pairs)
 *        ...
 *      This format is shared with JobShop (flowshop is a special case where
 *      all jobs visit machines in the same order: 0, 1, 2, ...).
 *
 * The solver auto-detects the format by checking if the third number is 0
 * (indicating OR-Library format with machine IDs).
 */

import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as zlib from "node:zlib";
import * as CP from "@scheduleopt/optalcp";

function readFileAsNumberArray(filename: string): number[] {
  const content = filename.endsWith(".gz")
    ? zlib.gunzipSync(fs.readFileSync(filename), {}).toString()
    : fs.readFileSync(filename, "utf8");
  return content.trim().split(/\s+/).map(Number);
}

function makeModelName(filename: string): string {
  const instance = filename
    .replaceAll(/[/\\]/g, "_")
    .replace(/^data_/, "")
    .replace(/\.gz$/, "")
    .replace(/\.json$/, "")
    .replace(/\....?$/, "");
  return `permutation-flowshop_${instance}`;
}

/** Adds permutation constraints: all jobs have the same position on all machines. */
function addPermutationConstraints(
  model: CP.Model,
  machines: CP.IntervalVar[][],  // machines[machineId][jobId]
  nbJobs: number,
  nbMachines: number
): void {
  // Position variable for each job (same across all machines):
  const positionVars: CP.IntVar[] = [];
  for (let i = 0; i < nbJobs; i++)
    positionVars.push(model.intVar({ name: `position${i + 1}` }));

  // Create sequence variable for each machine and enforce permutation:
  for (let j = 0; j < nbMachines; j++) {
    const seq = model.sequenceVar(machines[j]);
    model.noOverlap(seq);
    for (let i = 0; i < nbJobs; i++)
      model.enforce(positionVars[i].eq(model.position(machines[j][i], seq)));
  }
}

/** Reads Taillard format (durations organized by machine). */
function readTaillardFormat(model: CP.Model, input: number[]): void {
  let idx = 0;
  const nbJobs = input[idx++];
  const nbMachines = input[idx++];

  const machines: CP.IntervalVar[][] = Array.from({ length: nbMachines }, () => []);
  const last: CP.IntervalVar[] = [];  // Previous operation of each job

  for (let j = 0; j < nbMachines; j++) {
    for (let i = 0; i < nbJobs; i++) {
      const duration = input[idx++];
      const operation = model.intervalVar({ length: duration, name: `J${i + 1}M${j + 1}` });
      machines[j].push(operation);
      // Precedence: operation must start after the previous operation of the same job:
      if (last[i])
        last[i].endBeforeStart(operation);
      last[i] = operation;
    }
  }

  addPermutationConstraints(model, machines, nbJobs, nbMachines);

  // Objective: minimize the makespan (max end time over all jobs):
  const ends: CP.IntExpr[] = last.map(op => op.end());
  model.max(ends).minimize();

  assert(idx === input.length);
}

/** Reads OR-Library format (with machine IDs in input). */
function readORLibraryFormat(model: CP.Model, input: number[]): void {
  let idx = 0;
  const nbJobs = input[idx++];
  const nbMachines = input[idx++];

  const machines: CP.IntervalVar[][] = Array.from({ length: nbMachines }, () => []);
  const ends: CP.IntExpr[] = [];

  for (let i = 0; i < nbJobs; i++) {
    let prev: CP.IntervalVar | undefined = undefined;
    for (let j = 0; j < nbMachines; j++) {
      const machineId = input[idx++];
      const duration = input[idx++];
      const operation = model.intervalVar({
        length: duration,
        name: `J${i + 1}O${j + 1}M${machineId + 1}`
      });
      machines[machineId].push(operation);
      // Precedence: operation must start after the previous operation of the same job:
      if (prev !== undefined)
        prev.endBeforeStart(operation);
      prev = operation;
    }
    ends.push((prev as CP.IntervalVar).end());
  }

  addPermutationConstraints(model, machines, nbJobs, nbMachines);

  // Objective: minimize the makespan (max end time over all jobs):
  model.max(ends).minimize();

  assert(idx === input.length);
}

function defineModel(filename: string): CP.Model {
  const input = readFileAsNumberArray(filename);
  const model = new CP.Model(makeModelName(filename));

  // Detect format: OR-Library format has machine ID (0) as the third number.
  const isORLibraryFormat = input[2] === 0;

  if (isORLibraryFormat)
    readORLibraryFormat(model, input);
  else
    readTaillardFormat(model, input);

  return model;
}

const params: CP.BenchmarkParameters = {
  usage: "Usage: node permutation-flowshop.mjs [OPTIONS] INPUT_FILE1 [INPUT_FILE2] .."
};
const restArgs = CP.parseSomeBenchmarkParameters(params);
CP.benchmark(defineModel, restArgs, params);
