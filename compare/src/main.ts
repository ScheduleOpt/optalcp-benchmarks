import * as d3 from "d3";
import * as Plot from "@observablehq/plot";
import * as CP from "@scheduleopt/optalcp";
import * as lib from './lib.mjs';
import 'sortable-tablesort'

function reportRunErrors(runName: string, errors: CP.BenchmarkResult[], div: d3.Selection<d3.BaseType, unknown, HTMLElement, unknown>) {
  if (errors.length === 0)
    return;
  div.append("h3").text("Errors in " + runName);
  div.append("ul")
    .selectAll("li")
    .data<CP.BenchmarkResult>(errors)
    .enter()
    .append("li")
    .text((error: CP.BenchmarkResult) => {
      if (error.modelName === undefined)
        return "Unnamed model (cannot be paired).";
      if (error.error !== undefined)
        return error.modelName + ": " + error.error;
      return error.modelName + ": " + "Unknown error.";
  });
}

function reportErrors(runNames: lib.RunNames, errorsA: CP.BenchmarkResult[], errorsB: CP.BenchmarkResult[]) {
  if (errorsA.length == 0 && errorsB.length == 0)
    return;
  let errorsDiv = d3.select("#Errors");
  if (!errorsDiv)
    return;
  errorsDiv.append("h2").text("Errors");
  reportRunErrors(runNames[0], errorsA, errorsDiv);
  reportRunErrors(runNames[1], errorsB, errorsDiv);
}

function makeDetailedTable(pairs: lib.BriefPair[], runNames: lib.RunNames) {
  let table = d3.select('#DetailedTable').append('table')
  table.attr("class", "sortable");

  let headers = table.append('thead').append('tr');
  headers.append('th').text('Model name');
  headers.append('th').text('Objective diff');
  headers.append('th').text('Solution time diff');
  headers.append('th').text('Time diff');
  headers.append('th').text('Lower bound diff');
  headers.append('th').text('Status ' + runNames[0]);
  headers.append('th').text('Status ' + runNames[1]);
  headers.append('th').text('Objective ' + runNames[0]);
  headers.append('th').text('Objective ' + runNames[1]);
  headers.append('th').text('Lower bound ' + runNames[0]);
  headers.append('th').text('Lower bound ' + runNames[1]);
  headers.append('th').text('Solution time ' + runNames[0]);
  headers.append('th').text('Solution time ' + runNames[1]);
  headers.append('th').text('Duration ' + runNames[0]);
  headers.append('th').text('Duration ' + runNames[1]);

  let rows = table.append('tbody')
    .selectAll('tr')
    .data<lib.BriefPair>(pairs)
    .enter()
    .append('tr');

  rows.append('td')
    .append('a')
    .attr('href', (pair) => encodeURIComponent(pair.modelName + ".html"))
    .attr('target', '_blank')
    .text((pair: lib.BriefPair) => pair.a.modelName!);

  rows.append('td')
    .text((pair: lib.BriefPair) => {
      if (lib.areObjectivesSame(pair.a.objective, pair.b.objective))
        return "";
      return lib.formatObjectiveDiff(pair.a.objective, pair.b.objective)
    })
    .attr("data-sort", (pair: lib.BriefPair) => {
      let result = lib.objectiveDiff(pair.a.objective, pair.b.objective);
      if (result === undefined)
        return "";
      return "" + result;
    });
  rows.append('td')
    .text((pair: lib.BriefPair) => {
      if (!lib.areObjectivesSame(pair.a.objective, pair.b.objective))
        return "";
      return lib.formatDurationDiff(pair.a.bestSolutionTime, pair.b.bestSolutionTime);
    })
    .attr("data-sort", (pair: lib.BriefPair) => {
      if (!lib.areObjectivesSame(pair.a.objective, pair.b.objective))
        return "";
      if (pair.a.bestSolutionTime === undefined || pair.b.bestSolutionTime === undefined)
        return "";
      return pair.a.bestSolutionTime - pair.b.bestSolutionTime;
    });
  rows.append('td')
    .text((pair: lib.BriefPair) => {
      if (!lib.areObjectivesSame(pair.a.objective, pair.b.objective))
        return "";
      return lib.formatDurationDiff(pair.a.duration, pair.b.duration);
    })
    .attr("data-sort", (pair: lib.BriefPair) => {
      if (!lib.areObjectivesSame(pair.a.objective, pair.b.objective))
        return "";
      return pair.a.duration - pair.b.duration;
    });
  rows.append('td')
    .text((pair: lib.BriefPair) => {
      if (lib.areObjectivesSame(pair.a.lowerBound, pair.b.lowerBound))
        return "";
      return lib.formatObjectiveDiff(pair.a.lowerBound, pair.b.lowerBound)
    })
    .attr("data-sort", (pair: lib.BriefPair) => {
      let result = lib.objectiveDiff(pair.a.lowerBound, pair.b.lowerBound);
      if (result === undefined)
        return "";
      return "" + result;
    });

  rows.append('td').text((pair: lib.BriefPair) => lib.formatStatus(pair.a));
  rows.append('td').text((pair: lib.BriefPair) => lib.formatStatus(pair.b));

  rows.append('td')
    .text((pair: lib.BriefPair) => lib.formatObjective(pair.a.objective))
    .attr("data-sort", (pair: lib.BriefPair) => lib.objectiveForSort(pair.a.objective));
  rows.append('td')
    .text((pair: lib.BriefPair) => lib.formatObjective(pair.b.objective))
    .attr("data-sort", (pair: lib.BriefPair) => lib.objectiveForSort(pair.b.objective));

  rows.append('td')
    .text((pair: lib.BriefPair) => lib.formatObjective(pair.a.lowerBound))
    .attr("data-sort", (pair: lib.BriefPair) => lib.objectiveForSort(pair.a.lowerBound));
  rows.append('td')
    .text((pair: lib.BriefPair) => lib.formatObjective(pair.b.lowerBound))
    .attr("data-sort", (pair: lib.BriefPair) => lib.objectiveForSort(pair.b.lowerBound));

  rows.append('td')
    .text((pair: lib.BriefPair) => lib.formatDuration(pair.a.bestSolutionTime))
    .attr("data-sort", (pair: lib.BriefPair) => pair.a.bestSolutionTime === undefined ? "" : "" + pair.a.bestSolutionTime);
  rows.append('td')
    .text((pair: lib.BriefPair) => lib.formatDuration(pair.b.bestSolutionTime))
    .attr("data-sort", (pair: lib.BriefPair) => pair.b.bestSolutionTime === undefined ? "" : "" + pair.b.bestSolutionTime);

  rows.append('td')
    .text((pair: lib.BriefPair) => lib.formatDuration(pair.a.duration))
    .attr("data-sort", (pair: lib.BriefPair) => "" + pair.a.duration);
  rows.append('td')
    .text((pair: lib.BriefPair) => lib.formatDuration(pair.b.duration))
    .attr("data-sort", (pair: lib.BriefPair) => "" + pair.b.duration);
}

