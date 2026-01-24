/**
 * Job Shop Scheduling with sequence-dependent transition times: jobs consist of
 * operations that must be processed on specific machines in order. Transition
 * times between operations on the same machine depend on the operation sequence.
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

function makeModelName(benchmarkName: string, filename: string): string {
  const instance = filename
    .replaceAll(/[/\\]/g, "_")
    .replace(/^data_/, "")
    .replace(/\.gz$/, "")
    .replace(/\.json$/, "")
    .replace(/\....?$/, "");
  return `${benchmarkName}_${instance}`;
}

// Xorshift32 PRNG for reproducible random numbers:
let randomState = 1;
function random(): number {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return (randomState >>> 0) / 0xffffffff;
}

// Command-line option:
let maxTT = 20; // Maximum transition time (controls random point spread)

export function defineModel(filename: string): CP.Model {
  const input = readFileAsNumberArray(filename);
  const model = new CP.Model(makeModelName("jobshop-tt", filename));
  let idx = 0; // Index for reading input array
  const nbJobs = input[idx++];
  const nbMachines = input[idx++];

  // Seed the PRNG from instance data for reproducibility:
  randomState = input.reduce((a, b) => a + b, 0) || 1;

  // For each machine create an array of operations executed on it:
  const machines: CP.IntervalVar[][] = Array.from({ length: nbMachines }, () => []);

  // End times of each job:
  const ends: CP.IntExpr[] = [];

  for (let i = 0; i < nbJobs; i++) {
    // Previous task in the job:
    let prev: CP.IntervalVar | undefined = undefined;
    for (let j = 0; j < nbMachines; j++) {
      // Create a new operation:
      const machineId = input[idx++];
      const duration = input[idx++];
      if (machineId >= nbMachines)
        throw new Error(`Invalid machine ID ${machineId} (only ${nbMachines} machines)`);
      const operation = model.intervalVar({
        length: duration,
        name: `J${i + 1}O${j + 1}M${machineId + 1}`
      });
      // Operation requires some machine:
      machines[machineId].push(operation);
      // Operation has a predecessor:
      if (prev !== undefined)
        prev.endBeforeStart(operation);
      prev = operation;
    }
    // End time of the job is end time of the last operation:
    ends.push((prev as CP.IntervalVar).end());
  }

  // Tasks on each machine cannot overlap:
  for (let j = 0; j < nbMachines; j++) {
    // Create transition times from random 2D points (Euclidean distances):
    const points = Array.from({ length: nbJobs }, () => ({
      x: Math.round(random() * maxTT),
      y: Math.round(random() * maxTT)
    }));
    const matrix = points.map(p1 =>
      points.map(p2 => Math.round(Math.hypot(p1.x - p2.x, p1.y - p2.y)))
    );
    model.noOverlap(model.sequenceVar(machines[j]), matrix);
  }

  // Minimize the makespan:
  const makespan = model.max(ends);
  makespan.minimize();

  return model;
}

// Command-line argument parsing:
function getIntOption(name: string, defaultValue: number, args: string[]): number {
  const index = args.indexOf(name);
  if (index === -1)
    return defaultValue;
  const value = Number.parseInt(args[index + 1]);
  args.splice(index, 2);
  return value;
}

const params: CP.BenchmarkParameters = {
  usage: "Usage: node jobshop-tt.mjs [OPTIONS] INPUT_FILE1 [INPUT_FILE2] ..\n\n" +
    "Jobshop-tt options:\n" +
    "  --maxTT <number>  Maximum transition time (default: 20)"
};

const restArgs = CP.parseSomeBenchmarkParameters(params);
maxTT = getIntOption("--maxTT", maxTT, restArgs);
CP.benchmark(defineModel, restArgs, params);
