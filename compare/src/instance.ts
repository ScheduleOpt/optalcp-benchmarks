import * as d3 from "d3";
import * as CP from "@scheduleopt/optalcp";
import * as Plot from "@observablehq/plot";
import * as lib from './lib.mjs';

function plotObjectiveHistory(pair: lib.Pair, runNames: lib.RunNames) {
  // Data displayed in the tooltip for a segment of the objective history graph:
  type Tip = {
    fromTime: number;
    toTime: number;
    objectiveA?: CP.ObjectiveValue;
    objectiveB?: CP.ObjectiveValue;
    lowerBoundA?: CP.ObjectiveValue;
    lowerBoundB?: CP.ObjectiveValue;
  };

  // Compute tooltips for objective history graph. Sweep through all the lines
  // from the graph.
  let tips: Tip[] = [];
  {
    // Indexes into objective history:
    let oA = 0;
    let oB = 0;
    // Indexes into lower bound history:
    let lA = 0;
    let lB = 0;
    // Time of previous event:
    let t = 0;
    // The current tip:
    let tip: Tip = {
      fromTime: 0, toTime: 0,
      objectiveA: undefined,
      objectiveB: undefined,
      lowerBoundA: undefined,
      lowerBoundB: undefined
    };
    // Max/min objective values (including lower bounds):
    for (;;) {
      let nextTime = Infinity;
      let nextEvent = undefined;
      if (oA < pair.a.objectiveHistory.length) {
        let nextTimeA = pair.a.objectiveHistory[oA].solveTime;
        if (nextTimeA < nextTime) {
          nextTime = nextTimeA;
          nextEvent = "objectiveA";
        }
      }
      if (oB < pair.b.objectiveHistory.length) {
        let nextTimeB = pair.b.objectiveHistory[oB].solveTime;
        if (nextTimeB < nextTime) {
          nextTime = nextTimeB;
          nextEvent = "objectiveB";
        }
      }
      if (lA < pair.a.lowerBoundHistory.length) {
        let nextTimeA = pair.a.lowerBoundHistory[lA].solveTime;
        if (nextTimeA < nextTime) {
          nextTime = nextTimeA;
          nextEvent = "lowerBoundA";
        }
      }
      if (lB < pair.b.lowerBoundHistory.length) {
        let nextTimeB = pair.b.lowerBoundHistory[lB].solveTime;
        if (nextTimeB < nextTime) {
          nextTime = nextTimeB;
          nextEvent = "lowerBoundB";
        }
      }
      if (nextEvent === undefined)
        break;
      tip.toTime = nextTime;
      tips.push(tip);
      tip = {
        fromTime: nextTime,
        toTime: 0,
        objectiveA: tip.objectiveA,
        objectiveB: tip.objectiveB,
        lowerBoundA: tip.lowerBoundA,
        lowerBoundB: tip.lowerBoundB
      };
      if (nextEvent === "objectiveA") {
        tip.objectiveA = pair.a.objectiveHistory[oA].objective;
        oA++;
      } else if (nextEvent === "objectiveB") {
        tip.objectiveB = pair.b.objectiveHistory[oB].objective;
        oB++;
      } else if (nextEvent === "lowerBoundA") {
        tip.lowerBoundA = pair.a.lowerBoundHistory[lA].value;
        lA++;
      } else if (nextEvent === "lowerBoundB") {
        tip.lowerBoundB = pair.b.lowerBoundHistory[lB].value;
        lB++;
      }
    }
    tip.toTime = Math.max(pair.a.duration, pair.b.duration);
    tips.push(tip);
  }

  // For quick access to the end of each line:
  let endTimeA = pair.a.duration;
  let lastObjA = pair.a.objectiveHistory[pair.a.objectiveHistory.length - 1];
  let lastLBA = pair.a.lowerBoundHistory[pair.a.lowerBoundHistory.length - 1];
  let endTimeB = pair.b.duration;
  let lastObjB = pair.b.objectiveHistory[pair.b.objectiveHistory.length - 1];
  let lastLBB = pair.b.lowerBoundHistory[pair.b.lowerBoundHistory.length - 1];

  let usedMarker: Plot.Marker = "dot";
  // Common options for all lines in the plot:
  let commonOptions = { x: "solveTime", marker: usedMarker, strokeWidth: 2 };
  // Stroke must be a function. If we use a string, it will be interpreted as a color.
  // And for legend, we need to use strings.
  let optionsObjectiveA = { stroke: (_: CP.ObjectiveValue) => "Objective " + runNames[0], y: "objective", ...commonOptions };
  let optionsObjectiveB = { stroke: (_: CP.ObjectiveValue) => "Objective " + runNames[1], y: "objective", ...commonOptions };
  let optionsLBA = { stroke: (_: CP.ObjectiveValue) => "Lower bound " + runNames[0], y: "value", ...commonOptions };
  let optionsLBB = { stroke: (_: CP.ObjectiveValue) => "Lower bound " + runNames[1], y: "value", ...commonOptions };

  return Plot.plot({
    marginLeft: 50,
    width: 1200,
    height: 600,
    y: { grid: true, label: "Objective" },
    x: { label: "Time" },
    color: {
      type: "categorical",
      domain: ["Objective " + runNames[0], "Objective " + runNames[1], "Lower bound " + runNames[0], "Lower bound " + runNames[1]],
      //range: ["#1966b0", "#eb773e", "#73d9f0", "#f7b301"],
      legend: true,
    },
    marks: [
      Plot.ruleX([0]),
      Plot.gridY(),
      Plot.frame(),

      // Draw lower bounds first, so that they are behind the objectives:
      Plot.line(pair.b.lowerBoundHistory, optionsLBB),
      Plot.line([lastLBB, { solveTime: endTimeB, value: lastLBB.value}], optionsLBB),

      Plot.line(pair.a.lowerBoundHistory, optionsLBA),
      Plot.line([lastLBA, { solveTime: endTimeA, value: lastLBA.value}], optionsLBA),

      // Dots were replaced by markers (see commonOptions):
      //   Plot.dot(pair.b.objectiveHistory, optionsObjectiveB),
      Plot.line(pair.b.objectiveHistory, optionsObjectiveB),
      // Last line segment from the last solution to the end of the solve:
      Plot.line(
        pair.b.objectiveHistory.length == 0 ? [] : [lastObjB, { solveTime: endTimeB, objective: lastObjB.objective }],
        optionsObjectiveB
      ),
      // Star symbol at the end of the solve if there was a proof:
      Plot.dot(pair.b.proof ? [{ solveTime: endTimeB, value: lastObjB.objective }] : [], {
        x: "solveTime",
        y: "value",
        r: 5,
        symbol: "star",
        stroke: _ => "Objective " + runNames[1],
        fill: _ => "Objective " + runNames[1]
      }),

      Plot.line(pair.a.objectiveHistory, optionsObjectiveA),
      Plot.line(
        pair.a.objectiveHistory.length == 0 ? [] : [lastObjA, { solveTime: endTimeA, objective: lastObjA.objective}],
        optionsObjectiveA
      ),
      Plot.dot(pair.a.proof ? [{ solveTime: endTimeA, value: lastObjA.objective }] : [], {
        x: "solveTime",
        y: "value",
        r: 5,
        symbol: "star",
        stroke: _ => "Objective " + runNames[0],
        fill: _ => "Objective " + runNames[0]
      }),


      Plot.tip(tips, Plot.pointerX({
        x: (d: Tip) => (d.fromTime + d.toTime) / 2,
        title: (d: Tip) =>
          "Time: " + lib.formatDuration(d.fromTime) + " - " + lib.formatDuration(d.toTime) + "\n" +
          "Objective " + runNames[0] + ": " + lib.formatObjective(d.objectiveA) + "\n" +
          "Objective " + runNames[1] + ": " + lib.formatObjective(d.objectiveB) + "\n" +
          "Lower bound " + runNames[0] + ": " + lib.formatObjective(d.lowerBoundA) + "\n" +
          "Lower bound " + runNames[1] + ": " + lib.formatObjective(d.lowerBoundB),
      })),

      // The following is copied from: https://observablehq.com/plot/interactions/pointer
      // There's also an example that instead of the tip shows its text somewhere else.
      Plot.ruleX(tips, Plot.pointerX({x: (d: Tip) => (d.fromTime + d.toTime) / 2, stroke: "black", strokeWidth: 1})),
    ],
  });
}

