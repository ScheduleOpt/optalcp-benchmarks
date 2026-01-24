# Vehicle Routing Problem with Time Windows

A fleet of capacitated vehicles must serve a set of customers, each with a demand and a time window specifying when service can begin. All vehicles start and end at a central depot. The goal is to find routes that serve all customers within their time windows while respecting vehicle capacities, minimizing the chosen objective (e.g., total travel time, makespan, or number of vehicles used).

## Credits

The initial version of this benchmark was written by Vít Knobloch.

## Data files

Data files were downloaded from [CVRPLIB](http://vrp.galgos.inf.puc-rio.br/index.php/en/).

Some data files are too big. The transition matrix does not fit into Node.js memory, and Node.js crashes with an out-of-memory error.

## Known solutions

Known solutions (also from [CVRPLIB](http://vrp.galgos.inf.puc-rio.br/index.php/en/)) can be found in the directory [`known-solutions`](known-solutions).

## About the model

The model is similar to the model for [Capacitated Vehicle Routing Problem](../cvrp). There are a few differences:

* Nodes have service times greater than 0. Because of that, there are no issues with the triangular inequality as in the [CVRP benchmark](../cvrp).
* Nodes have ready and due times, which are reflected by the minimum and maximum start times of the visits. The due date is not the maximum end time because sometimes `ready + service` is greater than `due`.

## Benchmark-specific options

```text
VRP-TW options:
  --objective <objective type>   The type of the objective function (default: makespan)
  --scale <number>               Scale the time by a constant factor (default: 1)
  --breakVehicleSymmetry         Order vehicles by the maximum city visited (default: false)
  --rounding <round|ceil>        How to round the distances (default: ceil)
```

Objective types are:

* **makespan**: the time the last vehicle returns to the depot
* **traveltime**: the total time spent traveling (without waiting and without service times)
* **totaltime**: the total time of all vehicles (with traveling, waiting and service times)
* **path**: the time not spent at customers (i.e., the total traveling and waiting time)
* **nbvehicles**: the minimum number of vehicles used
* **nbvehicles,traveltime**: `1,000,000 * nbvehicles + traveltime`

## Rounding

The nodes are given by 2D coordinates, distances are computed using Euclidean distance. As OptalCP requires integer distances, the distances are rounded. The parameter `--rounding` can be set to `round` or `ceil`. The default is `ceil`.

## Scaling

Some known solutions give a non-integer path length, but OptalCP works only with integers. To get higher precision, all the input values can be multiplied by a constant factor given by `--scale <number>`. The objective value is also scaled accordingly.

## Symmetry breaking

Vehicle symmetry can be broken by the parameter `--breakVehicleSymmetry` in the same way as in the [CVRP benchmark](../cvrp). Unlike CVRP, there is no direction symmetry in this benchmark.

As usual, symmetry breaking may be helpful for optimality proofs and the FDS search. However, it may slow down the LNS search.
