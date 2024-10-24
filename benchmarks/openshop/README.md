# Openshop

## Instances

Instance files are hard to find. I downloaded the files from <https://cspsat.gitlab.io/csp2sat/oss>.
The SAT files contain the original files in the comments; they could be recovered using the following shell script:

```sh
grep '^ *#' $1 | grep -v '# OSS' | sed 's/^ *# *//' 
```

## References

Malapert, Cambazard, Guéret, Jussien, Langevin, Rousseau:
_An Optimal Constraint Programming Approach to the Open-Shop Problem_
