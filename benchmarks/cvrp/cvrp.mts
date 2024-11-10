import { strict as assert } from 'assert';
import * as CP from '@scheduleopt/optalcp';
import * as utils from '../../utils/utils.mjs';
import * as parsetsp from '../../utils/parsetsp.mjs';

let checkTriangularInequality = false;
let visitDuration = 0;
let forceCeil = false;
let checkDirectionSymmetry = false;
let breakDirectionSymmetry = false;
let breakVehicleSymmetry = false;
let forcedNbVehicles = 0; // 0 means not forced
let objective = "path";

function defineModel(filename: string): CP.Model {
  let { nbNodes, transitionMatrix, demands, capacity, depots, hasDirectionSymmetry } =
    parsetsp.parse(filename, {checkTriangularInequality, visitDuration,  forceCeil, checkDirectionSymmetry});

  assert(depots !== undefined, "Depots are not defined in the input file");
  assert(capacity !== undefined, "Capacity is not defined in the input file");
  assert(demands !== undefined, "Demands are not defined in the input file");

  // The data format supports multiple depots, but we don't have any data files with multiple depots:
  assert(depots.length == 1, "Multiple depots are not supported yet");
  // In the symmetry breaking, we assume that the depot is the first node:
  assert(depots[0] ==0, "Depot must be the first node");

  // Try to guess the number of vehicles from the filename name.
  // It may end by kNN.vrp(.gz) where NN is the number of vehicles.
  let nbVehicles = forcedNbVehicles;
  if (nbVehicles == 0) {
    let match = filename.match(/k(\d+)\.vrp(\.gz)?$/);
    if (match !== null)
      nbVehicles = parseInt(match[1]);
    else {
      console.error("Number of vehicles is not defined on the command line and cannot be guessed from the filename");
      process.exit(1);
    }
  }

  // Compute the maximum distance in the matrix:
  let maxDistance = 0;
  for (let i = 0; i < nbNodes; i++)
    for (let j = 0; j < nbNodes; j++)
      maxDistance = Math.max(maxDistance, transitionMatrix[i][j]);
  // The horizon doesn't seem to be needed. But let's use it anyway:
  let horizon = maxDistance * (nbNodes + nbVehicles);

  // The depot will not be part of noOverlap. It is known to be first and last
  // and so it will be handled separately.  Therefore, for the noOverlap, we can
  // make the transition matrix smaller by one row and one column:
  let customerMatrix = transitionMatrix.slice(1).map(row => row.slice(1));
  // From now on, we will index the customers from 0.
  // But in the variable names, we will index them from 2 (because node 1 in the input file is the depot).
  let nbCustomers = nbNodes - 1;

  let model = new CP.Model(utils.makeModelName('cvrp', filename));
  // For each customer, we have an array of potential visits by the vehicles:
  let visits: CP.IntervalVar[][] = Array.from({ length: nbCustomers }, () => []);
  // For each vehicle, the time of the last visit:
  let endTimes: CP.IntExpr[] = [];
  // For each vehicle, we compute the max index of a customer served.
  // Used only for symmetry-breaking.
  let maxServed: CP.IntExpr[] = [];
  // Usage of each vehicle (how much capacity is used):
  let vehicleUsage: CP.IntExpr[] = [];

  for (let v = 0; v < nbVehicles; v++) {
    // Visits done by the vehicle v:
    let myVisits = Array.from({ length: nbCustomers }, (_, i) =>
      model.intervalVar({ length: visitDuration, name: `V_${v + 1}_${i + 2}`, optional: true })
    );
    // Add myVisits to the visits array:
    for (let i = 0; i < nbCustomers; i++)
      visits[i].push(myVisits[i]);

    model.noOverlap(myVisits, customerMatrix);

    // Constraints for the depot:
    let last = model.intervalVar({ length: 0, name: `last_${v + 1}`, end: [0, horizon] });
    for (let i = 0; i < nbCustomers; i++) {
      // We don't model the initial depot visit at all. It is known to be at time 0.
      // Instead, we increase startMin of all the visits by the transition matrix value:
      myVisits[i].setStartMin(transitionMatrix[0][i + 1]);
      // The return to depot must be after all the other visits and respect the transition matrix:
      model.endBeforeStart(myVisits[i], last, transitionMatrix[i + 1][0]);
    }
    endTimes.push(last.end());

    // Capacity of the vehicle cannot be exceeded:
    let used = model.sum(myVisits.map((itv, i) => itv.presence().times(demands[i + 1])));
    model.constraint(used.le(capacity));
    vehicleUsage.push(used);

    // Compute the max index of a served customer as:
    //    min_i { (i+1) * myVisits[i].presence() }
    // There is +1 to distinguish between serving no customer (value 0) and
    // serving just the customer with index 0 (value 1).
    let maxServedCustomer = model.max(myVisits.map((itv, i) => itv.presence().times(i + 1)));
    maxServed.push(maxServedCustomer);

    if (hasDirectionSymmetry && breakDirectionSymmetry) {
      // Let's compute the time of the customer with the max index served:
      //   sum_i { myVisits[i].start() * (maxServedCustomer == i+1) }
      // Here we use boolean expression maxServedCustomer == i+1 as 0/1 integer expression.
      let timeOfMaxServedCustomer =
        model.sum(myVisits.map((itv, i) => itv.start().times(maxServedCustomer.eq(i + 1))));
      // The route taken in the reverse order is also a solution.
      // So we may insist that the time of this visit is in the first half of the route:
      model.constraint(timeOfMaxServedCustomer.times(2).le(last.end()));
    }
  }

  for (let i = 0; i < nbCustomers; i++) {
    // Every customer must be visited exactly once:
    //    sum_j visits[i][j] == 1
    // We don't need alternative constraint.
    model.constraint(model.sum(visits[i].map(vis => vis.presence())).eq(1));
  }

  // All the demands must be satisfied by some vehicle. Therefore the sum of
  // their usage must be equal to the total demand.  It is a redundant
  // constraint. It allows the solver to see a problem when some vehicles are
  // underused and there is no way to satisfy the remaining demands by the
  // remaining vehicles.
  let totalDemand = demands.slice(1).reduce((a, b) => a + b, 0);
  model.constraint(model.sum(vehicleUsage).eq(totalDemand));

  if (breakVehicleSymmetry) {
    // The values of the maxServed variables must be increasing with the vehicle number.
    // For the case the two vehicles are not used at all, i.e., both maxServed
    // are 0, there is max2(1) on the right side.
    for (let c = 1; c < nbVehicles; c++)
      model.constraint(maxServed[c - 1].le(maxServed[c].max2(1)));
    // Customer with the biggest index must be served by the last vehicle.
    // Customer with the second biggest index must be served by the last or the second last vehicle.
    // etc.
    for (let i = nbCustomers - 1; i > nbCustomers - nbVehicles; i--) {
      // How many possible vehicles can serve this customer:
      let nbPossibleVehicles = nbCustomers - i;
      let nbForbiddenVehicles = nbVehicles - nbPossibleVehicles;
      for (let v = 0; v < nbForbiddenVehicles; v++)
        visits[i][v].makeAbsent();
    }
  }

  if (objective == "makespan")
    model.minimize(model.max(endTimes));
  else {
    assert(objective == "path");
    model.minimize(model.sum(endTimes).minus(nbCustomers * visitDuration));
  }

  return model;
}