type Stats = {
  sumObjectives: number,
  nObjectives: number,
  sumLowerBounds: number,
  nLowerBounds: number,
  sumSolutionTimes: number,
  nSolutionTimes: number,
  sumDurations: number,
  nDurations: number,
  sumLBTimes: number,
  nLBTimes: number,
  nOptimal: number,
  nSolution: number,
  nInfeasible: number,
  nNoSolution: number,
  sumNbSolutions: number,
  nNbSolutions: number,
  sumNbLNSSteps: number,
  nNbLNSSteps: number;
  sumNbRestarts: number,
  nNbRestarts: number;
  sumNbBranches: number,
  nNbBranches: number;
  sumNbFails: number,
  nNbFails: number;
  sumMemory: number,
  nMemory: number;
};

function initStats(): Stats {
  return {
    sumObjectives: 0,
    nObjectives: 0,
    sumLowerBounds: 0,
    nLowerBounds: 0,
    sumSolutionTimes: 0,
    nSolutionTimes: 0,
    sumDurations: 0,
    nDurations: 0,
    sumLBTimes: 0,
    nLBTimes: 0,
    nOptimal: 0,
    nSolution: 0,
    nInfeasible: 0,
    nNoSolution: 0,
    sumNbSolutions: 0,
    nNbSolutions: 0,
    sumNbLNSSteps: 0,
    nNbLNSSteps: 0,
    sumNbRestarts: 0,
    nNbRestarts: 0,
    sumNbBranches: 0,
    nNbBranches: 0,
    sumNbFails: 0,
    nNbFails: 0,
    sumMemory: 0,
    nMemory: 0,
  };
}

