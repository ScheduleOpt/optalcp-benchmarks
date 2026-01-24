# Flexible Job Shop Scheduling Problem (FJSSP)

Each job consists of a sequence of operations that must be processed in order.
Each operation can be processed on one of several machines (flexibility).
Objective: minimize the makespan (completion time of all jobs).

## Data files

Most data files were downloaded from:
- <https://people.idsia.ch/~monaldo/fjsp.html>
- <https://opus.ub.hsu-hh.de/volltexte/2012/2982/pdf/FJSSPinstances.zip> (via Internet Archive)

Note: The Dauzere instances are the same as DPpaulli instances found in some other
repositories (e.g., FJSSP-W-Benchmarking), just with different naming.

Additional instances available at:
- <https://openhsu.ub.hsu-hh.de/entities/publication/12025e3c-16da-4475-ad44-9722bf877c80>
- <https://github.com/SchedulingLab/fjsp-instances>

## References

Recent survey paper (the paper itself is inaccessible, but the supplementary material
is available and includes lower and upper bounds):

- [The flexible job shop scheduling problem: A review](https://www.sciencedirect.com/science/article/abs/pii/S037722172300382X)

Related paper on multiresource FJSSP:

- Kasapidis, Dauzère-Pérès, Paraskevopoulos, Repoussis, Tarantilis:
  [On the multiresource flexible job-shop scheduling problem with arbitrary precedence graphs](https://onlinelibrary.wiley.com/doi/full/10.1111/poms.13977)

## Historical results

Quintiq and IBM CP Optimizer published competitive results for FJSSP.
The original blog posts are no longer available but can be accessed via
[Internet Archive Wayback Machine](https://web.archive.org/):

- <http://www.quintiq.com/optimization/fjssp-world-records.html>
- <http://www.quintiq.com/optimization/flexible-job-shop-scheduling-problem-results.html>
- <https://www.ibm.com/developerworks/community/blogs/jfp/entry/solving_flexible_job_shop_scheduling_problems?lang=en>

The `reference` directory contains results from these sources.
