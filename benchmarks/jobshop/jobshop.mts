/**
 * Job shop scheduling problem.
 *
 * Each job is a sequence of operations, each requiring a specific machine for a
 * given duration. Machines process one operation at a time. Minimize the makespan.
 */

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
  return `jobshop_${instance}`;
}

function defineModel(filename: string): CP.Model {
  const input = readFileAsNumberArray(filename);
  const model = new CP.Model(makeModelName(filename));
  let idx = 0; // Index for reading input array
  const nbJobs = input[idx++];
  const nbMachines = input[idx++];

  // For each machine, an array of operations executed on it:
  const machines: CP.IntervalVar[][] = Array.from({ length: nbMachines }, () => []);

  // End times of each job:
  const ends: CP.IntExpr[] = [];

  for (let i = 0; i < nbJobs; i++) {
    // Previous task in the job:
    let prev: CP.IntervalVar | undefined = undefined;
    for (let j = 0; j < nbMachines; j++) {
      const machineId = input[idx++];
      const duration = input[idx++];
      const operation = model.intervalVar({
        length: duration,
        name: `J${i + 1}O${j + 1}M${machineId + 1}`
      });
      machines[machineId].push(operation);
      // Chain with previous operation:
      if (prev !== undefined)
        prev.endBeforeStart(operation);
      prev = operation;
    }
    // End time of the job is end time of the last operation:
    ends.push((prev as CP.IntervalVar).end());
  }

  // Tasks on each machine cannot overlap:
  for (let j = 0; j < nbMachines; j++)
    model.noOverlap(machines[j]);

  // Minimize the makespan:
  const makespan = model.max(ends);
  makespan.minimize();

  return model;
}

const params = {
  usage: "Usage: node jobshop.mjs [OPTIONS] INPUT_FILE1 [INPUT_FILE2] .."
};
const restArgs = CP.parseSomeBenchmarkParameters(params);
CP.benchmark(defineModel, restArgs, params);
