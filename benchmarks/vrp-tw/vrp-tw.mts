// Vehicle Routing Problem with Time Windows: route capacitated vehicles from
// a depot to serve customers within their time windows.

import { strict as assert } from 'node:assert';
import * as fs from "node:fs";
import * as zlib from "node:zlib";
import * as CP from "@scheduleopt/optalcp";

function readFile(filename: string): string {
  return filename.endsWith(".gz")
    ? zlib.gunzipSync(fs.readFileSync(filename), {}).toString()
    : fs.readFileSync(filename, "utf8");
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

// Command line options:
let rounding = "ceil";
let objectiveType = "makespan";
let breakVehicleSymmetry = false;
let scaleFactor = 1.0;
const bigM = 1_000_000;

function verifyExpectedLine(lines: string[], pos: number, expected: RegExp): void {
  if (!lines[pos].trim().match(expected)) {
    console.error(`Expected line ${pos + 1} to match "${expected}", but got "${lines[pos]}"`);
    process.exit(1);
  }
}

export function defineModel(filename: string): CP.Model {
  const lines = readFile(filename).trim().split('\n');
  // lines[0] is name of the instance. We ignore it and make the name from the filename
  // lines[1] is an empty line, and then comes column names
  verifyExpectedLine(lines, 1, /^$/);
  verifyExpectedLine(lines, 2, /^VEHICLE$/);
  verifyExpectedLine(lines, 3, /^NUMBER\s+CAPACITY$/);
  const [nbVehicles, capacity] = lines[4].trim().split(/\s+/).map(Number);
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
  const nodes: Node[] = [];
  // Note that due date is the maximum start time, not maximum end time.
  // Because in the data, there are nodes with: ready + serviceTime > due.

  for (let i = 9; i < lines.length; i++) {
    const [customerNumber, x, y, demand, ready, due, serviceTime] = lines[i].trim().split(/\s+/).map(Number);
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

  // Node 0 is the depot:
  assert(nodes[0].demand === 0);
  assert(nodes[0].ready === 0);
  for (let i = 1; i < nodes.length; i++) {
    assert(nodes[i].demand > 0);
    assert(nodes[i].serviceTime > 0); // Otherwise, we may have a problem with triangular inequality
  }

  // Compute transition matrix
  // The depot will not be part of noOverlap. It is known to be first and last
  // and so it will be handled separately. Therefore node 0 is not part of the matrix:
  const nbNodes = nodes.length;
  const roundFunc = rounding === "round" ? Math.round : Math.ceil;
  const customerMatrix: number[][] = [];
  for (let i = 1; i < nbNodes; i++) {
    const row: number[] = [];
    for (let j = 1; j < nbNodes; j++) {
      const xdist = nodes[i].x - nodes[j].x;
      const ydist = nodes[i].y - nodes[j].y;
      const dist = Math.sqrt(xdist * xdist + ydist * ydist);
      row.push(roundFunc(dist));
    }
    customerMatrix.push(row);
  }
  // For the depot, we need distances to all the customers:
  const depotDistances: number[] = [];
  for (let i = 1; i < nbNodes; i++) {
    const xdist = nodes[0].x - nodes[i].x;
    const ydist = nodes[0].y - nodes[i].y;
    const dist = Math.sqrt(xdist * xdist + ydist * ydist);
    depotDistances.push(roundFunc(dist));
  }

  const model = new CP.Model(makeModelName('vrp-tw', filename));
  const nbCustomers = nbNodes - 1;
  // From now on, we will index the customers from 0.
  // But in the variable names, we will index them from 1 (because node 0 in the input file is the depot).
  const customerNodes = nodes.slice(1);
  // For each customer, we have an array of potential visits by the vehicles:
  const visits: CP.IntervalVar[][] = Array.from({ length: nbCustomers }, () => []);
  // For each vehicle, the time of the last visit:
  const endTimes: CP.IntExpr[] = [];
  // Load of each vehicle (how much capacity is used):
  const vehicleLoad: CP.IntExpr[] = [];
  // For each vehicle, we compute the max index of a customer served.
  // Used only for symmetry-breaking.
  const maxServed: CP.IntExpr[] = [];
  // Whether given vehicle is used or not:
  const vehicleUsed: CP.IntExpr[] = [];

  for (let v = 0; v < nbVehicles; v++) {
    // Visits done by the vehicle v:
    const myVisits = customerNodes.map((node, i) =>
      model.intervalVar({
        name: `V_${v + 1}_${i + 1}`,
        optional: true,
        length: node.serviceTime,
        // The start time must be within the time window. But it cannot be
        // before depotDistances[i], which is the minimum time necessary to get
        // there (if it is the very first customer).
        start: [Math.max(depotDistances[i], node.ready), node.due],
        // The range for the end time can also be computed from the time window
        // and the visit duration.
        // It is necessary only for objectiveType === "traveltime"
        end: [Math.max(depotDistances[i], node.ready) + node.serviceTime, node.due + node.serviceTime]
      })
    );

    if (objectiveType === "traveltime") {
      for (let i = 0; i < nbCustomers; i++) {
        // Extend the visit so that it also covers potential waiting time for the
        // time window. I.e., the visit can start sooner and can be longer.
        // Length min, startMax, endMin and endMax remain the same.
        myVisits[i].startMin = depotDistances[i];
        myVisits[i].lengthMax = CP.LengthMax;
        assert(myVisits[i].lengthMin === customerNodes[i].serviceTime);
      }
    }

    // Add myVisits to the visits array:
    for (let i = 0; i < nbCustomers; i++)
      visits[i].push(myVisits[i]);

    model.noOverlap(myVisits, customerMatrix);

    // Constraints for the depot:
    const last = model.intervalVar({ length: 0, name: `last_${v + 1}` });
    for (let i = 0; i < nbCustomers; i++) {
      // The return to depot must be after all the other visits and respect the transition matrix:
      model.endBeforeStart(myVisits[i], last, depotDistances[i]);
    }
    endTimes.push(last.end());

    vehicleUsed.push(model.max(myVisits.map(itv => itv.presence())));

    // Capacity of the vehicle cannot be exceeded:
    const used = model.sum(myVisits.map((itv, i) => itv.presence().times(customerNodes[i].demand)));
    model.enforce(used.le(capacity));
    vehicleLoad.push(used);

    // Compute the max index of a served customer as:
    //    max_i { (i+1) * myVisits[i].presence() }
    // There is +1 to distinguish between serving no customer (value 0) and
    // serving just the customer with index 0 (value 1).
    const maxServedCustomer = model.max(myVisits.map((itv, i) => itv.presence().times(i + 1)));
    maxServed.push(maxServedCustomer);
  }

  for (let i = 0; i < nbCustomers; i++) {
    // Every customer must be visited exactly once:
    //    sum_j visits[i][j] == 1
    // We don't need alternative constraint.
    model.enforce(model.sum(visits[i].map(vis => vis.presence())).eq(1));
  }

  // All the demands must be satisfied by some vehicle. Therefore the sum of
  // their usage must be equal to the total demand. It is a redundant
  // constraint. It allows the solver to see a problem when some vehicles are
  // underused and there is no way to satisfy the remaining demands by the
  // remaining vehicles.
  const totalDemand = customerNodes.reduce((a, b) => a + b.demand, 0);
  model.enforce(model.sum(vehicleLoad).eq(totalDemand));

  if (breakVehicleSymmetry) {
    // The values of the maxServed variables must be increasing with the vehicle number.
    // In case two vehicles are not used at all, i.e., both maxServed
    // are 0, there is max2(1) on the right side.
    for (let c = 1; c < nbVehicles; c++)
      model.enforce(maxServed[c - 1].le(maxServed[c].max2(1)));
    // Customer with the biggest index must be served by the last vehicle.
    // Customer with the second biggest index must be served by the last or the second last vehicle.
    // etc.
    for (let i = nbCustomers - 1; i > nbCustomers - nbVehicles; i--) {
      // How many possible vehicles can serve this customer:
      const nbPossibleVehicles = nbCustomers - i;
      const nbForbiddenVehicles = nbVehicles - nbPossibleVehicles;
      for (let v = 0; v < nbForbiddenVehicles; v++)
        visits[i][v].optional = null;
    }
  }

  if (objectiveType === "makespan")
    model.minimize(model.max(endTimes));
  else if (objectiveType === "totaltime")
    model.minimize(model.sum(endTimes));
  else if (objectiveType === "nbvehicles")
    model.minimize(model.sum(vehicleUsed));
  else if (objectiveType === "path") {
    const totalServiceTime = customerNodes.reduce((a, b) => a + b.serviceTime, 0);
    const objective = model.sum(endTimes).minus(totalServiceTime);
    model.enforce(objective.ge(0));
    model.minimize(objective);
  }
  else {
    assert(objectiveType === "traveltime" || objectiveType === "nbvehicles,traveltime");
    // Compute how much time we spent on the visits (including the waiting time).
    // To get a bit more propagation, for each visit compute the max length over
    // its alternatives (different vehicles).
    const visitDurations: CP.IntExpr[] = [];
    for (let i = 0; i < nbCustomers; i++)
      visitDurations.push(model.max(visits[i].map(visit => visit.length())));
    let objective = model.sum(endTimes).minus(model.sum(visitDurations));
    if (objectiveType === "nbvehicles,traveltime") {
      // The objective is bigM * nbVehicles + total travel time
      objective = model.sum(vehicleUsed).times(bigM).plus(objective);
    }
    model.enforce(objective.ge(0));
    model.minimize(objective);
  }

  return model;
}

const params: CP.BenchmarkParameters = {
  usage: "Usage: node vrp-tw.mjs [OPTIONS] INPUT_FILE [INPUT_FILE2] ..\n\n" +
    "VRP-TW options:\n" +
    "  --objective <objective type>   The type of the objective function (default: makespan)\n" +
    "  --scale <number>               Scale the time by a constant factor (default: 1)\n" +
    "  --breakVehicleSymmetry         Order vehicles by the maximum city visited (default: false)\n" +
    "  --rounding <round|ceil>        How to round the distances (default: ceil)\n\n" +
    "Objective types are:\n" +
    "  * makespan: the time the last vehicle returns to the depot\n" +
    "  * traveltime: the total time spent traveling (without waiting and without service times)\n" +
    "  * totaltime: the total time of all vehicles (with traveling, waiting and service times)\n" +
    "  * path: the time not spent at customers (i.e., the total traveling and waiting time)\n" +
    "  * nbvehicles: the minimum number of vehicles used\n" +
    "  * nbvehicles,traveltime: 1000000*nbvehicles + traveltime"
};

// Command-line parsing helpers:
function getBoolOption(option: string, restArgs: string[]): boolean {
  const index = restArgs.indexOf(option);
  if (index !== -1) {
    restArgs.splice(index, 1);
    return true;
  }
  return false;
}

function getStringOption(option: string, defaultValue: string, restArgs: string[]): string {
  const index = restArgs.indexOf(option);
  if (index === -1)
    return defaultValue;
  if (index + 1 === restArgs.length) {
    console.error(`Missing value for option ${option}`);
    process.exit(1);
  }
  const value = restArgs[index + 1];
  restArgs.splice(index, 2);
  return value;
}

function getFloatOption(option: string, defaultValue: number, restArgs: string[]): number {
  const index = restArgs.indexOf(option);
  if (index === -1)
    return defaultValue;
  if (index + 1 === restArgs.length) {
    console.error(`Missing value for option ${option}`);
    process.exit(1);
  }
  const value = Number.parseFloat(restArgs[index + 1]);
  restArgs.splice(index, 2);
  return value;
}

const restArgs = CP.parseSomeBenchmarkParameters(params);
objectiveType = getStringOption("--objective", objectiveType, restArgs);
if (["path", "traveltime", "totaltime", "makespan", "nbvehicles", "nbvehicles,traveltime"].indexOf(objectiveType) === -1) {
  console.error("Invalid value for --objective.");
  process.exit(1);
}
scaleFactor = getFloatOption("--scale", scaleFactor, restArgs);
breakVehicleSymmetry = getBoolOption("--breakVehicleSymmetry", restArgs);
rounding = getStringOption("--rounding", rounding, restArgs);
if (rounding !== "round" && rounding !== "ceil") {
  console.error("Invalid value for --rounding. Must be 'round' or 'ceil'");
  process.exit(1);
}

CP.benchmark(defineModel, restArgs, params);
