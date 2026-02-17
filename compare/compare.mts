import * as fs from 'fs';
import * as CP from "@scheduleopt/optalcp";
import * as lib from './src/lib.mjs';
import * as zlib from "node:zlib";
import { dirname } from 'path';
import { strict as assert } from 'assert';
import { fileURLToPath } from 'url';

function readFile(filename: string): string {
  return filename.endsWith(".gz")
    ? zlib.gunzipSync(fs.readFileSync(filename), {}).toString()
    : fs.readFileSync(filename, "utf8");
}

// For normalization, we require that the objective is a number
function canBeNormalized(result: CP.NormalBenchmarkResult): boolean {
  for (let h of result.objectiveHistory)
    if (typeof h.objective != "number")
      return false;
  for (let h of result.lowerBoundHistory)
    if (typeof h.value != "number")
      return false;
  return true;
}

// Objectives must be numbers and at both runs had to find a solution
function canBeNormalizedPair(pair: lib.Pair): boolean {
  if (!canBeNormalized(pair.a))
    return false;
  if (!canBeNormalized(pair.b))
    return false;
  if (pair.a.objectiveHistory.length == 0 || pair.b.objectiveHistory.length == 0)
    return false;
  return true;
}

// Get value of the best solution from the pair.
// Assumes that canBeNormalizedPair returned true.
// TODO: Assumes minimization
function getBestSolution(pair: lib.Pair): number {
  let historyA = pair.a.objectiveHistory;
  let historyB = pair.b.objectiveHistory;
  if (historyA.length > 0) {
    let lastA = historyA[historyA.length - 1].objective;
    assert(typeof lastA == "number");
    if (historyB.length > 0) {
      let lastB = historyB[historyB.length - 1].objective;
      assert(typeof lastB == "number");
      return Math.min(lastA, lastB);
    }
    return lastA;
  }
  assert(historyB.length > 0);
  let lastB = historyB[historyB.length - 1].objective;
  assert(typeof lastB == "number");
  return lastB;
}

// Skip items at the beginning with solveTime < minTimeCutoff, but keep the last one before minTimeCutoff (if there is one).
function removeInitialObjectiveHistory(history: CP.ObjectiveHistoryItem[], minTimeCutoff: number): CP.ObjectiveHistoryItem[] {
  let result: CP.ObjectiveHistoryItem[] = [];
  let lastBeforeSkip: CP.ObjectiveHistoryItem | null = null;
  for (let h of history) {
    if (h.solveTime < minTimeCutoff) {
      lastBeforeSkip = h;
    } else {
      if (lastBeforeSkip !== null) {
        result.push(lastBeforeSkip);
        lastBeforeSkip = null;
      }
      result.push(h);
    }
  }
  if (lastBeforeSkip !== null)
    result.push(lastBeforeSkip);
  return result;
}

function removeInitialLowerBoundHistory(history: CP.LowerBoundEvent[], minTimeCutoff: number): CP.LowerBoundEvent[] {
  let result: CP.LowerBoundEvent[] = [];
  let lastBeforeSkip: CP.LowerBoundEvent | null = null;
  for (let h of history) {
    if (h.solveTime < minTimeCutoff) {
      lastBeforeSkip = h;
    } else {
      if (lastBeforeSkip !== null) {
        result.push(lastBeforeSkip);
        lastBeforeSkip = null;
      }
      result.push(h);
    }
    if (lastBeforeSkip !== null)
      result.push(lastBeforeSkip);
  }
  return result;
}

function normalizeObjectiveHistory(history: CP.ObjectiveHistoryItem[], bestSolution: number, duration: number): lib.NormalizedHistoryItem[] {
  let normalizedHistory: lib.NormalizedHistoryItem[] = [];
  if (history.length == 0)
    return normalizedHistory;
  for (let h of history) {
    let value = h.objective;
    assert(typeof value == "number");
    let time = h.solveTime;
    normalizedHistory.push({
      value: value / bestSolution,
      time: time
    });
  }
  let lastValue = normalizedHistory[normalizedHistory.length - 1].value;
  normalizedHistory.push({ value: lastValue, time: duration });
  return normalizedHistory;
}