function addToStats(r: lib.BriefBenchmarkResult, stats: Stats) {
  if (typeof r.objective == "number") {
    stats.sumObjectives += r.objective;
    stats.nObjectives++;
  }
  if (typeof r.lowerBound == "number") {
    stats.sumLowerBounds += r.lowerBound;
    stats.nLowerBounds++;
  }
  if (typeof r.bestSolutionTime == "number") {
    stats.sumSolutionTimes += r.bestSolutionTime;
    stats.nSolutionTimes++;
  }
  if (typeof r.duration == "number") {
    stats.sumDurations += r.duration;
    stats.nDurations++;
  }
  if (typeof r.bestLBTime == "number") {
    stats.sumLBTimes += r.bestLBTime;
    stats.nLBTimes++;
  }
  let status = lib.formatStatus(r);
  if (status == "Optimum")
    stats.nOptimal++;
  else if (status == "Solution")
    stats.nSolution++;
  else if (status == "Infeasible")
    stats.nInfeasible++;
  else if (status == "No solution")
    stats.nNoSolution++;
  stats.sumNbSolutions += r.nbSolutions;
  stats.nNbSolutions++;
  if (r.nbLNSSteps >= 0) {
    stats.sumNbLNSSteps += r.nbLNSSteps;
    stats.nNbLNSSteps++;
  }
  if (r.nbRestarts >= 0) {
    stats.sumNbRestarts += r.nbRestarts;
    stats.nNbRestarts++;
  }
  stats.sumNbBranches += r.nbBranches;
  stats.nNbBranches++;
  stats.sumNbFails += r.nbFails;
  stats.nNbFails++;
  stats.sumMemory += r.memoryUsed;
  stats.nMemory++;
}

function calcMeans(stats: Stats) {
  if (stats.nObjectives == 0)
    stats.nObjectives = 1;
  if (stats.nLowerBounds == 0)
    stats.nLowerBounds = 1;
  if (stats.nSolutionTimes == 0)
    stats.nSolutionTimes = 1;
  if (stats.nDurations == 0)
    stats.nDurations = 1;
  if (stats.nLBTimes == 0)
    stats.nLBTimes = 1;
  if (stats.nNbSolutions == 0)
    stats.nNbSolutions = 1;
  if (stats.nNbBranches == 0)
    stats.nNbBranches = 1;
  if (stats.nNbFails == 0)
    stats.nNbFails = 1;
  if (stats.nMemory == 0)
    stats.nMemory = 1;
  return {
    objective: stats.sumObjectives / stats.nObjectives,
    lowerBound: stats.sumLowerBounds / stats.nLowerBounds,
    solutionTime: stats.sumSolutionTimes / stats.nSolutionTimes,
    duration: stats.sumDurations / stats.nDurations,
    lbTime: stats.sumLBTimes / stats.nLBTimes,
    nbSolutions: stats.sumNbSolutions / stats.nNbSolutions,
    nbLNSSteps: stats.nNbLNSSteps == 0 ? undefined : stats.sumNbLNSSteps / stats.nNbLNSSteps,
    lnsStepsPerSecond: stats.nNbLNSSteps == 0 ? undefined : stats.sumNbLNSSteps / Math.max(stats.sumDurations, 0.001),
    nbRestarts: stats.nNbRestarts == 0 ? undefined : stats.sumNbRestarts / stats.nNbRestarts,
    restartsPerSecond: stats.nNbRestarts == 0 ? undefined : stats.sumNbRestarts / Math.max(stats.sumDurations, 0.001),
    nbBranches: stats.sumNbBranches / stats.nNbBranches,
    branchesPerSecond: stats.sumNbBranches / Math.max(stats.sumDurations, 0.001),
    nbFails: stats.sumNbFails / stats.nNbFails,
    failsPerSecond: stats.sumNbFails / Math.max(stats.sumDurations, 0.001),
    memory: stats.sumMemory / stats.nMemory,
  };
}

