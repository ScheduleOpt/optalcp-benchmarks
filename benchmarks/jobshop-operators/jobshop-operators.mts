/**
 * Job shop with operators: each operation requires both a machine and an operator.
 * The number of operators is limited, adding a cumulative resource constraint.
 */

import * as fs from "node:fs";
import * as zlib from "node:zlib";
import * as CP from "@scheduleopt/optalcp";

// Command-line option:
let nbOperators = 0; // 0 means not specified (will error)

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
  return `jobshop-operators_${instance}_${nbOperators}opers`;
}

function defineModel(filename: string): CP.Model {
  const input = readFileAsNumberArray(filename);
  const model = new CP.Model(makeModelName(filename));
  let idx = 0;
  const nbJobs = input[idx++];
  const nbMachines = input[idx++];

  // For each machine, an array of operations executed on it:
  const machines: CP.IntervalVar[][] = Array.from({ length: nbMachines }, () => []);

  // End times of each job:
  const ends: CP.IntExpr[] = [];

  // Cumulative pulses for operator requirements:
  const operatorRequirements: CP.CumulExpr[] = [];

  for (let i = 0; i < nbJobs; i++) {
    let prev: CP.IntervalVar | undefined = undefined;
    for (let j = 0; j < nbMachines; j++) {
      const machineId = input[idx++];
      const duration = input[idx++];
      const operation = model.intervalVar({
        length: duration,
        name: `J${i + 1}O${j + 1}M${machineId + 1}`,
      });
      machines[machineId].push(operation);
      // Each operation requires an operator:
      operatorRequirements.push(operation.pulse(1));
      // Chain with previous operation:
      if (prev !== undefined)
        prev.endBeforeStart(operation);
      prev = operation;
    }
    ends.push((prev as CP.IntervalVar).end());
  }

  // Tasks on each machine cannot overlap:
  for (let j = 0; j < nbMachines; j++)
    model.noOverlap(machines[j]);

  // Limited number of operators:
  model.sum(operatorRequirements).le(nbOperators);

  // Minimize the makespan:
  const makespan = model.max(ends);
  makespan.minimize();

  return model;
}

const params: CP.BenchmarkParameters = {
  usage: "Usage: node jobshop-operators.mjs --nbOperators <n> [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n" +
    "Jobshop-operators options:\n" +
    "  --nbOperators <number>  Number of available operators (required)",
};

// Simple command-line argument parsing:
function getIntOption(name: string, defaultValue: number, args: string[]): number {
  const index = args.indexOf(name);
  if (index === -1)
    return defaultValue;
  const value = Number.parseInt(args[index + 1]);
  args.splice(index, 2);
  return value;
}

const restArgs = CP.parseSomeBenchmarkParameters(params);
nbOperators = getIntOption("--nbOperators", nbOperators, restArgs);

if (nbOperators <= 0) {
  console.error("Missing or invalid --nbOperators argument.");
  process.exit(1);
}

CP.benchmark(defineModel, restArgs, params);
