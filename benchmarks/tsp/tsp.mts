import { strict as assert } from 'assert';
import * as CP from '@scheduleopt/optalcp';
import * as utils from '../../utils/utils.mjs';
import * as parsetsp from '../../utils/parsetsp.mjs';

// Command-line options:
let checkDirectionSymmetry = false;
let checkTriangularInequality = false;
let visitDuration = 0;
let forceCeil = false;
let breakDirectionSymmetry = false;

function defineModel(filename: string): CP.Model {
  let { nbNodes, transitionMatrix, hasDirectionSymmetry }
    = parsetsp.parse(filename, { checkDirectionSymmetry, checkTriangularInequality, visitDuration, forceCeil });

  let model = new CP.Model(utils.makeModelName('tsp', filename));

  // The times of the visits:
  let intervals = Array.from({ length: nbNodes }, (_, i) => model.intervalVar({ length: visitDuration, name: `N_${i + 2}` }));

  // We're looking for a cycle that visits all nodes exactly once.  So we can
  // chose in which node will start the cycle. Let's chose node 0, it will be
  // scheduled at time 0.
  intervals[0].setStart(0);

  // In the end, we have to return back to the node 0. So we need one more interval:
  let last = model.intervalVar({ length: 0, name: 'last' });

  // Nodes must be visited in a sequence, and fulfill the transition matrix.
  // The last node will be constrained to be the last one, so it doesn't have to
  // be part of the sequence.
  // Types must be set because the first interval has type 1, the second type 2 etc.
  let sequence = model.sequenceVar(intervals.slice(1), Array.from({ length: nbNodes - 1 }, (_, i) => i + 1));
  model.noOverlap(sequence, transitionMatrix);

  for (let i = 1; i < nbNodes; i++) {
    // The first node is not part of the sequence, so we have to propagate the transition matrix manually:
    model.endBeforeStart(intervals[0], intervals[i], transitionMatrix[0][i]);
    // The last node must be after all the other nodes, taking into account the transition matrix:
    model.endBeforeStart(intervals[i], last, transitionMatrix[i][0]);
  }

  // The length of the cycle is the end of the last node:
  model.minimize(last.end().minus(nbNodes * visitDuration));

  if (hasDirectionSymmetry && breakDirectionSymmetry && nbNodes > 2) {
    // If we reverse the order of the nodes, the solution will be the same. So,
    // we can break the symmetry by choosing any node and forcing it to be in
    // the first half of the cycle.  Let's chose a node with the maximum
    // distance from the node 0:
    let maxDistance = 0;
    let maxDistanceNode = 0;
    for (let i = 1; i < nbNodes; i++) {
      if (transitionMatrix[0][i] > maxDistance) {
        maxDistance = transitionMatrix[0][i];
        maxDistanceNode = i;
      }
    }
    model.constraint(intervals[maxDistanceNode].end().times(2).le(last.end()));
  }

  return model;
}

let params: CP.BenchmarkParameters = {
  usage: "Usage: node tsp.mjs [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n" +
    "TSP options:\n" +
    "  --checkTriangularInequality  Warn if triangular inequality is not respected\n" +
    "  --visitDuration <number>     Duration of each visit (the default is 0)\n" +
    "  --forceCeil                  Round up during distance computation\n" +
    "  --checkDirectionSymmetry     Check the direction symmetry of the solution\n" +
    "  --breakDirectionSymmetry     Break the direction symmetry of the solution"
};
let restArgs = CP.parseSomeBenchmarkParameters(params);
// Look for the optional parameters:
checkTriangularInequality = utils.getBoolOption("--checkTriangularInequality", restArgs);
visitDuration = utils.getIntOption("--visitDuration", visitDuration, restArgs);
forceCeil = utils.getBoolOption("--forceCeil", restArgs);
checkDirectionSymmetry = utils.getBoolOption("--checkDirectionSymmetry", restArgs);
breakDirectionSymmetry = utils.getBoolOption("--breakDirectionSymmetry", restArgs);

CP.benchmark(defineModel, restArgs, params);