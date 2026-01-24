# RCPSP with consumption and production of resources

## Problem description

The Resource-Constrained Project Scheduling Problem with Consumption and Production of Resources (RCPSP-CPR) extends the classical RCPSP by introducing storage resources (also called reservoirs or cumulative resources). Unlike renewable resources that are fully available again after a task completes, storage resources track cumulative levels that change based on consumption at the start of activities and production at their end. The goal is to schedule all activities while respecting precedence constraints, renewable resource capacities, and storage resource level bounds.

## Data sets

Downloaded from the web page of Pierre Lopez: <https://homepages.laas.fr/lopez/>

As usual in RCPSP data instances, there are dummy source and sink jobs. In this dataset, they consume and produce the reservoirs (not renewable resources). However, if we take into account the production and consumption by those dummy jobs, then the number of infeasible instances does not match with the results reported in the paper by Koné, Artigues, Lopez and Mongeau. For this reason, we ignore reservoir consumption and production by source and sink.

Two instances are not mentioned in the paper:

* `data/Pack_ConsProd/ConsProd_Pack032b.rcp`
* `data/KSD30_ConsProd/ConsProd_j07.rcp`

## File format

Described in [README.txt provided with the data](data/README.txt).

## Related publications

Oumar Koné, Christian Artigues, Pierre Lopez, Marcel Mongeau:
[_Comparison of mixed integer linear programming models for the resource-constrained project scheduling problem with consumption and production of resources_](https://doi.org/10.1007/s10696-012-9152-5).
Flexible Services and Manufacturing Journal 25(1-2): 25–47 (2013)