function normalizeLowerBoundHistory(history: CP.LowerBoundEvent[], bestSolution: number, duration: number): lib.NormalizedHistoryItem[] {
  let normalizedHistory: lib.NormalizedHistoryItem[] = [];
  if (history.length == 0)
    return normalizedHistory;
  for (let h of history) {
    let value = h.value;
    assert(typeof value == "number");
    let time = h.solveTime;
    normalizedHistory.push({
      value: value / bestSolution,
      time: time
    });
  }
  let lastValue = normalizedHistory[normalizedHistory.length - 1].value;
  normalizedHistory.push({value: lastValue, time: duration});
  return normalizedHistory;
}


function calcNormalizedPlot(data: lib.NormalizedHistoryItem[][]) : lib.NormalizedHistoryItem[] {
  type ValueChange = {
    prevValue: number;
    newValue: number;
    time: number;
  }
  let changes: ValueChange[] = [];
  let nbLines = 0;
  let currSum = 0;
  const n = data.length;
  for (let h of data) {
    assert(h.length > 0);
    // We added artificial point at time 0:
    assert(h[0].time == 0);
    currSum += h[0].value;
    for (let i = 1; i < h.length; i++)
      changes.push({ prevValue: h[i - 1].value, newValue: h[i].value, time: h[i].time });
  }
  changes.sort((a, b) => a.time - b.time);
  let result: lib.NormalizedHistoryItem[] = [];
  for (let change of changes) {
    currSum -= change.prevValue;
    currSum += change.newValue;
    if (change.time >= 1)
      result.push({ value: currSum / n, time: change.time });
  }
  return result;
}

function calcGlobalPlot(history: lib.Pair[]): lib.NormalizedHistory {
  let objectiveHistoriesA = [];
  let objectiveHistoriesB = [];
  let lowerBoundHistoriesA = [];
  let lowerBoundHistoriesB = [];
  for (let pair of history) {
    if (!canBeNormalizedPair(pair))
      continue;
    let bestSolution = getBestSolution(pair);
    if (bestSolution == 0)
      bestSolution = 1; // Avoid division by zero
    objectiveHistoriesA.push(normalizeObjectiveHistory(pair.a.objectiveHistory, bestSolution, pair.a.duration));
    objectiveHistoriesB.push(normalizeObjectiveHistory(pair.b.objectiveHistory, bestSolution, pair.b.duration));
    lowerBoundHistoriesA.push(normalizeLowerBoundHistory(pair.a.lowerBoundHistory, bestSolution, pair.a.duration));
    lowerBoundHistoriesB.push(normalizeLowerBoundHistory(pair.b.lowerBoundHistory, bestSolution, pair.b.duration));
  }
  // Extend the histories by a dummy point at the time 0.
  // The point will have the worst value from all the runs.
  // Without this, the curve can jump at the beginning.
  // TODO: Assumes minimization
  let worstSolution = Math.max(
    ...objectiveHistoriesA.filter(h => h.length > 0).map(h => h[0].value),
    ...objectiveHistoriesB.filter(h => h.length > 0).map(h => h[0].value)
  );
  let worstLowerBound = Math.min(
    ...lowerBoundHistoriesA.filter(h => h.length > 0).map(h => h[0].value),
    ...lowerBoundHistoriesB.filter(h => h.length > 0).map(h => h[0].value)
  );
  for (let h of objectiveHistoriesA)
    h.unshift({ value: worstSolution, time: 0 });
  for (let h of objectiveHistoriesB)
    h.unshift({ value: worstSolution, time: 0 });
  for (let h of lowerBoundHistoriesA)
    h.unshift({ value: worstLowerBound, time: 0 });
  for (let h of lowerBoundHistoriesB)
    h.unshift({ value: worstLowerBound, time: 0 });
  return {
    objectiveA: calcNormalizedPlot(objectiveHistoriesA),
    objectiveB: calcNormalizedPlot(objectiveHistoriesB),
    lowerBoundA: calcNormalizedPlot(lowerBoundHistoriesA),
    lowerBoundB: calcNormalizedPlot(lowerBoundHistoriesB)
  };
}

let filterRegex: RegExp | undefined;
let minTimeCutoff = 1; // in seconds
let positionalArgs: string[] = [];