function makeComparisonTable(pair: lib.Pair, runNames: lib.RunNames) {
  let table = d3.select('#Statistics').append('table');

  let headers = table.append('thead').append('tr');
  headers.append('th').text('');
  headers.append('th').text(runNames[0]);
  headers.append('th').text(runNames[1]);
  headers.append('th').attr('colspan', 2).text('Difference');

  type TableRow = [string, string, string, string, string];

  let tableData: TableRow[] = [
    [
      "Objective",
      lib.formatObjective(pair.a.objective),
      lib.formatObjective(pair.b.objective),
      lib.formatObjectiveDiff(pair.a.objective, pair.b.objective),
      lib.formatRelativeObjectiveDiff(pair.a.objective, pair.b.objective)
    ],
    [
      "Lower bound",
      lib.formatObjective(pair.a.lowerBound),
      lib.formatObjective(pair.b.lowerBound),
      lib.formatObjectiveDiff(pair.a.lowerBound, pair.b.lowerBound),
      lib.formatRelativeObjectiveDiff(pair.a.lowerBound, pair.b.lowerBound)
    ],
    [
      "Duration",
      lib.formatDuration(pair.a.duration),
      lib.formatDuration(pair.b.duration),
      lib.formatDurationDiff(pair.a.duration, pair.b.duration),
      lib.formatRelativeDiff(pair.a.duration, pair.b.duration),
    ],
    [
      "Solution time",
      lib.formatDuration(pair.a.bestSolutionTime),
      lib.formatDuration(pair.b.bestSolutionTime),
      lib.formatDurationDiff(pair.a.bestSolutionTime, pair.b.bestSolutionTime),
      lib.formatRelativeDiff(pair.a.bestSolutionTime, pair.b.bestSolutionTime),
    ],
    [
      "LB time",
      lib.formatDuration(pair.a.bestLBTime),
      lib.formatDuration(pair.b.bestLBTime),
      lib.formatDurationDiff(pair.a.bestLBTime, pair.b.bestLBTime),
      lib.formatRelativeDiff(pair.a.bestLBTime, pair.b.bestLBTime),
    ],
    [
      "Status",
      "" + lib.formatStatus(pair.a),
      "" + lib.formatStatus(pair.b),
      lib.formatStatus(pair.a) == lib.formatStatus(pair.b) ? "Same" : "",
      ""
    ],
    [
      "# Workers",
      "" + pair.a.nbWorkers,
      "" + pair.b.nbWorkers,
      lib.formatAbsoluteDiff(pair.a.nbWorkers, pair.b.nbWorkers),
      lib.formatRelativeDiff(pair.a.nbWorkers, pair.b.nbWorkers),
    ],
    [
      "# Solutions",
      "" + pair.a.nbSolutions,
      "" + pair.b.nbSolutions,
      lib.formatAbsoluteDiff(pair.a.nbSolutions, pair.b.nbSolutions),
      lib.formatRelativeDiff(pair.a.nbSolutions, pair.b.nbSolutions),
    ],
    [
      "# LNS steps",
      pair.a.nbLNSSteps >= 0 ? lib.format(pair.a.nbLNSSteps) : "",
      pair.b.nbLNSSteps >= 0 ? lib.format(pair.b.nbLNSSteps) : "",
      pair.a.nbLNSSteps >= 0 && pair.b.nbLNSSteps >= 0 ? lib.formatAbsoluteDiff(pair.a.nbLNSSteps, pair.b.nbLNSSteps) : "",
      pair.a.nbLNSSteps >= 0 && pair.b.nbLNSSteps >= 0 ? lib.formatRelativeDiff(pair.a.nbLNSSteps, pair.b.nbLNSSteps) : "",
    ],
    [
      "# LNS steps / second",
      pair.a.nbLNSSteps >= 0 ? lib.format(pair.a.nbLNSSteps / Math.max(pair.a.duration, 0.001)) : "",
      pair.b.nbLNSSteps >= 0 ? lib.format(pair.b.nbLNSSteps / Math.max(pair.b.duration, 0.001)) : "",
      pair.a.nbLNSSteps >= 0 && pair.b.nbLNSSteps >= 0 ? lib.formatAbsoluteDiff(pair.a.nbLNSSteps / Math.max(pair.a.duration, 0.001), pair.b.nbLNSSteps / Math.max(pair.b.duration, 0.001)) : "",
      pair.a.nbLNSSteps >= 0 && pair.b.nbLNSSteps >= 0 ? lib.formatRelativeDiff(pair.a.nbLNSSteps / Math.max(pair.a.duration, 0.001), pair.b.nbLNSSteps / Math.max(pair.b.duration, 0.001)) : "",
    ],
    [
      "# Restarts",
      pair.a.nbRestarts >= 0 ? lib.format(pair.a.nbRestarts) : "",
      pair.b.nbRestarts >= 0 ? lib.format(pair.b.nbRestarts) : "",
      pair.a.nbRestarts >= 0 && pair.b.nbRestarts >= 0 ? lib.formatAbsoluteDiff(pair.a.nbRestarts, pair.b.nbRestarts) : "",
      pair.a.nbRestarts >= 0 && pair.b.nbRestarts >= 0 ? lib.formatRelativeDiff(pair.a.nbRestarts, pair.b.nbRestarts) : "",
    ],
    [
      "# Restarts / second",
      pair.a.nbRestarts >= 0 ? lib.format(pair.a.nbRestarts / Math.max(pair.a.duration, 0.001)) : "",
      pair.b.nbRestarts >= 0 ? lib.format(pair.b.nbRestarts / Math.max(pair.b.duration, 0.001)) : "",
      pair.a.nbRestarts >= 0 && pair.b.nbRestarts >= 0 ? lib.formatAbsoluteDiff(pair.a.nbRestarts / Math.max(pair.a.duration, 0.001), pair.b.nbRestarts / Math.max(pair.b.duration, 0.001)) : "",
      pair.a.nbRestarts >= 0 && pair.b.nbRestarts >= 0 ? lib.formatRelativeDiff(pair.a.nbRestarts / Math.max(pair.a.duration, 0.001), pair.b.nbRestarts / Math.max(pair.b.duration, 0.001)) : "",
    ],
    [
      "# Branches",
      lib.format(pair.a.nbBranches),
      lib.format(pair.b.nbBranches),
      lib.formatAbsoluteDiff(pair.a.nbBranches, pair.b.nbBranches),
      lib.formatRelativeDiff(pair.a.nbBranches, pair.b.nbBranches),
    ],
    [
      "# Branches / second",
      lib.format(pair.a.nbBranches / Math.max(pair.a.duration, 0.001)),
      lib.format(pair.b.nbBranches / Math.max(pair.b.duration, 0.001)),
      lib.formatAbsoluteDiff(pair.a.nbBranches / Math.max(pair.a.duration, 0.001), pair.b.nbBranches / Math.max(pair.b.duration, 0.001)),
      lib.formatRelativeDiff(pair.a.nbBranches / Math.max(pair.a.duration, 0.001), pair.b.nbBranches / Math.max(pair.b.duration, 0.001)),
    ],
    [
      "# Fails",
      lib.format(pair.a.nbFails),
      lib.format(pair.b.nbFails),
      lib.formatAbsoluteDiff(pair.a.nbFails, pair.b.nbFails),
      lib.formatRelativeDiff(pair.a.nbFails, pair.b.nbFails),
    ],
    [
      "# Fails / second",
      lib.format(pair.a.nbFails / Math.max(pair.a.duration, 0.001)),
      lib.format(pair.b.nbFails / Math.max(pair.b.duration, 0.001)),
      lib.formatAbsoluteDiff(pair.a.nbFails / Math.max(pair.a.duration, 0.001), pair.b.nbFails / Math.max(pair.b.duration, 0.001)),
      lib.formatRelativeDiff(pair.a.nbFails / Math.max(pair.a.duration, 0.001), pair.b.nbFails / Math.max(pair.b.duration, 0.001)),
    ],
    [
      "# Int Variables",
      d3.format("d")(pair.a.nbIntVars),
      d3.format("d")(pair.b.nbIntVars),
      lib.formatAbsoluteDiff(pair.a.nbIntVars, pair.b.nbIntVars),
      lib.formatRelativeDiff(pair.a.nbIntVars, pair.b.nbIntVars),
    ],
    [
      "# Interval Variables",
      d3.format("d")(pair.a.nbIntervalVars),
      d3.format("d")(pair.b.nbIntervalVars),
      lib.formatAbsoluteDiff(pair.a.nbIntervalVars, pair.b.nbIntervalVars),
      lib.formatRelativeDiff(pair.a.nbIntervalVars, pair.b.nbIntervalVars),
    ],
    [
      "# Constraints",
      d3.format("d")(pair.a.nbConstraints),
      d3.format("d")(pair.b.nbConstraints),
      lib.formatAbsoluteDiff(pair.a.nbConstraints, pair.b.nbConstraints),
      lib.formatRelativeDiff(pair.a.nbConstraints, pair.b.nbConstraints),
    ],
    [
      "Memory usage",
      lib.formatMemory(pair.a.memoryUsed),
      lib.formatMemory(pair.b.memoryUsed),
      lib.formatDeltaMemory(pair.a.memoryUsed, pair.b.memoryUsed),
      lib.formatRelativeDiff(pair.a.memoryUsed, pair.b.memoryUsed),
    ],
    [
      "Solver",
      pair.a.solver,
      pair.b.solver,
      pair.a.solver != pair.b.solver ? "Diff" : "Same",
      "",
    ],
    [
      "Time limit",
      lib.formatDuration(pair.a.parameters.timeLimit),
      lib.formatDuration(pair.b.parameters.timeLimit),
      lib.formatDurationDiff(pair.a.parameters.timeLimit, pair.b.parameters.timeLimit),
      lib.formatRelativeDiff(pair.a.parameters.timeLimit, pair.b.parameters.timeLimit),
    ],
    [
      "CPU",
      pair.a.cpu,
      pair.b.cpu,
      pair.a.cpu != pair.b.cpu ? "Diff" : "Same",
      ""
    ],
    [
      "Date",
      "" + pair.a.solveDate,
      "" + pair.b.solveDate,
      "",
      ""
    ]
  ];

  let rows = table.append('tbody')
    .selectAll('tr')
    .data<TableRow>(tableData)
    .enter()
    .append('tr');

  rows.selectAll('th')
    .data(row => [row[0]])
    .enter()
    .append('th')
    .text(d => d);

  rows.selectAll('td')
    .data((d: string[]) => d.slice(1))
    .enter()
    .append('td')
    .text((d: string) => d);
}