let params: CP.BenchmarkParameters = {
  usage: "Usage: node cvrp.mjs [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n" +
    "CVRP options:\n" +
    "  --nbVehicles <number>       Number of vehicles\n" +
    "  --objective <makespan|path> Objective function\n" +
    "  --checkTriangularInequality Warn if triangular inequality is not respected\n" +
    "  --visitDuration <number>    Duration of each visit (the default is 0)\n" +
    "  --forceCeil                 Round up during distance computation\n" +
    "  --checkDirectionSymmetry    Warn if the directions are not symmetrical\n" +
    "  --breakDirectionSymmetry    Break the direction symmetry of the solution\n" +
    "  --breakVehicleSymmetry      Order vehicles by the maximum city visited"
};

let restArgs = CP.parseSomeBenchmarkParameters(params);
checkTriangularInequality = utils.getBoolOption("--checkTriangularInequality", restArgs);
visitDuration = utils.getIntOption("--visitDuration", visitDuration, restArgs);
forceCeil = utils.getBoolOption("--forceCeil", restArgs);
forcedNbVehicles = utils.getIntOption("--nbVehicles", forcedNbVehicles, restArgs);
checkDirectionSymmetry = utils.getBoolOption("--checkDirectionSymmetry", restArgs);
breakDirectionSymmetry = utils.getBoolOption("--breakDirectionSymmetry", restArgs);
breakVehicleSymmetry = utils.getBoolOption("--breakVehicleSymmetry", restArgs);
objective = utils.getStringOption("--objective", objective, restArgs);
if (objective != "makespan" && objective != "path") {
  console.error("Invalid value for --objective. Could be only 'makespan' or 'path'");
  process.exit(1);
}

CP.benchmark(defineModel, restArgs, params);
