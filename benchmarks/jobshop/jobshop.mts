import * as CP from '@scheduleopt/optalcp';
// Jobshop file format is the same as flowshop. The function defineModel is in a
// separate file so it could be shared:
import * as jobshopModeler from './modeler.mjs';

let params = {
  usage: "Usage: node jobshop.js [OPTIONS] INPUT_FILE1 [INPUT_FILE2] .."
};
// Let CP parse the remaining options:
let restArgs = CP.parseSomeBenchmarkParameters(params);
CP.benchmark(jobshopModeler.defineModel, restArgs, params);
