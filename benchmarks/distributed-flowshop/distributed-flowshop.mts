/**
 * Distributed flowshop: jobs must be processed on machines in a fixed order (flow-shop),
 * and each job is assigned to exactly one of multiple factories.
 * Permutation variant: jobs are processed in the same order on all machines within a factory.
 */

import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as zlib from "node:zlib";
import * as CP from "@scheduleopt/optalcp";

// Command-line options:
// Use alternative() constraint with redundant cumulative (alternative modeling approach)
let redundantCumul = false;
// Permutation variant: jobs must be processed in the same order on all machines within a factory
let permutation = true;
// Symmetry breaking: last job in last factory, factories ordered by max job number
let symmetryBreaking = true;

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
  const model = new CP.Model(makeModelName("distributed-flowshop", filename));
  let idx = 0;
  const nbJobs = input[idx++];
  const nbMachines = input[idx++];
  const nbFactories = input[idx++];

  // Create interval variables for each job assigned to each factory.
  // operations[f][m][j] = operation of job j on machine m in factory f (optional)
  const operations: CP.IntervalVar[][][] = Array.from(
    { length: nbFactories },
    () => Array.from({ length: nbMachines }, () => []),
  );
  // ends[j] = end time of job j (for makespan)
  const ends: CP.IntExpr[] = [];
  // For symmetry breaking: jobNumbers[f][j] = j if job j assigned to factory f, else 0
  const jobNumbers: CP.IntExpr[][] = Array.from(
    { length: nbFactories },
    () => [],
  );
  // For --redundantCumul: sumMachines[m] = cumulative pulses on machine m
  const sumMachines: CP.CumulExpr[][] = Array.from(
    { length: nbMachines },
    () => [],
  );

  for (let j = 0; j < nbJobs; j++) {
    // Read processing times for this job
    const lengths: number[] = [];
    for (let m = 0; m < nbMachines; m++) {
      assert(m === input[idx++]);
      lengths.push(input[idx++]);
    }

    // For --redundantCumul: main[m] = main interval for job j on machine m
    const main: CP.IntervalVar[] = [];
    const alternatives: CP.IntervalVar[][] = [];
    if (redundantCumul)
      for (let m = 0; m < nbMachines; m++) {
        main.push(
          model.intervalVar({ length: lengths[m], name: `J${j + 1}M${m + 1}` }),
        );
        alternatives[m] = [];
      }

    // Create operations for this job in each factory
    const presences: CP.BoolExpr[] = [];
    for (let f = 0; f < nbFactories; f++) {
      let prev: CP.IntervalVar | null = null;
      let first: CP.IntervalVar | null = null;

      for (let m = 0; m < nbMachines; m++) {
        const operation = model.intervalVar({
          optional: true,
          length: lengths[m],
          name: `J${j + 1}F${f + 1}M${m + 1}`,
        });
        if (redundantCumul) alternatives[m].push(operation);
        operations[f][m].push(operation);

        if (prev !== null) {
          // Flow-shop: previous machine must finish before next starts
          model.endBeforeStart(prev, operation);
          assert(first);
          // All operations of a job in a factory share the same presence
          model.enforce(first.presence().eq(operation.presence()));
        } else {
          first = operation;
        }
        prev = operation;
      }
      assert(first && prev);

      presences.push(first.presence());
      jobNumbers[f].push(first.presence().times(j));
      if (!redundantCumul) ends.push(prev.end());

      // Symmetry breaking: last job must be in last factory
      if (symmetryBreaking && j === nbJobs - 1 && f === nbFactories - 1)
        model.enforce(first.presence().eq(1));
    }

    if (redundantCumul) {
      // Alternative: exactly one factory is chosen for each machine
      for (let m = 0; m < nbMachines; m++) {
        model.alternative(main[m], alternatives[m]);
        sumMachines[m].push(main[m].pulse(1));
      }
      ends.push(main[nbMachines - 1].end());
    } else {
      // Each job must be assigned to exactly one factory
      model.enforce(model.sum(presences).eq(1));
    }
  }

  // Objective: minimize makespan
  model.minimize(model.max(ends));

  // No-overlap: each machine in each factory processes one job at a time
  const machines: CP.SequenceVar[][] = Array.from(
    { length: nbFactories },
    () => [],
  );
  for (let f = 0; f < nbFactories; f++)
    for (let m = 0; m < nbMachines; m++) {
      machines[f][m] = model.sequenceVar(operations[f][m]);
      model.noOverlap(machines[f][m]);
    }

  // Permutation: jobs processed in same order on all machines within a factory
  if (permutation) {
    for (let f = 0; f < nbFactories; f++) {
      // Position variable for each job (same across all machines in this factory)
      const positions: CP.IntExpr[] = Array.from({ length: nbJobs }, (_, j) =>
        model.intVar({ optional: true, name: `Position_F${f + 1}_J${j + 1}` }),
      );
      for (let m = 0; m < nbMachines; m++)
        for (let j = 0; j < nbJobs; j++)
          model.enforce(
            positions[j].identity(operations[f][m][j].position(machines[f][m])),
          );
    }
  }

  // Redundant cumulative: at most nbFactories jobs on each machine simultaneously
  if (redundantCumul) {
    for (let m = 0; m < nbMachines; m++)
      model.sum(sumMachines[m]).le(nbFactories);
  }

  // Symmetry breaking: order factories by highest job number assigned
  if (symmetryBreaking) {
    const maxJobInF = jobNumbers.map((jn) => model.max(jn));
    for (let f = 1; f < nbFactories - 1; f++)
      model.enforce(maxJobInF[f - 1].lt(maxJobInF[f]));
  }

  return model;
}

const params: CP.BenchmarkParameters = {
  usage:
    "Usage: node distributed-flowshop.mjs [OPTIONS] INPUT_FILE1 [INPUT_FILE2] ..\n\n" +
    "Distributed flowshop options:\n" +
    "  --redundantCumul      Use alternative() with redundant cumulative\n" +
    "  --no-permutation      Disable permutation constraint\n" +
    "  --no-symmetryBreaking Disable symmetry breaking constraints",
};
const restArgs = CP.parseSomeBenchmarkParameters(params);

const instanceFiles = restArgs.filter((arg) => {
  if (arg === "--redundantCumul") { redundantCumul = true; return false; }
  if (arg === "--no-permutation") { permutation = false; return false; }
  if (arg === "--no-symmetryBreaking") { symmetryBreaking = false; return false; }
  return true;
});

CP.benchmark(defineModel, instanceFiles, params);
