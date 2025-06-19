# Flexible JobShop

## Data files

* Most data files were downloaded from here: <https://people.idsia.ch/~monaldo/fjsp.html>
* Some more, using "internet way back machine", from: <https://opus.ub.hsu-hh.de/volltexte/2012/2982/pdf/FJSSPinstances.zip>

Then it required some data cleaning.

## TODO:

* Found other(?) data here: <https://openhsu.ub.hsu-hh.de/entities/publication/12025e3c-16da-4475-ad44-9722bf877c80>
* And here: <https://github.com/SchedulingLab/fjsp-instances>
* Are there some new instances? The paper maybe describes some details about the instances.
* The paper promisses instances with workcenters. However, at the first glance, I don't see them.

## Papers

There is a recent paper on Flexible Jobshop. It even mentions IBM and Quintiq blogs that already disappeared:

[The flexible job shop scheduling problem: A review](https://www.sciencedirect.com/science/article/abs/pii/S037722172300382X).
The paper itself is inaccessible, but supplementary material is available. It includes lower and upper bounds.

Another recent paper:

Kasapidis, Dauzère-Pérès, Paraskevopoulos, Repoussis, Tarantilis:
[On the multiresource flexible job-shop scheduling problem with arbitrary precedence graphs](https://onlinelibrary.wiley.com/doi/full/10.1111/poms.13977)

## Quintiq and CP Optimizer

There was a blog post on Quintiq web page about achieving new best results for
flexible jobshop. It is not accessible any more, but it is in internet wayback
machine:

<http://www.quintiq.com/optimization/fjssp-world-records.html>
<http://www.quintiq.com/optimization/flexible-job-shop-scheduling-problem-results.html>

It is not clear what machine they used and what time limit.

Based on that, there is IBM blog post by Jean-Francois Puget. Again not
accessible any more, but it is in internet wayback machine:

<https://www.ibm.com/developerworks/community/blogs/jfp/entry/solving_flexible_job_shop_scheduling_problems?lang=en>

It seems that Quintiq reacted, improved the results and incorporated CPO results into their own post.

Directory `reference` contains results from those two blogs.
