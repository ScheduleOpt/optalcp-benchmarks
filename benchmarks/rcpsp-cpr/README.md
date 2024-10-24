# RCPSP with consumption and production of resources

## Data sets

Downloaded from the web page of Pierre Lopez: <https://homepages.laas.fr/lopez/>

As usual in RCPSP data instances, there are dummy source and sink jobs. But in our case, they consume and produce the reservoirs (not renewable resources). But, if we take into account the production and consumption by those dummy source and sink jobs, then the number of infeasible instances does not match with the results reported in the paper by Kone, Artigues, Lopez and Mongeau. For this reason, we ignore reservoir consumption and production by source and sink.

Two instances are not mentioned in the paper:

* `data/Pack_ConsProd/ConsProd_Pack032b.rcp`
* `data/KSD30_ConsProd/ConsProd_j07.rcp`

Some instances are infeasible.

## File format

Described in [README.txt provided with the data](data/README.txt).

## Related publications

Oumar Kone, Christian Artigues, Pierre Lopez, Marcel Mongeau:
_Comparison of mixed integer linear programming models for the resource-constrained project scheduling problem with consumption and production of resources_
