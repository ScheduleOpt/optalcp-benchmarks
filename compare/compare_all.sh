#!/bin/sh

# This scripts generates the comparison plots for the  results stored in the repository.
# Before running this script, make sure to first compile the code as described in the README.md file.
# The results are stored in the results directory.

mkdir results

node compare.mjs "Jobshop" OptalCP ../benchmarks/jobshop/results/Optal-4W-2FDS.json "CP Optimizer" ../benchmarks/jobshop/results/CPO-4W.json results/jobshop
node compare.mjs "Flexible Jobshop" OptalCP ../benchmarks/flexible-jobshop/results/Optal-4W-2FDS.json "CP Optimizer" ../benchmarks/flexible-jobshop/results/CPO-4W.json results/flexible-jobshop
node compare.mjs "Jobshop TT" OptalCP ../benchmarks/jobshop-tt/results/Optal-4W-2FDS.json "CP Optimizer" ../benchmarks/jobshop-tt/results/CPO-4W.json results/jobshop-tt
node compare.mjs "RCPSP" OptalCP ../benchmarks/rcpsp/results/Optal-4W-2FDS.json "CP Optimizer" ../benchmarks/rcpsp/results/CPO-4W.json results/rcpsp
node compare.mjs "RCPSP-CPR" OptalCP ../benchmarks/rcpsp-cpr/results/Optal-4W-2FDS.json "CP Optimizer" ../benchmarks/rcpsp-cpr/results/CPO-4W.json results/rcpsp-cpr
node compare.mjs "Blocking Jobshop" OptalCP ../benchmarks/blocking-jobshop/results/Optal-4W-2FDS.json "CP Optimizer" ../benchmarks/blocking-jobshop/results/CPO-4W.json results/blocking-jobshop
node compare.mjs "Non-permutation Flowshop" OptalCP ../benchmarks/non-permutation-flowshop/results/Optal-4W-2FDS.json.gz "CP Optimizer" ../benchmarks/non-permutation-flowshop/results/CPO-4W-UNFINISHED.json results/non-permutation-flowshop
node compare.mjs "Permutation Flowshop" OptalCP ../benchmarks/permutation-flowshop/results/Optal-Taillard-30m-4W-2FDS.json "CP Optimizer" ../benchmarks/permutation-flowshop/results/CPO-Taillard-30m-4W.json results/permutation-flowshop

node compare.mjs "Jobshop with 4 Operators" OptalCP ../benchmarks/jobshop-operators/results/4Opers-Optal-4W-2FDS.json "CP Optimizer" ../benchmarks/jobshop-operators/results/4Opers-CPO-4W.json results/jobshop-operators-4
node compare.mjs "Jobshop with 5 Operators" OptalCP ../benchmarks/jobshop-operators/results/5Opers-Optal-4W-2FDS.json "CP Optimizer" ../benchmarks/jobshop-operators/results/5Opers-CPO-4W.json results/jobshop-operators-5
node compare.mjs "Jobshop with 6 Operators" OptalCP ../benchmarks/jobshop-operators/results/6Opers-Optal-4W-2FDS.json "CP Optimizer" ../benchmarks/jobshop-operators/results/6Opers-CPO-4W.json results/jobshop-operators-6
node compare.mjs "Jobshop with 7 Operators" OptalCP ../benchmarks/jobshop-operators/results/7Opers-Optal-4W-2FDS.json "CP Optimizer" ../benchmarks/jobshop-operators/results/7Opers-CPO-4W.json results/jobshop-operators-7
node compare.mjs "Jobshop with 8 Operators" OptalCP ../benchmarks/jobshop-operators/results/8Opers-Optal-4W-2FDS.json "CP Optimizer" ../benchmarks/jobshop-operators/results/8Opers-CPO-4W.json results/jobshop-operators-8
node compare.mjs "Jobshop with 9 Operators" OptalCP ../benchmarks/jobshop-operators/results/9Opers-Optal-4W-2FDS.json "CP Optimizer" ../benchmarks/jobshop-operators/results/9Opers-CPO-4W.json results/jobshop-operators-9
node compare.mjs "Jobshop with 10 Operators" OptalCP ../benchmarks/jobshop-operators/results/10Opers-Optal-4W-2FDS.json "CP Optimizer" ../benchmarks/jobshop-operators/results/10Opers-CPO-4W.json results/jobshop-operators-10

node compare.mjs "MMRCPSP PSPLIB" OptalCP ../benchmarks/mmrcpsp/results/PSPLIB-Optal-4W-2FDS.json "CP Optimizer" ../benchmarks/mmrcpsp/results/PSPLIB-CPO-4W.json results/mmrcpsp-PSPLIB
node compare.mjs "MMRCPSP MMLIB50" OptalCP ../benchmarks/mmrcpsp/results/MMLIB50-Optal-4W-2FDS.json "CP Optimizer" ../benchmarks/mmrcpsp/results/MMLIB50-CPO-4W.json results/mmrcpsp-MMLIB50
node compare.mjs "MMRCPSP MMLIB100" OptalCP ../benchmarks/mmrcpsp/results/MMLIB100-Optal-4W-2FDS.json "CP Optimizer" ../benchmarks/mmrcpsp/results/MMLIB100-CPO-4W.json results/mmrcpsp-MMLIB100
