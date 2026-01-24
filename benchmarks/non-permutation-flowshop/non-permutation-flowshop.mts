/**
 * Non-permutation Flowshop Scheduling Problem
 * ============================================
 *
 * The Flowshop Scheduling Problem (FSP) involves scheduling multiple jobs on
 * multiple machines. Each job consists of operations that must be processed
 * on machines in a fixed order (the same for all jobs). The goal is to
 * minimize the makespan: the total time to complete all jobs.
 *
 * In "permutation flowshop", jobs must be processed in the same order on all
 * machines. In "non-permutation flowshop" (this problem), the order of jobs
 * can differ between machines, making it more flexible but harder to solve.
 *
 * Model
 * -----
 *
 * For each operation, we create an interval variable with a fixed length
 * (processing time). Two types of constraints are used:
 *
 *   1. Precedence: Operations of the same job must be executed in order
 *      (job's operation on machine 1 before machine 2, etc.).
 *   2. No-overlap: Each machine can process only one operation at a time.
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
  return `non-permutation-flowshop_${instance}`;
}

/** Reads Taillard format (durations organized by machine). */
function readTaillardFormat(model: CP.Model, input: number[]): void {
  let idx = 0;
  const nbJobs = input[idx++];
  const nbMachines = input[idx++];

  const last: CP.IntervalVar[] = [];  // Previous operation of each job
  for (let j = 0; j < nbMachines; j++) {
    const machine: CP.IntervalVar[] = [];
    for (let i = 0; i < nbJobs; i++) {
      const duration = input[idx++];
      const operation = model.intervalVar({ length: duration, name: `J${i + 1}M${j + 1}` });
      machine.push(operation);
      // Precedence: operation must start after the previous operation of the same job:
      if (last[i])
        last[i].endBeforeStart(operation);
      last[i] = operation;
    }
    // No-overlap: only one job at a time on each machine:
    model.noOverlap(machine);
  }

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

  // No-overlap: only one job at a time on each machine:
  for (let j = 0; j < nbMachines; j++)
    model.noOverlap(machines[j]);

  // Objective: minimize the makespan (max end time over all jobs):
  model.max(ends).minimize();
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
  usage: "Usage: node non-permutation-flowshop.mjs [OPTIONS] INPUT_FILE1 [INPUT_FILE2] .."
};
const restArgs = CP.parseSomeBenchmarkParameters(params);
CP.benchmark(defineModel, restArgs, params);