function makeSummary(pairs: lib.BriefPair[], runNames: lib.RunNames) {

  let statsA: Stats = initStats();
  let statsB: Stats = initStats();

  let nLowerObjective = 0;
  let nSameObjective = 0;
  let nHigherObjective = 0;
  let nASolvesFaster = 0;
  let nBSolvesFaster = 0;
  let nAFaster = 0;
  let nBFaster = 0;

  for (let pair of pairs) {
    addToStats(pair.a, statsA);
    addToStats(pair.b, statsB);
    if (typeof pair.a.objective == "number" && typeof pair.b.objective == "number") {
      if (pair.a.objective < pair.b.objective)
        nLowerObjective++;
      else if (pair.a.objective > pair.b.objective)
        nHigherObjective++;
      else {
        nSameObjective++;
        if (pair.a.bestSolutionTime! < pair.b.bestSolutionTime!)
          nASolvesFaster++;
        else if (pair.a.bestSolutionTime! > pair.b.bestSolutionTime!)
          nBSolvesFaster++;
        if (pair.a.duration < pair.b.duration)
          nAFaster++;
        else if (pair.a.duration > pair.b.duration)
          nBFaster++;
      }
    }
  }
  let meansA = calcMeans(statsA);
  let meansB = calcMeans(statsB);

  let list = d3.select('#Summary').append('ul');
  list.append('li').text("Number of instances: " + pairs.length);
  list.append('li').text("objective(" + runNames[0] + ") < objective(" + runNames[1] + "): " + nLowerObjective + " times");
  list.append('li').text("objective(" + runNames[0] + ") = objective(" + runNames[1] + "): " + nSameObjective + " times");
  list.append('li').text("objective(" + runNames[0] + ") > objective(" + runNames[1] + "): " + nHigherObjective + " times");
  let subList = list.append('li').text("When objectives are the same (" + nSameObjective + " times):").append('ul');
  subList.append('li').text("solutionTime(" + runNames[0] + ") < solutionTime(" + runNames[1] + "): " + nASolvesFaster + " times");
  subList.append('li').text("solutionTime(" + runNames[0] + ") > solutionTime(" + runNames[1] + "): " + nBSolvesFaster + " times");
  subList.append('li').text("duration(" + runNames[0] + ") < duration(" + runNames[1] + "): " + nAFaster + " times");
  subList.append('li').text("duration(" + runNames[0] + ") > duration(" + runNames[1] + "): " + nBFaster + " times");

  let table = d3.select('#Summary').append('table');
  table.attr("id", "SummaryTable");

  let headers = table.append('thead').append('tr');
  headers.append('th').text('');
  headers.append('th').text(runNames[0]);
  headers.append('th').text(runNames[1]);
  headers.append('th').attr('colspan', 2).text('Difference');

  type TableRow = [string, string, string, string, string];

  let tableData: TableRow[] = [
    [
      "Mean Objective",
      lib.formatObjective(meansA.objective),
      lib.formatObjective(meansB.objective),
      lib.formatObjectiveDiff(meansA.objective, meansB.objective),
      lib.formatRelativeDiff(meansA.objective, meansB.objective)
    ],
    [
      "Mean lower bound",
      lib.formatObjective(meansA.lowerBound),
      lib.formatObjective(meansB.lowerBound),
      lib.formatObjectiveDiff(meansA.lowerBound, meansB.lowerBound),
      lib.formatRelativeDiff(meansA.lowerBound, meansB.lowerBound)
    ],
    [
      "Mean Duration",
      lib.formatDuration(meansA.duration),
      lib.formatDuration(meansB.duration),
      lib.formatDurationDiff(meansA.duration, meansB.duration),
      lib.formatRelativeDiff(meansA.duration, meansB.duration),
    ],
    [
      "Mean solution time",
      lib.formatDuration(meansA.solutionTime),
      lib.formatDuration(meansB.solutionTime),
      lib.formatDurationDiff(meansA.solutionTime, meansB.solutionTime),
      lib.formatRelativeDiff(meansA.solutionTime, meansB.solutionTime),
    ],
    [
      "Mean LB time",
      lib.formatDuration(meansA.lbTime),
      lib.formatDuration(meansB.lbTime),
      lib.formatDurationDiff(meansA.lbTime, meansB.lbTime),
      lib.formatRelativeDiff(meansA.lbTime, meansB.lbTime),
    ],
    [
      "# Optimal solution",
      "" + statsA.nOptimal,
      "" + statsB.nOptimal,
      lib.formatAbsoluteDiff(statsA.nOptimal, statsB.nOptimal),
      lib.formatRelativeDiff(statsA.nOptimal, statsB.nOptimal),
    ],
    [
      "# Solution",
      "" + statsA.nSolution,
      "" + statsB.nSolution,
      lib.formatAbsoluteDiff(statsA.nSolution, statsB.nSolution),
      lib.formatRelativeDiff(statsA.nSolution, statsB.nSolution),
    ],
    [
      "# Infeasible",
      "" + statsA.nInfeasible,
      "" + statsB.nInfeasible,
      lib.formatAbsoluteDiff(statsA.nInfeasible, statsB.nInfeasible),
      lib.formatRelativeDiff(statsA.nInfeasible, statsB.nInfeasible),
    ],
    [
      "# No solution",
      "" + statsA.nNoSolution,
      "" + statsB.nNoSolution,
      lib.formatAbsoluteDiff(statsA.nNoSolution, statsB.nNoSolution),
      lib.formatRelativeDiff(statsA.nNoSolution, statsB.nNoSolution),
    ],
    [
      "Mean # Solutions",
      lib.format(meansA.nbSolutions),
      lib.format(meansB.nbSolutions),
      lib.formatAbsoluteDiff(meansA.nbSolutions, meansB.nbSolutions),
      lib.formatRelativeDiff(meansA.nbSolutions, meansB.nbSolutions),
    ],
    [
      "Mean # LNS steps",
      lib.format(meansA.nbLNSSteps),
      lib.format(meansB.nbLNSSteps),
      lib.formatAbsoluteDiff(meansA.nbLNSSteps, meansB.nbLNSSteps),
      lib.formatRelativeDiff(meansA.nbLNSSteps, meansB.nbLNSSteps),
    ],
    [
      "Mean # LNS steps / second",
      lib.format(meansA.lnsStepsPerSecond),
      lib.format(meansB.lnsStepsPerSecond),
      lib.formatAbsoluteDiff(meansA.lnsStepsPerSecond, meansB.lnsStepsPerSecond),
      lib.formatRelativeDiff(meansA.lnsStepsPerSecond, meansB.lnsStepsPerSecond),
    ],
    [
      "Mean # Restarts",
      lib.format(meansA.nbRestarts),
      lib.format(meansB.nbRestarts),
      lib.formatAbsoluteDiff(meansA.nbRestarts, meansB.nbRestarts),
      lib.formatRelativeDiff(meansA.nbRestarts, meansB.nbRestarts),
    ],
    [
      "Mean # Restarts / second",
      lib.format(meansA.restartsPerSecond),
      lib.format(meansB.restartsPerSecond),
      lib.formatAbsoluteDiff(meansA.restartsPerSecond, meansB.restartsPerSecond),
      lib.formatRelativeDiff(meansA.restartsPerSecond, meansB.restartsPerSecond),
    ],
    [
      "Mean # Branches",
      lib.format(meansA.nbBranches),
      lib.format(meansB.nbBranches),
      lib.formatAbsoluteDiff(meansA.nbBranches, meansB.nbBranches),
      lib.formatRelativeDiff(meansA.nbBranches, meansB.nbBranches),
    ],
    [
      "Mean # Branches / second",
      lib.format(meansA.branchesPerSecond),
      lib.format(meansB.branchesPerSecond),
      lib.formatAbsoluteDiff(meansA.branchesPerSecond, meansB.branchesPerSecond),
      lib.formatRelativeDiff(meansA.branchesPerSecond, meansB.branchesPerSecond),
    ],
    [
      "Mean # Fails",
      lib.format(meansA.nbFails),
      lib.format(meansB.nbFails),
      lib.formatAbsoluteDiff(meansA.nbFails, meansB.nbFails),
      lib.formatRelativeDiff(meansA.nbFails, meansB.nbFails),
    ],
    [
      "Mean # Fails / second",
      lib.format(meansA.failsPerSecond),
      lib.format(meansB.failsPerSecond),
      lib.formatAbsoluteDiff(meansA.failsPerSecond, meansB.failsPerSecond),
      lib.formatRelativeDiff(meansA.failsPerSecond, meansB.failsPerSecond),
    ],
    [
      "Mean memory usage",
      lib.formatMemory(meansA.memory),
      lib.formatMemory(meansB.memory),
      lib.formatDeltaMemory(meansA.memory, meansB.memory),
      lib.formatRelativeDiff(meansA.memory, meansB.memory),
    ],
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

function plotObjectiveHistory(history: lib.NormalizedHistory, runNames: lib.RunNames) {
  // Data displayed in the tooltip for a segment of the objective history graph:
  type Tip = {
    time: number;
    objectiveA: number;
    objectiveB: number;
    lowerBoundA: number;
    lowerBoundB: number;
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
    // The current tip:
    let tip: Tip = {
      time: 0,
      objectiveA: 0,
      objectiveB: 0,
      lowerBoundA: 0,
      lowerBoundB: 0,
    };
    let objA = history.objectiveA;
    let objB = history.objectiveB;
    let lbA = history.lowerBoundA;
    let lbB = history.lowerBoundB;
    let prevTime = 0;
    // Max/min objective values (including lower bounds):
    for (;;) {
      let nextTime = Infinity;
      let nextEvent : string | undefined = undefined;
      if (oA < objA.length) {
        let nextTimeA = objA[oA].time;
        if (nextTimeA < nextTime) {
          nextTime = nextTimeA;
          nextEvent = "objectiveA";
        }
      }
      if (oB < objB.length) {
        let nextTimeB = objB[oB].time;
        if (nextTimeB < nextTime) {
          nextTime = nextTimeB;
          nextEvent = "objectiveB";
        }
      }
      if (lA < lbA.length) {
        let nextTimeA = lbA[lA].time;
        if (nextTimeA < nextTime) {
          nextTime = nextTimeA;
          nextEvent = "lowerBoundA";
        }
      }
      if (lB < lbB.length) {
        let nextTimeB = lbB[lB].time;
        if (nextTimeB < nextTime) {
          nextTime = nextTimeB;
          nextEvent = "lowerBoundB";
        }
      }
      if (nextEvent === undefined)
        break;
      tip.time = (prevTime + nextTime) / 2;
      if (tips.length == 0 || tips[tips.length - 1].time != tip.time) {
        tips.push(tip);
        prevTime = nextTime;
      }
      tip = {
        time: 0,
        objectiveA: tip.objectiveA,
        objectiveB: tip.objectiveB,
        lowerBoundA: tip.lowerBoundA,
        lowerBoundB: tip.lowerBoundB
      };
      if (nextEvent === "objectiveA") {
        tip.objectiveA = objA[oA].value;
        oA++;
      } else if (nextEvent === "objectiveB") {
        tip.objectiveB = objB[oB].value;
        oB++;
      } else if (nextEvent === "lowerBoundA") {
        tip.lowerBoundA = lbA[lA].value;
        lA++;
      } else if (nextEvent === "lowerBoundB") {
        tip.lowerBoundB = lbB[lB].value;
        lB++;
      }
    }
    // Get rid of the first dummy tip:
    tips.shift();
  }

  // Common options for all lines in the plot:
  let commonOptions = { x: "time", strokeWidth: 2 };
  // Stroke must be a function. If we use a string, it will be interpreted as a color.
  // And for legend, we need to use strings.
  let optionsObjectiveA = { stroke: (_: number) => "Objective " + runNames[0], y: "value", ...commonOptions };
  let optionsObjectiveB = { stroke: (_: number) => "Objective " + runNames[1], y: "value", ...commonOptions };
  let optionsLBA = { stroke: (_: number) => "Lower bound " + runNames[0], y: "value", ...commonOptions };
  let optionsLBB = { stroke: (_: number) => "Lower bound " + runNames[1], y: "value", ...commonOptions };

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
      Plot.line(history.lowerBoundB, optionsLBB),
      Plot.line(history.lowerBoundA, optionsLBA),

      // Dots were replaced by markers (see commonOptions):
      //   Plot.dot(pair.b.objectiveHistory, optionsObjectiveB),
      Plot.line(history.objectiveB, optionsObjectiveB),

      Plot.line(history.objectiveA, optionsObjectiveA),

      Plot.tip(tips, Plot.pointerX({
        x: (d: Tip) => d.time,
        title: (d: Tip) =>
          "Time: " + lib.formatDuration(d.time) + "\n" +
          "Objective " + runNames[0] + ": " +   d3.format(".4f")(d.objectiveA) + "\n" +
          "Objective " + runNames[1] + ": " +   d3.format(".4f")(d.objectiveB) + "\n" +
          "Lower bound " + runNames[0] + ": " + d3.format(".4f")(d.lowerBoundA) + "\n" +
          "Lower bound " + runNames[1] + ": " + d3.format(".4f")(d.lowerBoundB),
      })),

      // The following is copied from: https://observablehq.com/plot/interactions/pointer
      // There's also an example that instead of the tip shows its text somewhere else.
      Plot.ruleX(tips, Plot.pointerX({x: (d: Tip) => (d.time) / 2, stroke: "black", strokeWidth: 1})),
    ],
  });
}


