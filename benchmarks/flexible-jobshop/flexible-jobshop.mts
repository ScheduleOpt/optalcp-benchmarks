/**
 * Flexible Job Shop Scheduling Problem (FJSSP):
 * Each job consists of a sequence of operations that must be processed in order.
 * Each operation can be processed on one of several machines (flexibility).
 * Objective: minimize the makespan (completion time of all jobs).
 */

import { strict as assert } from "node:assert";
import * as fs from "node:fs";
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

let redundantCumul = false;

function defineModel(filename: string): CP.Model {
  // Parse input file: first line has nbJobs and nbMachines, rest is job data
  const inputText = readFile(filename);
  const firstEOL = inputText.indexOf("\n");
  const firstLine = inputText.slice(0, firstEOL).trim().split(/\s+/).map(Number);
  const input = inputText.slice(firstEOL + 1).trim().split(/\s+/).map(Number);

  const model = new CP.Model(makeModelName("flexible-jobshop", filename));
  const nbJobs = firstLine[0];
  const nbMachines = firstLine[1];

  // Operations assigned to each machine (for no-overlap constraints):
  const machines: CP.IntervalVar[][] = Array.from({ length: nbMachines }, () => []);

  // End times of each job (for makespan calculation):
  const ends: CP.IntExpr[] = [];

  // For --redundantCumul: cumulative pulses across all machines
  const allMachines: CP.CumulExpr[] = [];

  let idx = 0; // Index for reading input array

  for (let i = 0; i < nbJobs; i++) {
    const nbOperations = input[idx++];
    let prev: CP.IntervalVar | undefined = undefined;
    for (let j = 0; j < nbOperations; j++) {
      // Create operation (master interval for alternative constraint):
      const operation = model.intervalVar({ name: `J${i + 1}O${j + 1}` });
      // Create one optional mode for each machine that can process this operation:
      const nbModes = input[idx++];
      const modes: CP.IntervalVar[] = [];
      for (let k = 0; k < nbModes; k++) {
        const machineId = input[idx++];
        const duration = input[idx++];
        const mode = model.intervalVar({
          length: duration,
          optional: true,
          name: `J${i + 1}O${j + 1}_M${machineId}`,
        });
        machines[machineId - 1].push(mode); // machines are 1-indexed in input
        modes.push(mode);
      }
      // Exactly one mode must be selected:
      model.alternative(operation, modes);
      // Operations within a job must be sequenced:
      if (prev !== undefined)
        prev.endBeforeStart(operation);
      prev = operation;
      if (redundantCumul)
        allMachines.push(operation.pulse(1));
    }
    ends.push((prev as CP.IntervalVar).end());
  }

  // No-overlap: each machine processes one operation at a time
  for (let m = 0; m < nbMachines; m++)
    model.noOverlap(machines[m]);

  // Redundant cumulative: at most nbMachines operations simultaneously
  if (redundantCumul)
    model.sum(allMachines).le(nbMachines);

  // Minimize makespan (completion time of all jobs):
  model.minimize(model.max(ends));

  assert(idx === input.length);

  return model;
}

const params: CP.BenchmarkParameters = {
  usage:
    "Usage: node flexible-jobshop.mjs [OPTIONS] INPUT_FILE1 [INPUT_FILE2] ..\n\n" +
    "Flexible JobShop options:\n" +
    "  --redundantCumul    Add a redundant cumul constraint",
};

const restArgs = CP.parseSomeBenchmarkParameters(params);

const instanceFiles = restArgs.filter((arg) => {
  if (arg === "--redundantCumul") { redundantCumul = true; return false; }
  return true;
});

CP.benchmark(defineModel, instanceFiles, params);
