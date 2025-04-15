# Vehicle Routing Problem with Time Windows

## Credits

The initial version of this benchmark was written by Vít Knobloch.

## Data files

Data files were downloaded from [CVRPLIB](http://vrp.galgos.inf.puc-rio.br/index.php/en/).

Some data files are too big. The transition matrix does not fit into Node.js memory, and Node.js crashes with an out-of-memory error.

## Known solutions

Knows solutions (also from [CVRPLIB](http://vrp.galgos.inf.puc-rio.br/index.php/en/)) can be found in the directory [`known-solutions`](known-solutions).

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
* **traveltime**: the total time spent by traveling (wihtout wating and without service times)
* **totaltime**: the total time spent by all vehicles (with traveling, waiting and service times)
* **path**: the time spent not at customer (i.e., the total traveling and waiting time)
* **nbvehicles**: the minimum number of vehicles used
* **nbvehicle,traveltime**: `1,000,000 * nbvehicles + traveltime`

## About the model

The model is similar to the model for [Capacitated Vehicle Routing Problem](../cvrp). There are a few differences:

* Nodes have service times bigger than 0. Because of that, there are no issues with the triangular inequality as in the [CVRP benchmark](../cvrp).
* Nodes have ready and due times, which are reflected by the minimum and maximum start times of the visits. The due date is not the maximum end time because sometimes `ready + service` is bigger than `due`.

## Rounding

The nodes are given by 2D coordinates, their distances are computed by the Euclidean distance. As OptalCP requires integer distances, the distances are rounded. The parameter `--rounding` can be set to `round` or `ceil`. The default is `round`.

## Scaling

Some known solutions give a non-integer path length, but OptalCP works only with integers. To get higher precision, all the input values can be multiplied by a constant factor given by `--scale <number>`. The objective value is increased by the scaling factor, too.

## Symmetry breaking

Vehicle symmetry can be broken by the parameter `--breakVehicleSymmetry` in the same way as in the [CVRP benchmark](../cvrp). Unlike CVRP, there is no direction symmetry in this benchmark.

As usual, symmetry breaking may be helpful for optimality proofs and the FDS search. However, it may slow down the LNS search.
