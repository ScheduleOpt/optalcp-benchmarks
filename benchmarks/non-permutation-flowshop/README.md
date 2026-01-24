# Non-permutation Flowshop

Flowshop scheduling problem, or FSP for short, is a type of scheduling problem that involves multiple jobs and multiple machines. Each job consists of several operations, each of which requires one of the machines. All jobs require the machines in the same order, but the durations of the operations are different. Each job visits each machine exactly once.
The goal usually is to find the optimal order in which the jobs should be scheduled on the machines to minimize the makespan, which is the total time it takes to complete all jobs.

_Permutation flowshop_, or PFSP for short, has an additional requirement that the order of jobs on all machines must be the same. In _non-permutation flowshop_, the order of jobs on the machines can differ. Usually, just _flowshop_ means non-permutation flowshop (see, e.g., [Wikipedia](https://en.wikipedia.org/wiki/Flow-shop_scheduling)). However, some authors use the term _flowshop_ for permutation flowshop. So we stick with the name _non-permutation flowshop_.

See [../permutation-flowshop/](../permutation-flowshop/) for the permutation variant.

## Benchmark instances

Non-permutation flowshop and permutation flowshop share the same benchmark instances.

* **Taillard instances**. The source is [web page of prof. Taillard](http://mistic.heig-vd.ch/taillard/problemes.dir/ordonnancement.dir/ordonnancement.html).
* **VRF Instances**. VRF instances and reference was taken from: http://soa.iti.es/problem-instances/benchmark
* **OR-Library instances**. OR-Library instances were downloaded from: http://people.brunel.ac.uk/~mastjjb/jeb/orlib/files/flowshop1.txt

The top of the file `flowshop1.txt` from OR-Library says:

```text
* car1-car8 are from
   J. Carlier (1978),
   Ordonnancements a contraintes disjonctives,
   R.A.I.R.O. Recherche operationelle/Operations Research 12, 333-351.
* hel1-hel2 are from
   J. Heller (1960),
   Some numerical experiments for an MxJ flow shop and its decision-
   theoretical aspects,
   Operations Research 8, 178-184.
* reC01-reC42 are from
   C.R. Reeves (1995),
   A genetic algorithm for flowshop sequencing,
   Computer Ops Res 22, 5-13.
   (Only odd-numbered instances are given, since the even-numbered instances
   are obtained from the previous instance by just reversing the processing
   order of each job; the optimal value of each odd-numbered instance and
   its even-numbered counterpart is the same.)
```

## File formats

There are two different file formats for FlowShop:

1. Taillard format, specific for FlowShop.
2. OR-Library format, shared with JobShop (FlowShop is a special case of JobShop where the order of machines is the same for all jobs). It is used also by VRF instances.

This benchmark supports both formats and auto-detects which one is used.

## Best known results

Hard to find. Usually, there are only bounds for permutation flowshop.
Some upper bounds could be probably found here: <https://github.com/mrpritt/npfs3/tree/main>

## Other sources

Benchmark data can also be found here: <https://github.com/ptal/kobe-scheduling>
