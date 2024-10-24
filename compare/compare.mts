import * as fs from 'fs';
import * as CP from "@scheduleopt/optalcp";
import * as lib from './src/lib.mjs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

if (process.argv.length != 8) {
  console.error("Usage: node compare.mjs <header> <nameA> <dataA.json> <nameB> <dataB.json> <outputDir>");
  process.exit(1);
}

const header = process.argv[2];
const nameA = process.argv[3];
const fileA = process.argv[4];
const nameB = process.argv[5];
const fileB = process.argv[6];
const outputDir = process.argv[7];

const runNames: lib.RunNames = [nameA, nameB];

let dataA = JSON.parse(fs.readFileSync(fileA, "utf8")) as CP.BenchmarkResult[];
let dataB = JSON.parse(fs.readFileSync(fileB, "utf8")) as CP.BenchmarkResult[];

let [normalA, errorsA] = lib.filterErrors(dataA);
let [normalB, errorsB] = lib.filterErrors(dataB);
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

let mainParams = JSON.stringify(briefPairs) + ", " + JSON.stringify(runNames) + ", " + JSON.stringify(errorsA) + ", " + JSON.stringify(errorsB);
// The output file is main.html, not index.html, in order to avoid docusaurus bug(?).
// When the file is index.html then the relative paths in generated website (not during development) point to parent directory.
fs.writeFileSync(outputDir + "/main.html", mainTemplate.replace("PARAMETERS", mainParams).replace("HEADER", header));

for (let pair of pairs) {
  let instanceParams = JSON.stringify(pair) + ", " + JSON.stringify(runNames);
  fs.writeFileSync(outputDir + "/" + pair.modelName + ".html", instanceTemplate.replace("PARAMETERS", instanceParams));
}

//open(outputDir + "/main.html");
