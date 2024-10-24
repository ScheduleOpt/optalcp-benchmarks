
# This Makefile works only if CP Optimizer is installed and environment
# variable CPLEXINSTALL points to CPLEX Studio intallation (there should be
# cpoptimizer/examples subdirectory in that installation).

# The makefile tries to detect what kind of OS we're using. Based on that it
# tries to guess the right compilation flags. However those flags can depend on
# CPLEX version. Currently it works only for Linux and CPLEX version 22.0.
# Please improve this makefile if you have a different platform and/or CPLEX
# version. The way to find the right flags is to see how CP Optimizer examples
# (in directory cpoptimizer/examples/...) are compiled and copy the flags here.

CONCERTDIR=$(CPLEXINSTALL)/concert
CPLEXDIR=$(CPLEXINSTALL)/cplex
CPODIR=$(CPLEXINSTALL)/cpoptimizer

# Default optimization flags. Can be overriden by command line.
OPTFLAGS ?= -O -DNDEBUG

# Let's try to detect OS. Based on:
#    https://stackoverflow.com/questions/714100/os-detecting-makefile
ifeq ($(OS),Windows_NT)
  @echo "ERROR: Makefile for windows not implemented. Please fix me."
else
  UNAME_S := $(shell uname -s)
  ifeq ($(UNAME_S),Linux)
	  PLATFORM=x86-64_linux/static_pic
    # Based on flags defined in cpoptimizer/examples/x86-64_linux/static_pic/Makefile:
    CFLAGS =  $(OPTFLAGS) -I $(CPODIR)/include -I $(CONCERTDIR)/include -fPIC -fstrict-aliasing -pedantic -std=c++11 -Wall -Wextra -fexceptions -frounding-math -Wno-long-long -m64
    LDFLAGS = -L $(CPODIR)/lib/x86-64_linux/static_pic -lcp -L $(CPLEXDIR)/lib/x86-64_linux/static_pic -lcplex -L $(CONCERTDIR)/lib/x86-64_linux/static_pic -lconcert  -lpthread -lm -ldl
  endif
  ifeq ($(UNAME_S),Darwin)
	  PLATFORM=x86-64_osx/static_pic
    @echo "ERROR: Makefile for Mac not implemented. Please fix me."
  endif
endif


solveCPOs: solveCPOs.cpp
	$(CXX) -o solveCPOs $(CFLAGS) solveCPOs.cpp $(LDFLAGS)
