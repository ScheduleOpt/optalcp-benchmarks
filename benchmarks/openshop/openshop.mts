// Open Shop Scheduling: schedule n jobs on m machines where each job has one
// operation per machine. Operations of a job can run in any order but cannot
// overlap. Minimize makespan.

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

function defineModel(filename: string): CP.Model {
  const input = readFileAsNumberArray(filename);
  const model = new CP.Model(makeModelName("openshop", filename));
  let idx = 0; // Index for reading input array
  const nbJobs = input[idx++];
  const nbMachines = input[idx++];

  // For each machine create an array of operations executed on it.
  // Initialize all machines by empty arrays:
  const machines: CP.IntervalVar[][] = [];
  for (let m = 0; m < nbMachines; m++)
    machines[m] = [];

  // Similarly for each job create an array of its operations:
  const jobs: CP.IntervalVar[][] = [];
  for (let j = 0; j < nbJobs; j++)
    jobs[j] = [];

  // End times of all operations:
  const ends: CP.IntExpr[] = [];

  // Longest operation (for symmetry breaking):
  let longest: CP.IntervalVar|null = null;
  let maxLength = 0;

  for (let j = 0; j < nbJobs; j++) {
    for (let m = 0; m < nbMachines; m++) {
      // Create a new operation:
      const duration = input[idx++];
      const operation = model.intervalVar({length: duration, name: `J${j + 1}M${m + 1}`});
      machines[m].push(operation);
      jobs[j].push(operation);
      ends.push(operation.end());
      if (maxLength < duration) {
        maxLength = duration;
        longest = operation;
      }
    }
  }

  // Tasks on each machine cannot overlap:
  for (let m = 0; m < nbMachines; m++)
    model.noOverlap(machines[m]);
  // Similarly operation of a job cannot overlap:
  for (let j = 0; j < nbJobs; j++)
    model.noOverlap(jobs[j]);

  // Minimize the makespan:
  const makespan = model.max(ends);
  makespan.minimize();

  // Break symmetry.
  // The symmetry is that the backward schedule is a valid solution. So force
  // the longest variable in the first half of the makespan.
  if (longest !== null)
    model.enforce(makespan.minus(longest.length()).div(2).ge(longest.start()));
  // For discussion about symmetry breaking see the following paper:
  // Malapert, Cambazard, Guéret, Jussien, Langevin, Rousseau:
  //   An Optimal Constraint Programming Approach to the Open-Shop Problem

  return model;
}


// Default parameter settings that can be overridden on command line:
const params: CP.BenchmarkParameters = {
  usage: "Usage: node openshop.mjs [OPTIONS] INPUT_FILE1 [INPUT_FILE2] .."
};
const restArgs = CP.parseSomeBenchmarkParameters(params);
CP.benchmark(defineModel, restArgs, params);
