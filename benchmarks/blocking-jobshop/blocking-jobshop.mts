import * as fs from "node:fs";
import * as zlib from "node:zlib";
import * as CP from "@scheduleopt/optalcp";

// Blocking job shop: a job blocks its machine until the next machine becomes available.
// Modeled by allowing operations (except the last in each job) to have variable duration.

function readFileAsNumberArray(filename: string): number[] {
  const content = filename.endsWith(".gz")
    ? zlib.gunzipSync(fs.readFileSync(filename), {}).toString()
    : fs.readFileSync(filename, "utf8");
  return content.trim().split(/\s+/).map(Number);
}

function makeModelName(benchmarkName: string, filename: string): string {
  const instanceName = filename
    .replaceAll(/[/\\]/g, "_")
    .replace(/^data_/, "")
    .replace(/\.gz$/, "")
    .replace(/\.json$/, "")
    .replace(/\....?$/, "");
  return `${benchmarkName}_${instanceName}`;
}

// Builds and returns a blocking job-shop scheduling model from the given input file.
function defineModel(filename: string): CP.Model {
  const input = readFileAsNumberArray(filename);
  const model = new CP.Model(makeModelName("blocking-jobshop", filename));
  let idx = 0; // Index for reading input array
  const nbJobs = input[idx++];
  const nbMachines = input[idx++];

  // For each machine create an array of operations executed on it:
  const machines: CP.IntervalVar[][] = Array.from(
    { length: nbMachines },
    () => [],
  );

  // End times of each job:
  const ends: CP.IntExpr[] = [];

  for (let i = 0; i < nbJobs; i++) {
    // Previous task in the job:
    let prev: CP.IntervalVar | undefined = undefined;
    for (let j = 0; j < nbMachines; j++) {
      const machineId = input[idx++];
      const duration = input[idx++];
      // Variable duration models waiting (blocking) on the machine; last operation doesn't block:
      const maxDuration = j < nbMachines - 1 ? CP.IntervalMax : duration;
      const operation = model.intervalVar({
        length: [duration, maxDuration],
        name: `J${i + 1}O${j + 1}M${machineId + 1}`,
      });
      // Add operation to its machine:
      machines[machineId].push(operation);
      // Chain to previous operation:
      if (prev !== undefined)
        prev.endAtStart(operation);
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

const params: CP.BenchmarkParameters = {
  usage:
    "Usage: node blocking-jobshop.mjs [OPTIONS] INPUT_FILE [INPUT_FILE2] ..",
};
const restArgs = CP.parseSomeBenchmarkParameters(params);
CP.benchmark(defineModel, restArgs, params);
