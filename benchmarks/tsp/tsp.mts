import { strict as assert } from 'assert';
import * as CP from '@scheduleopt/optalcp';
import * as utils from '../../utils/utils.mjs';

// An auxiliary function for the GEO distance function.
function latitudeLongitude(x: number, y: number): [number, number] {
  let degreesX = Math.round(x);
  let minutesX = x - degreesX;
  let latitude = Math.PI * (degreesX + 5.0 * minutesX / 3.0 ) / 180.0;
  let degreesY = Math.round(y);
  let minutesY = y - degreesY;
  let longitude = Math.PI * (degreesY + 5.0 * minutesY / 3.0 ) / 180.0;
  return [latitude, longitude];
}

function defineModel(filename: string): CP.Model {
  let lines = utils.readFile(filename).trim().split('\n');
  /*
  Input file looks like this:
      NAME: <name>
      TYPE: TSP
      COMMENT: <comment>
      DIMENSION: <number of nodes>
      EDGE_WEIGHT_TYPE: GEO
      EDGE_WEIGHT_FORMAT: FUNCTION
      DISPLAY_DATA_TYPE: COORD_DISPLAY
      NODE_COORD_SECTION
      1  x1  y1
      2  x2  y2
      ...
      EOF
  */
  let pos = 0;
  let nbNodes = -1;
  let edgeWeightType = "";
  for (;;) {
    if (lines[pos].match(/^NAME *: /)) {
      pos++;
      continue;
    }
    if (lines[pos].match(/^TYPE *: TSP *$/)) {
      pos++;
      continue;
    }
    if (lines[pos].match(/^COMMENT *: /)) {
      pos++;
      continue;
    }
    if (lines[pos].match(/^DIMENSION *: /)) {
      nbNodes = parseInt(lines[pos].split(':')[1]);
      pos++;
      continue;
    }
    if (lines[pos].match(/^EDGE_WEIGHT_TYPE *:/)) {
      edgeWeightType = lines[pos].split(':')[1].trim();
      if (edgeWeightType != "GEO" && edgeWeightType != "EUC_2D" && edgeWeightType != "CEIL_2D") {
        console.error(`Unsupported edge weight type (not implemented): "${edgeWeightType}"`);
        process.exit();
      }
      pos++;
      continue;
    }
    if (lines[pos].match(/^EDGE_WEIGHT_FORMAT *: FUNCTION *$/)) {
      pos++;
      continue;
    }
    if (lines[pos].match(/^DISPLAY_DATA_TYPE *: COORD_DISPLAY *$/)) {
      pos++;
      continue;
    }
    if (lines[pos].match(/^NODE_COORD_SECTION *$/)) {
      pos++;
      break;
    }
    console.error(`Unrecognized line: "${lines[pos]}"`);
    process.exit();
  }

  let transitionMatrix : number[][] = [];

  if (edgeWeightType == "GEO" || edgeWeightType == "EUC_2D" || edgeWeightType == "CEIL_2D")  {
    let nodes: { x: number, y: number }[] = [];
    for (let i = 0; i < nbNodes; i++) {
      let nodeData = lines[pos++].trim().split(/\s+/).map(Number);
      assert(nodeData.length == 3, "Invalid input file format (node data)");
      assert(nodeData[0] == i + 1, "Invalid input file format (node number)");
      nodes.push({ x: nodeData[1], y: nodeData[2] });
    }
    // EOF at the end is not mandatory:
    if (pos < lines.length)
      assert(lines[pos++].match(/^ *EOF *$/), "Invalid input file format (EOF)");

    for (let i = 0; i < nbNodes; i++) {
      let row = [];
      if (edgeWeightType == "EUC_2D") {
        for (let j = 0; j < nbNodes; j++)
          row[j] = Math.round(Math.sqrt(Math.pow(nodes[i].x - nodes[j].x, 2) + Math.pow(nodes[i].y - nodes[j].y, 2)));
      } else if (edgeWeightType == "CEIL_2D") {
        for (let j = 0; j < nbNodes; j++)
          row[j] = Math.ceil(Math.sqrt(Math.pow(nodes[i].x - nodes[j].x, 2) + Math.pow(nodes[i].y - nodes[j].y, 2)));
      } else {
        assert(edgeWeightType == "GEO");
        //  Compute geographical distance of points i and j. I.e. the distance on
        //  idealized sphere with diameter the earth.
        for (let j = 0; j < nbNodes; j++) {
          /*
          TSP format doc gives the following algorithm (nint means round to nearest integer):
          PI = 3.141592;
          deg = nint( x[i] );
          min = x[i] - deg;
          latitude[i] = PI * (deg + 5.0 * min / 3.0 ) / 180.0;
          deg = nint( y[i] );
          min = y[i] - deg;
          longitude[i] = PI * (deg + 5.0 * min / 3.0 ) / 180.0;
          RRR = 6378.388;
          q1 = cos( longitude[i] - longitude[j] );
          q2 = cos( latitude[i] - latitude[j] );
          q3 = cos( latitude[i] + latitude[j] );
          dij = (int) ( RRR * acos( 0.5*((1.0+q1)*q2 - (1.0-q1)*q3) ) + 1.0);
          */
          let [latitudeI, longitudeI] = latitudeLongitude(nodes[i].x, nodes[i].y);
          let [latitudeJ, longitudeJ] = latitudeLongitude(nodes[j].x, nodes[j].y);
          let q1 = Math.cos(longitudeI - longitudeJ);
          let q2 = Math.cos(latitudeI - latitudeJ);
          let q3 = Math.cos(latitudeI + latitudeJ);
          row[j] = Math.round(6378.388 * Math.acos(0.5 * ((1.0 + q1) * q2 - (1.0 - q1) * q3)) + 1.0);
        }
      }
      transitionMatrix.push(row);
    }
  }

  let model = new CP.Model(utils.makeModelName('tsp', filename));
  let intervals = Array.from({length: nbNodes}, (_, i) => model.intervalVar({ length: 0, name: `N_${i}` }));
  let sequence = model.sequenceVar(intervals);
  model.noOverlap(sequence, transitionMatrix);
  model.max(intervals.map(itv => itv.end())).minimize();

  return model;
}

let params: CP.BenchmarkParameters = {
  usage: "Usage: node tsp.js [OPTIONS] INPUT_FILE [INPUT_FILE2] .."
};
let restArgs = CP.parseSomeBenchmarkParameters(params);
CP.benchmark(defineModel, restArgs, params);
