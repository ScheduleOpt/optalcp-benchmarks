import * as CP from '@scheduleopt/optalcp';
import * as utils from '../../utils/utils.mjs';
import { strict as assert } from 'assert';

let useRedundantCumul = false;
let samePermutation = true;

function defineModel(filename: string): CP.Model {
  // Read the input file into an array of numbers:
  let input = utils.readFileAsNumberArray(filename);
  let model = new CP.Model(utils.makeModelName('distributed-flowshop', filename));

  let nbJobs = input.shift() as number;
  let nbMachines = input.shift() as number;
  let nbFactories = input.shift() as number;

  let machines: CP.IntervalVar[][][] = [];
  for (let f = 0; f < nbFactories; f++) {
    machines[f] = [];
    for (let m = 0; m < nbMachines; m++)
      machines[f][m] = [];
  }

  let sumMachines: CP.CumulExpr[][] = [];
  for (let m = 0; m < nbMachines; m++)
    sumMachines[m] = [];

  let ends: CP.IntExpr[] = [];

  let jobNumbers : CP.IntExpr[][] = [];
  for (let f = 0; f < nbFactories; f++)
    jobNumbers[f] = [];

  for (let j = 0; j < nbJobs; j++) {

    let lengths: number[] = [];
    for (let m = 0; m < nbMachines; m++) {
      assert(m == input.shift() as number);
      lengths.push(input.shift() as number);
    }

    let main: CP.IntervalVar[] = [];
    let alternatives: CP.IntervalVar[][] = [];
    if (useRedundantCumul)
      for (let m = 0; m < nbMachines; m++) {
        main.push(model.intervalVar({ length: lengths[m], name: "J" + (j + 1) + "M" + (m + 1) }));
        alternatives[m] = [];
      }

    let presences: CP.BoolExpr[] = [];

    for (let f = 0; f < nbFactories; f++) {
      let prev: CP.IntervalVar | null = null;
      let first: CP.IntervalVar | null = null;
      for (let m = 0; m < nbMachines; m++) {
        let operation = model.intervalVar({ optional: true, length: lengths[m], name: "J" + (j + 1) + "F" + (f + 1) + "M" + (m + 1) });
        if (useRedundantCumul)
          alternatives[m].push(operation);
        machines[f][m].push(operation);
        if (prev !== null) {
          model.endBeforeStart(prev, operation);
          assert(first);
          model.constraint(first.presence().eq(operation.presence()));
        } else
          first = operation;
        prev = operation;
      }
      assert(first);
      assert(prev);
      jobNumbers[f].push(first.presence().times(j));
      if (!useRedundantCumul)
        ends.push(prev.end());
      presences.push(first.presence());
      // Symmetry breaking: the last job must be in the last factory:
      if (j == nbJobs-1 && f == nbFactories-1)
        model.constraint(first.presence().eq(1));
    }

    if (useRedundantCumul) {
      for (let m = 0; m < nbMachines; m++) {
        model.alternative(main[m], alternatives[m]);
        sumMachines[m].push(main[m].pulse(1));
      }
      ends.push(main[nbMachines - 1].end());
    }
    else
      model.constraint(model.sum(presences).eq(1));
  }

  model.minimize(model.max(ends));

  for (let f = 0; f < nbFactories; f++)
    for (let m = 0; m < nbMachines; m++)
      model.noOverlap(machines[f][m]);

  if (samePermutation) {
    for (let j1 = 1; j1 < nbJobs; j1++)
      for (let j2 = 0; j2 < j1; j2++) {
        for (let f = 0; f < nbFactories; f++) {
          let isBefore = model.intVar({ optional: true, name: "F" + (f + 1) + "_J" + (j1 + 1) + "beforeJ" + (j2 + 1) });
          for (let m = 0; m < nbMachines; m++) {
            let x = machines[f][m][j1];
            let y = machines[f][m][j2];
            isBefore.identity(model._disjunctiveIsBefore(x, y));
          }
        }
      }
  }

  if (useRedundantCumul) {
    for (let m = 0; m < nbMachines; m++)
      model.cumulSum(sumMachines[m]).cumulLe(nbFactories);
  }

  let maxJobInF: CP.IntExpr[] = [];
  for (let f = 0; f < nbFactories; f++)
    maxJobInF[f] = model.max(jobNumbers[f]);
  // Symmetry breaking for the remaining factories (if there are more than 2):
  for (let f = 1; f < nbFactories - 1; f++)
    model.constraint(maxJobInF[f - 1].lt(maxJobInF[f]));

  return model;
}

let params: CP.BenchmarkParameters = {
  usage: "Usage: node distributed-flowshop.mjs [OPTIONS] INPUT_FILE1 [INPUT_FILE2] .."
};
let restArgs = CP.parseSomeBenchmarkParameters(params);
CP.benchmark(defineModel, restArgs, params);