function main(
  pairs: lib.BriefPair[],
  runNames: lib.RunNames,
  normalizedHistory: lib.NormalizedHistory,
  errorsA: CP.BenchmarkResult[],
  errorsB: CP.BenchmarkResult[])
{
  reportErrors(runNames, errorsA, errorsB);
  makeSummary(pairs, runNames);
  makeDetailedTable(pairs, runNames);

  let objectiveHistory = document.querySelector("#ObjectiveHistory");
  if (objectiveHistory)
    objectiveHistory.append(plotObjectiveHistory(normalizedHistory, runNames));

  let objectiveDiff = document.querySelector("#ObjectiveDiff");
  if (objectiveDiff)
    objectiveDiff.append(
      lib.divergingBars(
        runNames,
        pairs,
        "Objective difference",
        (pair: lib.BriefPair) => lib.objectiveDiff(pair.a.objective, pair.b.objective),
        {
          "Objective difference": (pair: lib.BriefPair) => lib.formatObjectiveDiff(pair.a.objective, pair.b.objective),
          "Objective": "objective"
        }
      )
    );

  let relativeObjectiveDiff = document.querySelector("#ObjectiveRelativeDiff");
  if (relativeObjectiveDiff)
    relativeObjectiveDiff.append(
      lib.divergingBars(
        runNames,
        pairs,
        "Relative objective difference",
        (pair:lib.BriefPair) => lib.relativeObjectiveDiff(pair.a.objective, pair.b.objective),
        {
          "Objective difference": (pair: lib.BriefPair) => lib.formatRelativeObjectiveDiff(pair.a.objective, pair.b.objective),
          "Objective": "objective"
        },
        { percentage: true }
      )
    );

  let durationDiff = document.querySelector("#DurationDiff");
  if (durationDiff)
    durationDiff.append(
      lib.divergingBars(
        runNames,
        pairs,
        "Duration difference",
        (pair: lib.BriefPair) => lib.absoluteDiff(pair.a.duration, pair.b.duration),
        {
          "Duration difference": (pair: lib.BriefPair) => lib.formatDurationDiff(pair.a.duration, pair.b.duration),
          "Duration": (pair: lib.BriefPair) =>
            "Duration " + runNames[0] + ": " + lib.formatDuration(pair.a.duration) + "\n" +
            "Duration " + runNames[1] + ": " + lib.formatDuration(pair.b.duration)
        }
      )
    );

  let relativeDurationDiff = document.querySelector("#DurationRelativeDiff");
  if (relativeDurationDiff)
    relativeDurationDiff.append(
      lib.divergingBars(
        runNames,
        pairs,
        "Relative duration difference",
        (pair: lib.BriefPair) => lib.relativeDiff(pair.a.duration, pair.b.duration),
        {
          "Duration difference": (pair: lib.BriefPair) => lib.formatRelativeDiff(pair.a.duration, pair.b.duration),
          "": (pair: lib.BriefPair) =>
            "Duration: " + runNames[0] + ": " + lib.formatDuration(pair.a.duration) + "\n" +
            "Duration: " + runNames[1] + ": " + lib.formatDuration(pair.b.duration)
        },
        { percentage: true }
      )
    );

  let branchesDiff = document.querySelector("#BranchesDiff");
  if (branchesDiff)
    branchesDiff.append(
      lib.divergingBars(
        runNames,
        pairs,
        "Branches difference",
        (pair: lib.BriefPair) => lib.absoluteDiff(pair.a.nbBranches, pair.b.nbBranches),
        {
          "Branches difference": (pair: lib.BriefPair) => lib.formatAbsoluteDiff(pair.a.nbBranches, pair.b.nbBranches),
          "Branches": "nbBranches",
          "Objective": "objective"
        },
        { }
      )
    );

  let relativeBranchesDiff = document.querySelector("#BranchesRelativeDiff");
  if (relativeBranchesDiff)
    relativeBranchesDiff.append(
      lib.divergingBars(
        runNames,
        pairs,
        "Relative branches difference",
        (pair: lib.BriefPair) => lib.relativeDiff(pair.a.nbBranches, pair.b.nbBranches),
        {
          "Branches difference": (pair: lib.BriefPair) => lib.formatRelativeDiff(pair.a.nbBranches, pair.b.nbBranches),
          "Branches": "nbBranches",
          "Objective": "objective"
        },
        { percentage: true }
      )
    );

  let branchesPerSecDiff = document.querySelector("#BranchesPerSecDiff");
  if (branchesPerSecDiff)
    branchesPerSecDiff.append(
      lib.divergingBars(
        runNames,
        pairs,
        "Branches/s difference",
        (pair: lib.BriefPair) => lib.absoluteDiff(
          pair.a.nbBranches / Math.max(pair.a.duration, 0.001),
          pair.b.nbBranches / Math.max(pair.b.duration, 0.001)
        ),
        {
          "Branches/s difference": (pair: lib.BriefPair) => lib.formatAbsoluteDiff(
            pair.a.nbBranches / Math.max(pair.a.duration, 0.001),
            pair.b.nbBranches / Math.max(pair.b.duration, 0.001)
          ),
          "": (pair: lib.BriefPair) =>
            "Branches/s " + runNames[0] + ": " + lib.format(pair.a.nbBranches / Math.max(pair.a.duration, 0.001)) + "\n" +
            "Branches/s " + runNames[1] + ": " + lib.format(pair.b.nbBranches / Math.max(pair.b.duration, 0.001)),
          "Objective": "objective"
        },
        { }
      )
    );

  let relativeBranchesPerSecDiff = document.querySelector("#BranchesPerSecRelativeDiff");
  if (relativeBranchesPerSecDiff)
    relativeBranchesPerSecDiff.append(
      lib.divergingBars(
        runNames,
        pairs,
        "Relative branches/s difference",
        (pair: lib.BriefPair) => lib.relativeDiff(
          pair.a.nbBranches / Math.max(pair.a.duration, 0.001),
          pair.b.nbBranches / Math.max(pair.b.duration, 0.001)
        ),
        {
          "Branches/s difference": (pair: lib.BriefPair) => lib.formatRelativeDiff(
            pair.a.nbBranches / Math.max(pair.a.duration, 0.001),
            pair.b.nbBranches / Math.max(pair.b.duration, 0.001)
          ),
          "": (pair: lib.BriefPair) =>
            "Branches/s " + runNames[0] + ": " + lib.format(pair.a.nbBranches / Math.max(pair.a.duration, 0.001)) + "\n" +
            "Branches/s " + runNames[1] + ": " + lib.format(pair.b.nbBranches / Math.max(pair.b.duration, 0.001)),
          "Objective": "objective"
        },
        { percentage: true }
      )
    );

  // Hide LNS steps and restarts if they are not present in the data
  let hasLNSStepsA = false;
  let hasRestartsA = false;
  let hasLNSStepsB = false;
  let hasRestartsB = false;
  for (let pair of pairs) {
    if (pair.a.nbLNSSteps > 0)
      hasLNSStepsA = true;
    if (pair.a.nbRestarts > 0)
      hasRestartsA = true;
    if (pair.b.nbLNSSteps > 0)
      hasLNSStepsB = true;
    if (pair.b.nbRestarts > 0)
      hasRestartsB = true;
  }

  if (!hasLNSStepsA || !hasLNSStepsB)
    document.getElementById("LNSStepsDiv")?.remove();
  else {
    let lnsStepsDiff = document.querySelector("#LNSStepsDiff");
    if (lnsStepsDiff)
      lnsStepsDiff.append(
        lib.divergingBars(
          runNames,
          pairs,
          "LNS steps difference",
          (pair: lib.BriefPair) => lib.absoluteDiff(pair.a.nbLNSSteps, pair.b.nbLNSSteps),
          {
            "LNS steps difference": (pair: lib.BriefPair) => lib.formatAbsoluteDiff(pair.a.nbLNSSteps, pair.b.nbLNSSteps),
            "LNS steps": "nbLNSSteps",
            "Branches": "nbBranches",
            "Objective": "objective"
          },
          { }
        )
      );

    let relativeLNSStepsDiff = document.querySelector("#LNSStepsRelativeDiff");
    if (relativeLNSStepsDiff)
      relativeLNSStepsDiff.append(
        lib.divergingBars(
          runNames,
          pairs,
          "Relative LNS steps difference",
          (pair: lib.BriefPair) => lib.relativeDiff(pair.a.nbLNSSteps, pair.b.nbLNSSteps),
          {
            "LNS steps difference": (pair: lib.BriefPair) => lib.formatRelativeDiff(pair.a.nbLNSSteps, pair.b.nbLNSSteps),
            "LNS steps": "nbLNSSteps",
            "Branches": "nbBranches",
            "Objective": "objective"
          },
          { percentage: true }
        )
      );
  }

  if (!hasRestartsA || !hasRestartsB)
    document.getElementById("RestartsDiv")?.remove();
  else {
    let restartsDiff = document.querySelector("#RestartsDiff");
    if (restartsDiff)
      restartsDiff.append(
        lib.divergingBars(
          runNames,
          pairs,
          "Restarts difference",
          (pair: lib.BriefPair) => lib.absoluteDiff(pair.a.nbRestarts, pair.b.nbRestarts),
          {
            "Restarts difference": (pair: lib.BriefPair) => lib.formatAbsoluteDiff(pair.a.nbRestarts, pair.b.nbRestarts),
            "Restarts": "nbRestarts",
            "Branches": "nbBranches",
            "Objective": "objective"
          },
          { }
        )
      );

    let relativeRestartsDiff = document.querySelector("#RestartsRelativeDiff");
    if (relativeRestartsDiff)
      relativeRestartsDiff.append(
        lib.divergingBars(
          runNames,
          pairs,
          "Relative restarts difference",
          (pair: lib.BriefPair) => lib.relativeDiff(pair.a.nbRestarts, pair.b.nbRestarts),
          {
            "Restarts difference": (pair: lib.BriefPair) => lib.formatRelativeDiff(pair.a.nbRestarts, pair.b.nbRestarts),
            "Restarts": "nbRestarts",
            "Branches": "nbBranches",
            "Objective": "objective"
          },
          { percentage: true }
        )
      );
  }
}

// Store the main function in the global scope, so that it can be called from
// the HTML page.  Otherwise it will be optimized away as unused.
// Also webpack may change the name of the function to save space. This way
// we can still call it.
(window as any).scheduleopt = {main: main};
