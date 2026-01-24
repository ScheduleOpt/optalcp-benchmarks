import * as CP from "@scheduleopt/optalcp";
import * as parsetsp from './parsetsp.mjs';

function makeModelName(benchmarkName: string, filename: string): string {
  const instance = filename
    .replaceAll(/[/\\]/g, "_")
    .replace(/^data_/, "")
    .replace(/\.gz$/, "")
    .replace(/\.json$/, "")
    .replace(/\....?$/, "");
  return `${benchmarkName}_${instance}`;
}

// Command-line options:
let checkDirectionSymmetry = false;
let checkTriangularInequality = false;
let visitDuration = 0;
let forceCeil = false;
let breakDirectionSymmetry = false;

function defineModel(filename: string): CP.Model {
  const { nbNodes, transitionMatrix, hasDirectionSymmetry }
    = parsetsp.parse(filename, { checkDirectionSymmetry, checkTriangularInequality, visitDuration, forceCeil });

  const model = new CP.Model(makeModelName('tsp', filename));

  // The times of the visits (named N_1, N_2, ... to match 1-based file numbering):
  const intervals = Array.from({ length: nbNodes }, (_, i) => model.intervalVar({ length: visitDuration, name: `N_${i + 1}` }));

  // We're looking for a cycle that visits all nodes exactly once. So we can
  // choose which node starts the cycle. Let's choose node 0 (N_1), fixed at time 0.
  intervals[0].startMin = 0;
  intervals[0].startMax = 0;

  // The `last` interval marks the return to node 0, handled separately from the sequence:
  const last = model.intervalVar({ length: 0, name: 'last' });

  // Remaining nodes (1..n-1) must be visited in a sequence with transition times.
  // Trim the matrix to exclude row/column 0 (handled separately for the starting node).
  const trimmedMatrix = transitionMatrix.slice(1).map(row => row.slice(1));
  const sequence = model.sequenceVar(intervals.slice(1));
  model.noOverlap(sequence, trimmedMatrix);

  for (let i = 1; i < nbNodes; i++) {
    // The first node is not part of the sequence, so we have to propagate the transition matrix manually:
    model.endBeforeStart(intervals[0], intervals[i], transitionMatrix[0][i]);
    // The last node must be after all the other nodes, taking into account the transition matrix:
    model.endBeforeStart(intervals[i], last, transitionMatrix[i][0]);
  }

  // Minimize total travel distance (subtract visit durations from total time):
  model.minimize(last.end().minus(nbNodes * visitDuration));

  if (hasDirectionSymmetry && breakDirectionSymmetry && nbNodes > 2) {
    // If we reverse the order of the nodes, the solution will be the same. So,
    // we can break the symmetry by choosing any node and forcing it to be in
    // the first half of the cycle. Let's choose a node with the maximum
    // distance from node 0:
    let maxDistance = 0;
    let maxDistanceNode = 0;
    for (let i = 1; i < nbNodes; i++) {
      if (transitionMatrix[0][i] > maxDistance) {
        maxDistance = transitionMatrix[0][i];
        maxDistanceNode = i;
      }
    }
    model.enforce(intervals[maxDistanceNode].end().times(2).le(last.end()));
  }

  return model;
}

// Simple command-line argument parsing:
function getBoolOption(name: string, args: string[]): boolean {
  const index = args.indexOf(name);
  if (index === -1)
    return false;
  args.splice(index, 1);
  return true;
}
function getIntOption(name: string, defaultValue: number, args: string[]): number {
  const index = args.indexOf(name);
  if (index === -1)
    return defaultValue;
  const value = parseInt(args[index + 1]);
  args.splice(index, 2);
  return value;
}

const params: CP.BenchmarkParameters = {
  usage: "Usage: node tsp.mjs [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n" +
    "TSP options:\n" +
    "  --checkTriangularInequality  Warn if triangular inequality is not respected\n" +
    "  --visitDuration <number>     Duration of each visit (the default is 0)\n" +
    "  --forceCeil                  Round up during distance computation\n" +
    "  --checkDirectionSymmetry     Warn if the distance matrix is not symmetrical\n" +
    "  --breakDirectionSymmetry     Break the direction symmetry of the solution"
};
const restArgs = CP.parseSomeBenchmarkParameters(params);
// Look for the optional parameters:
checkTriangularInequality = getBoolOption("--checkTriangularInequality", restArgs);
visitDuration = getIntOption("--visitDuration", visitDuration, restArgs);
forceCeil = getBoolOption("--forceCeil", restArgs);
checkDirectionSymmetry = getBoolOption("--checkDirectionSymmetry", restArgs);
breakDirectionSymmetry = getBoolOption("--breakDirectionSymmetry", restArgs);

CP.benchmark(defineModel, restArgs, params);