function stringifyParameters(parameters: CP.Parameters) {
  let parts: string[] = [];
  for (let [key, value] of Object.entries(parameters)) {
    if (!Array.isArray(value))
      parts.push("--" + key + " " + value);
    else {
      let arrayName = key;
      if (key.endsWith('s'))
        arrayName = key.slice(0, -1);
      for (let i = 0; i < value.length; i++) {
        let prefix = "--" + arrayName + i + ".";
        for (let [key2, value2] of Object.entries(value[i]))
          parts.push(prefix + key2 + " " + value2);
      }
    }
  }
  return parts.join(" ");
}

function makeParametersTable(pair: lib.Pair, runNames: lib.RunNames) {
  let params = d3.select('#Parameters');
  let r1 = params.append("tr");
  r1.append("th").text(runNames[0]);
  r1.append('td').text(stringifyParameters(pair.a.parameters));
  let r2 = params.append("tr");
  r2.append("th").text(runNames[1]);
  r2.append('td').text(stringifyParameters(pair.b.parameters));
}

// To avoid await on the top level:
function main(pair: lib.Pair, runNames: lib.RunNames) {
  let modelNameDOM = document.querySelector("#ModelName");
  if (modelNameDOM)
    modelNameDOM.textContent = pair.modelName;

  let objectiveHistory = document.querySelector("#ObjectiveHistory");
  if (objectiveHistory)
    objectiveHistory.append(plotObjectiveHistory(pair, runNames));

  makeComparisonTable(pair, runNames);
  makeParametersTable(pair, runNames);
}

// Store the main function in the global scope, so that it can be called from
// the HTML page.  Otherwise it will be optimized away as unused.
// Also webpack may change the name of the function to save space. This way
// we can still call it.
(window as any).scheduleopt = {main: main};
