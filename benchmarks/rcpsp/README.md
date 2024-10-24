# RCPSP

## Data sets

* Data sets `j30`, `j60`, `j90` and `j120` were downloaded from PSPLIB: <http://www.om-db.wi.tum.de/psplib/data.html>
* Other data sets were downloaded from kobe-scheduling: <https://github.com/ptal/kobe-scheduling>
* Sets `CV`, `DC` and `sD` are from `RCPLIB.zip` from <https://www.projectmanagement.ugent.be/research/data>. There are even more instances in `RCPLIB.zip`. However, they are not readable directly.

In kobe-scheduling, there are files `optimum.csv` with known optimum makespans.
However, it is not clear where this data comes from.

## File format

There are two file formats: `.sm` and `.rcp`. The script uses the filename suffix to decide how to parse the file.

