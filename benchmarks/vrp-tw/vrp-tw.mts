import { strict as assert } from 'assert';
import * as CP from '@scheduleopt/optalcp';
import * as utils from '../../utils/utils.mjs';

// Command line options:
let rounding = "ceil"
let objectiveType = "makespan";
let breakVehicleSymmetry = false;
let scaleFactor = 1.0;
let bigM = 1_000_000;

function verifyExpectedLine(lines: string[], pos: number, expected: RegExp): void {
  if (!lines[pos].trim().match(expected)) {
    console.error(`Expected line ${pos + 1} to match "${expected}", but got "${lines[pos]}"`);
    process.exit(1);
  }
}

export function defineModel(filename: string): CP.Model {
  let lines = utils.readFile(filename).trim().split('\n');
  // lines[0] is name of the instance. We ignore it an make the name from the filename
  // lines[1] is an empty line, and then comes column names
  verifyExpectedLine(lines, 1, /^$/);
  verifyExpectedLine(lines, 2, /^VEHICLE$/);
  verifyExpectedLine(lines, 3, /^NUMBER\s+CAPACITY$/);
  let [nbVehicles, capacity] = lines[4].trim().split(/\s+/).map(Number);
  verifyExpectedLine(lines, 5, /^$/);
  // Then comes the customer data
  verifyExpectedLine(lines, 6, /^CUSTOMER$/);
  verifyExpectedLine(lines, 7, /^CUST NO\.\s+XCOORD\.\s+YCOORD\.\s+DEMAND\s+READY TIME\s+DUE DATE\s+SERVICE\s+TIME$/);
  verifyExpectedLine(lines, 8, /^$/);

  type Node = {
    x: number,
    y: number,
    demand: number,
    ready: number, // Minimum start time
    due: number,   // Maximum start time
    serviceTime: number // Duration
  };
  let nodes: Node[] = [];
  // Note that due date is the maximum start time, not maximum end time.
  // Because in the data, there are nodes with: ready + serviceTime > due.

  for (let i = 9; i < lines.length; i++) {
    let [customerNumber, x, y, demand, ready, due, serviceTime] = lines[i].trim().split(/\s+/).map(Number);
    if (customerNumber !== i - 9) {
      console.error(`Line ${i + 1}: Expected customer number ${i - 9}, but got ${customerNumber}`);
      process.exit(1);
    }
    nodes.push({
      x: x * scaleFactor,
      y: y * scaleFactor,
      demand,
      ready: ready * scaleFactor,
      due: due * scaleFactor,
      serviceTime: serviceTime * scaleFactor
    });
  }

  // Node 0 should be the depot. And nothing else:
  assert(nodes[0].demand === 0);
  assert(nodes[0].ready === 0);
  for (let i = 1; i < nodes.length; i++) {
    assert(nodes[i].demand > 0);
    assert(nodes[i].serviceTime > 0); // Otherwise, we may have a problem with triangular inequality
  }

  // Compute transition matrix
  // The depot will not be part of noOverlap. It is known to be first and last
  // and so it will be handled separately. Therefore node 0 is not part of the matrix:
  let nbNodes = nodes.length;
  let roundFunc = rounding === "round" ? Math.round : Math.ceil;
  let customerMatrix: number[][] = [];
  for (let i = 1; i < nbNodes; i++) {
    let row = [];
    for (let j = 1; j < nbNodes; j++) {
      let xdist = nodes[i].x - nodes[j].x;
      let ydist = nodes[i].y - nodes[j].y;
      let dist = Math.sqrt(xdist * xdist + ydist * ydist)
      row.push(roundFunc(dist));
    }
    customerMatrix.push(row);
  }
  // For the depot, we need distances to all the customers:
  let depotDistances = [];
  for (let i = 1; i < nbNodes; i++) {
    let xdist = nodes[0].x - nodes[i].x;
    let ydist = nodes[0].y - nodes[i].y;
    let dist = Math.sqrt(xdist * xdist + ydist * ydist)
    depotDistances.push(roundFunc(dist));
  }

  let model = new CP.Model(utils.makeModelName('vrp-tw', filename));
  let nbCustomers = nbNodes - 1;
  // From now on, we will index the customers from 0.
  // But in the variable names, we will index them from 1 (because node 1 in the input file is the depot).
  let customerNodes = nodes.slice(1);
  // For each customer, we have an array of potential visits by the vehicles:
  let visits: CP.IntervalVar[][] = Array.from({ length: nbCustomers }, () => []);
  // For each vehicle, the time of the last visit:
  let endTimes: CP.IntExpr[] = [];
  // Load of each vehicle (how much capacity is used):
  let vehicleLoad: CP.IntExpr[] = [];
  // For each vehicle, we compute the max index of a customer served.
  // Used only for symmetry-breaking.
  let maxServed: CP.IntExpr[] = [];
  // Whether given vehicle is used or not:
  let vehicleUsed: CP.IntExpr[] = [];

  for (let v = 0; v < nbVehicles; v++) {
    // Visits done by the vehicle v:
    let myVisits = customerNodes.map((node, i) =>
      model.intervalVar({
        name: `V_${v + 1}_${i + 1}`,
        optional: true,
        length: node.serviceTime,
        // The start time must be within the time window. But it cannot be
        // before depotDistances[i], what is the minimum time necessary to get
        // there (if it is the very first customer).
        start: [Math.max(depotDistances[i], node.ready), node.due],
        // The range for the end time can be also computed from the time window
        // and the visit duration.
        // It is necessary only for objectiveType == "travelTime
        end: [Math.max(depotDistances[i], node.ready) + node.serviceTime, node.due + node.serviceTime]
      })
    );

    if (objectiveType == "traveltime") {
      for (let i = 0; i < nbCustomers; i++) {
        // Extend the visit so that it also covers potential waiting time for the
        // time window. I.e., the visit can start sooner and can be longer.
        // Length min, startMax, endMin and endMax remain the same.
        myVisits[i].setStartMin(depotDistances[i]);
        myVisits[i].setLengthMax(CP.LengthMax);
        assert(myVisits[i].getLengthMin() == customerNodes[i].serviceTime);
      }
    }

    // Add myVisits to the visits array:
    for (let i = 0; i < nbCustomers; i++)
      visits[i].push(myVisits[i]);

    model.noOverlap(myVisits, customerMatrix);

    // Constraints for the depot:
    let last = model.intervalVar({ length: 0, name: `last_${v + 1}` });
    for (let i = 0; i < nbCustomers; i++) {
      // The return to depot must be after all the other visits and respect the transition matrix:
      model.endBeforeStart(myVisits[i], last, depotDistances[i]);
    }
    endTimes.push(last.end());

    vehicleUsed.push(model.max(myVisits.map(itv => itv.presence())));

    // Capacity of the vehicle cannot be exceeded:
    let used = model.sum(myVisits.map((itv, i) => itv.presence().times(customerNodes[i].demand)));
    model.constraint(used.le(capacity));
    vehicleLoad.push(used);

    // Compute the max index of a served customer as:
    //    min_i { (i+1) * myVisits[i].presence() }
    // There is +1 to distinguish between serving no customer (value 0) and
    // serving just the customer with index 0 (value 1).
    let maxServedCustomer = model.max(myVisits.map((itv, i) => itv.presence().times(i + 1)));
    maxServed.push(maxServedCustomer);
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
  let totalDemand = customerNodes.reduce((a, b) => a + b.demand, 0);
  model.constraint(model.sum(vehicleLoad).eq(totalDemand));

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

  if (objectiveType === "makespan")
    model.minimize(model.max(endTimes));
  else if (objectiveType === "totaltime")
    model.minimize(model.sum(endTimes));
  else if (objectiveType === "nbvehicles")
    model.minimize(model.sum(vehicleUsed));
  else if (objectiveType === "path") {
    let totalServiceTime = customerNodes.reduce((a, b) => a + b.serviceTime, 0);
    let objective = model.sum(endTimes).minus(totalServiceTime);
    model.constraint(objective.ge(0));
    model.minimize(objective);
  }
  else {
    assert(objectiveType == "traveltime" || objectiveType == "nbvehicles,traveltime");
    // Compute how much time we spent by the visits (including the waiting time).
    // To get a bit more propagation, for each visit compute the max length over
    // its alternatives (different vehicles).
    let visitDurations: CP.IntExpr[] = [];
    for (let i = 0; i < nbCustomers; i++)
      visitDurations.push(model.max(visits[i].map(visit => visit.length())));
    let objective = model.sum(endTimes).minus(model.sum(visitDurations));
    if (objectiveType == "nbvehicles,traveltime") {
      // The objective is bigM * nbVehicles + total travel time
      objective = model.sum(vehicleUsed).times(bigM).plus(objective);
    }
    model.constraint(objective.ge(0));
    model.minimize(objective);
  }

  return model;
}

let params: CP.BenchmarkParameters = {
  usage: "Usage: node vrp-tw.mjs [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n" +
    "VRP-TW options:\n" +
    "  --objective <objective type>   The type of the objective function (default: makespan)\n" +
    "  --scale <number>               Scale the time by a constant factor (default: 1)\n" +
    "  --breakVehicleSymmetry         Order vehicles by the maximum city visited (default: false)\n" +
    "  --rounding <round|ceil>        How to round the distances (default: ceil)\n\n" +
    "Objective types are:\n" +
    "  * makespan: the time the last vehicle returns to the depot\n" +
    "  * traveltime: the total time spent by traveling (wihtout wating and without service times)\n" +
    "  * totaltime: the total time spent by all vehicles (with traveling, waiting and service times)\n" +
    "  * path: the time spent not at customer (i.e., the total traveling and waiting time)\n" +
    "  * nbvehicles: the minimum number of vehicles used\n" +
    "  * nbvehicle,traveltime: 1000000*nbvehicles + traveltime"
};

let restArgs = CP.parseSomeBenchmarkParameters(params);
objectiveType = utils.getStringOption("--objective", objectiveType, restArgs);
if (["path", "traveltime", "totaltime", "makespan", "nbvehicles", "nbvehicles,traveltime"].indexOf(objectiveType) === -1) {
  console.error("Invalid value for --objective.");
  process.exit(1);
}
scaleFactor = utils.getFloatOption("--scale", scaleFactor, restArgs);
breakVehicleSymmetry = utils.getBoolOption("--breakVehicleSymmetry", restArgs);
if (rounding !== "round" && rounding !== "ceil") {
  console.error("Invalid value for --rounding. Could be only 'round' or 'ceil'");
  process.exit(1);
}
rounding = utils.getStringOption("--rounding", rounding, restArgs);

CP.benchmark(defineModel, restArgs, params);
