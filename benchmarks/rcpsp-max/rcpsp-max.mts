import { strict as assert } from 'node:assert';
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

function defineModel(filename: string): CP.Model {
  const inputText = readFile(filename);
  // Input files contain characters '[' and ']'. Ignore them and convert the
  // text into an array of numbers:
  const input = inputText.replaceAll(/[\[\]]/g, '').trim().split(/\s+/).map(Number);

  const model = new CP.Model(makeModelName('rcpsp-max', filename));
  let idx = 0; // Index for reading input array

  // Read initial numbers at the beginning of the file:
  const nbRealJobs = input[idx++];
  const nbResources = input[idx++];
  assert(input[idx++] === 0); // number of non-renewable resources?
  assert(input[idx++] === 0); // number of doubly constrained resources?

  // Create interval variables
  const jobs: CP.IntervalVar[] = [];
  // To compute scheduling horizon, it is good to know the maximum delay of
  // precedences starting at the given job:
  const maxDelayAfter: number[] = [];
  for (let j = 0; j < nbRealJobs; j++) {
    const itv = model.intervalVar({ name: `T${j + 1}` });
    jobs.push(itv);
    maxDelayAfter.push(0);
  }

  // Ignore precedence relations for the dummy source job at the beginning:
  assert(input[idx++] === 0); // Job ID
  assert(input[idx++] === 1); // Mode ID
  let nbSuccessors = input[idx++];
  for (let s = 0; s < nbSuccessors; s++)
    idx++; // Successor id
  for (let s = 0; s < nbSuccessors; s++)
    assert(input[idx++] === 0); // Precedence length

  // Preparation for the makespan: array of end times of the last jobs
  const ends: CP.IntExpr[] = [];

  // Read precedence relations for normal jobs:
  for (let j = 0; j < nbRealJobs; j++) {
    assert(input[idx++] === j + 1); // Job ID
    assert(input[idx++] === 1); // Mode ID
    nbSuccessors = input[idx++];
    let countInMakespan = false;
    const predecessor = jobs[j];
    const successors: Array<CP.IntervalVar | null> = [];
    // First there are IDs of the successors:
    for (let s = 0; s < nbSuccessors; s++) {
      const sID = input[idx++];
      assert(sID >= 1 && sID <= nbRealJobs + 1);
      if (sID <= nbRealJobs) {
        // Successor is a normal job:
        successors.push(jobs[sID - 1]);
      } else {
        // Successor is the sink dummy job. Include the predecessor in makespan
        // computation:
        countInMakespan = true;
        successors.push(null);
      }
    }
    // Then read delays and create precedences:
    for (let s = 0; s < nbSuccessors; s++) {
      const delay = input[idx++];
      const successor = successors[s];
      if (successor !== null) {
        // Standard successor
        predecessor.startBeforeStart(successor, delay);
      }
      else {
        // Successor is the dummy sink job. The delay to the sink equals the
        // job's duration. Set it here; we'll verify it matches the duration
        // read later.
        assert(predecessor.lengthMin === 0);
        predecessor.lengthMin = delay;
        predecessor.lengthMax = delay;
      }
      maxDelayAfter[j] = Math.max(maxDelayAfter[j], delay);
    }
    if (countInMakespan)
      ends.push(predecessor.end());
  }

  // Ignore precedences for the dummy sink job:
  assert(input[idx++] === nbRealJobs + 1); // Job ID
  assert(input[idx++] === 1); // Mode ID
  assert(input[idx++] === 0); // Number of successors

  // Read durations and resource usage.
  // First, ignore the dummy source job:
  assert(input[idx++] === 0); // Job ID
  assert(input[idx++] === 1); // Mode ID
  assert(input[idx++] === 0); // Duration
  for (let r = 0; r < nbResources; r++)
    assert(input[idx++] === 0); // Resource requirement

  // Prepare arrays for resources:
  const resources: CP.CumulExpr[][] = [];
  for (let r = 0; r < nbResources; r++)
    resources[r] = [];

  // We're going to compute rough UB (maximum end time) for all interval
  // variables:
  let horizon = 0;

  // Read durations and resource usage for real jobs
  for (let j = 0; j < nbRealJobs; j++) {
    assert(input[idx++] === j + 1); // Job ID
    assert(input[idx++] === 1); // Mode ID
    const duration = input[idx++];
    // We could already set the length as we saw the precedence to dummy sink
    // job. Verify that it is correct:
    assert(jobs[j].lengthMin === 0 || jobs[j].lengthMin === duration);
    horizon += Math.max(duration, maxDelayAfter[j]);
    jobs[j].lengthMin = duration;
    jobs[j].lengthMax = duration;
    for (let r = 0; r < nbResources; r++) {
      const requirement = input[idx++];
      resources[r].push(jobs[j].pulse(requirement));
    }
  }

  // Apply computed horizon:
  for (let j = 0; j < nbRealJobs; j++)
    jobs[j].endMax = horizon;

  // Ignore resource requirements of the dummy sink job:
  assert(input[idx++] === nbRealJobs + 1); // Job ID
  assert(input[idx++] === 1); // Mode ID
  assert(input[idx++] === 0); // Duration
  for (let r = 0; r < nbResources; r++)
    assert(input[idx++] === 0); // Resource usage

  // Read resource capacities and create cumulative constraints:
  for (let r = 0; r < nbResources; r++) {
    const capacity = input[idx++];
    model.sum(resources[r]).le(capacity);
  }

  // There shouldn't be anything more in the input:
  assert(idx === input.length);

  // Minimize makespan:
  model.max(ends).minimize();

  return model;
}


// Default parameter settings that can be overridden on the command line:
const params: CP.BenchmarkParameters = {
  usage: "Usage: node rcpsp-max.mjs [OPTIONS] INPUT_FILE [INPUT_FILE2] .."
};
const restArgs = CP.parseSomeBenchmarkParameters(params);
CP.benchmark(defineModel, restArgs, params);