// Parse all arguments starting from index 2
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) {
    if (i + 1 >= process.argv.length) {
      console.error("Error: Missing argument for option:", process.argv[i]);
      process.exit(1);
    }
    if (process.argv[i] === '--filter') {
      try {
        filterRegex = new RegExp(process.argv[i + 1]);
      } catch (e) {
        console.error("Error: Invalid regex pattern:", process.argv[i + 1]);
        process.exit(1);
      }
    } else if (process.argv[i] === '--minTimeCutoff') {
      minTimeCutoff = Number(process.argv[i + 1]);
      if (isNaN(minTimeCutoff) || minTimeCutoff < 0) {
        console.error("Error: Invalid value for --minTimeCutoff:", process.argv[i + 1]);
        process.exit(1);
      }
    } else {
      console.error("Error: Unknown option:", process.argv[i]);
      process.exit(1);
    }
    i++; // Skip the argument for the option
  } else {
    positionalArgs.push(process.argv[i]);
  }
}

// Check for exactly 6 positional arguments
if (positionalArgs.length !== 6) {
  console.error("Usage: node compare.mjs [options] <header> <nameA> <dataA.json> <nameB> <dataB.json> <outputDir>");
  console.error("Available options:");
  console.error("  --filter REGEX     Only include instances with names matching REGEX");
  console.error("  --minTimeCutoff N  Ignore events before this time (in seconds, default: 1)");
  process.exit(1);
}

const header = positionalArgs[0];
const nameA = positionalArgs[1];
const fileA = positionalArgs[2];
const nameB = positionalArgs[3];
const fileB = positionalArgs[4];
const outputDir = positionalArgs[5];

const runNames: lib.RunNames = [nameA, nameB];

let dataA = JSON.parse(readFile(fileA)) as CP.BenchmarkResult[];
let dataB = JSON.parse(readFile(fileB)) as CP.BenchmarkResult[];

if (filterRegex !== undefined) {
  const regex = filterRegex;
  dataA = dataA.filter(result => regex.test(result.modelName));
  dataB = dataB.filter(result => regex.test(result.modelName));
}

let [normalA, errorsA] = lib.filterErrors(dataA);
let [normalB, errorsB] = lib.filterErrors(dataB);

if (minTimeCutoff > 0) {
  for (let result of normalA) {
    result.objectiveHistory = removeInitialObjectiveHistory(result.objectiveHistory, minTimeCutoff);
    result.lowerBoundHistory = removeInitialLowerBoundHistory(result.lowerBoundHistory, minTimeCutoff);
  }
  for (let result of normalB) {
    result.objectiveHistory = removeInitialObjectiveHistory(result.objectiveHistory, minTimeCutoff);
    result.lowerBoundHistory = removeInitialLowerBoundHistory(result.lowerBoundHistory, minTimeCutoff);
  }
}

const pairs = lib.computePairs(normalA, normalB);

if (!fs.existsSync(outputDir))
  fs.mkdirSync(outputDir);
const scriptDir = dirname(fileURLToPath(import.meta.url));

fs.copyFileSync(scriptDir + "/dist/instance.js", outputDir + "/instance.js");
fs.copyFileSync(scriptDir + "/dist/main.js", outputDir + "/main.js");
fs.copyFileSync(scriptDir + "/dist/style.css", outputDir + "/style.css");

let mainTemplate = fs.readFileSync(scriptDir + "/dist/main.html", "utf8");
let instanceTemplate = fs.readFileSync(scriptDir + "/dist/instance.html", "utf8");

function makeBriefResult(result: CP.NormalBenchmarkResult): lib.BriefBenchmarkResult {
  let { bestSolution, objectiveHistory, lowerBoundHistory, ...briefResult} = result;
  return briefResult;
}

let briefPairs = pairs.map((p: lib.Pair) => {
   return {
      a: makeBriefResult(p.a),
      b: makeBriefResult(p.b),
      modelName: p.modelName
   }
});

let mainParams =
  JSON.stringify(briefPairs) + ", " +
  JSON.stringify(runNames) + ", " +
  JSON.stringify(calcGlobalPlot(pairs)) + ", " +
  JSON.stringify(errorsA) + ", " +
  JSON.stringify(errorsB);
// The output file is main.html, not index.html, in order to avoid docusaurus bug(?).
// When the file is index.html then the relative paths in generated website (not during development) point to parent directory.
fs.writeFileSync(outputDir + "/main.html", mainTemplate.replace("PARAMETERS", mainParams).replace("HEADER", header));

for (let pair of pairs) {
  let instanceParams = JSON.stringify(pair) + ", " + JSON.stringify(runNames);
  fs.writeFileSync(outputDir + "/" + pair.modelName + ".html", instanceTemplate.replace("PARAMETERS", instanceParams));
}

//open(outputDir + "/main.html");
