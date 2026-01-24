# Open Shop Scheduling Problem

The Open Shop Scheduling Problem (OSSP) involves scheduling n jobs on m machines.
Each job consists of exactly m operations, one for each machine, with given
processing times. Unlike the Job Shop problem, there is no required order among
operations of a job—they can be processed in any sequence. However, operations
of the same job cannot overlap (a job can only be on one machine at a time), and
each machine can process only one operation at a time. The objective is to
minimize the makespan, i.e., the completion time of all operations.

## Instances

Instance files are hard to find. I downloaded the files from <https://cspsat.gitlab.io/csp2sat/oss>.
The SAT files contain the original files in the comments; they could be recovered using the following shell script:

```sh
grep '^ *#' $1 | grep -v '# OSS' | sed 's/^ *# *//' 
```

## References

Malapert, Cambazard, Guéret, Jussien, Langevin, Rousseau:
[_An Optimal Constraint Programming Approach to the Open-Shop Problem_](https://hal.science/hal-00685160)
