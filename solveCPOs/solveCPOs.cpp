#include <vector>
#include <thread>
#include <mutex>
#include <condition_variable>
#include "ilcp/cpext.h"

#ifdef _MSC_VER
#define strcasecmp _stricmp
#endif

// solveCPOs is a tool that solves .cpo models using CP Optimizer  and produces summary
// files in the same CSV format as OptalCP benchmarks.  It can be used to compare the
// performance of CP Optimizer with OptalCP or other solvers.

// CP Optimizer parameters (given on the command line) are kept in the following
// vector.  Any command-line argument that is not understood by solveCPO itself
// is assumed to be CP Optimizer parameter.
struct CPParameter {
  const char* param_;
  const char* value_;
};
typedef std::vector<CPParameter> CPParameters;

CPParameters cpParameters;

void applyCmdParameters(IloCP cp, const CPParameters& params)
{
  // Overwrite default log period since it scrolls too much. Could be still changed on command line:
  cp.setParameter(IloCP::LogPeriod, 1000000);
  for (const CPParameter& param: params)
    cp.setParameter(param.param_, param.value_);
}

struct ObjectiveHistoryItem {
  double solveTime_;
  double objective_;
};
typedef std::vector<ObjectiveHistoryItem> ObjectiveHistory;

struct LowerBoundEvent {
  double solveTime_;
  double value_;
};
typedef std::vector<LowerBoundEvent> LowerBoundHistory;

struct RunResult {
  std::time_t solveDate_{};
  std::string modelName_{};
  CPParameters parameters_;
  std::string error_ = "";
  // The following fields are set only if error_ is false:
  uint64_t randomSeed_ = 0;
  bool proof_ = false;
  const char* status_ = "ERROR";
  double objective_ = IloInfinity; // Infinity means undefined
  double lowerBound_ = -IloInfinity; // Infinity means undefined
  double duration_ = 0;
  double bestSolutionTime_ = IloInfinity; // Infinity means undefined
  double bestLBTime_ = IloInfinity; // Infinity means undefined
  int64_t nbSolutions_ = 0;
  int64_t nbLNSSteps_ = -1;
  int64_t nbRestarts_ = -1;
  int64_t nbBranches_ = 0;
  int64_t nbFails_ = 0;
  int64_t memoryUsed_ = 0;
  int64_t nbIntVars_ = 0;
  int64_t nbIntervalVars_ = 0;
  int64_t nbConstraints_ = 0;
  int64_t nbWorkers_ = 0;
  double timeLimit_ = 0;
  std::string solver_{};
  std::string cpu_{};
  std::string objectiveSense_{};
  // TODO:2 bestSolution_
  ObjectiveHistory objectiveHistory_;
  LowerBoundHistory lowerBoundHistory_;
};

// The following class is used to get the time of the last lower bound update:
class LBMonitor: public IloCP::Callback {
public:
 virtual void invoke(IloCP cp, IloCP::Callback::Reason reason) override
 {
    if (reason == IloCP::Callback::ObjBound) {
      double solveTime = cp.getInfo(IloCP::SolveTime);
      lastLBTime_ = solveTime;
      lbHistory_.push_back(LowerBoundEvent{solveTime, cp.getObjBound()});
    }
 }
 double getLBTime() const { return lastLBTime_; }
 LowerBoundHistory getLBHistory() { return std::move(lbHistory_); }

 private:
  double lastLBTime_ = IloInfinity;
  LowerBoundHistory lbHistory_;
};

const char* getObjectiveSense(const char* modelName)
{
  const char* sense = nullptr;
  std::ifstream model(modelName);
  std::string line;
  while (std::getline(model, line)) {
    // We expect minimize and maximize to be at the beginning of the line.
    // Normally it is the case, but it doesn't have to be this way in general.
    if (line.find("minimize") == 0) {
      if (sense)
        throw std::runtime_error(std::string{"Multiple objectives detected in file '"} + modelName + "'.");
      sense = "minimize";
    }
    if (line.find("maximize") == 0) {
      if (sense)
        throw std::runtime_error(std::string{"Multiple objectives detected in file '"} + modelName + "'.");
      sense = "maximize";
    }
  }
  if (!sense)
    return "";
  return sense;
}

RunResult runModel(const char* modelName, const std::string& cpuName, bool quiet = false)
{
  IloEnv env;
  RunResult result;
  result.modelName_ = modelName;
  result.error_ = "Unknown error";
  result.solveDate_ = std::time(nullptr);
  result.parameters_ = cpParameters;
  result.solver_ = std::string{"CP Optimizer "} + IloCP::GetVersion();
  result.cpu_ = cpuName;
  // Remove .cpo suffix from the name of the model reported in --summary:
  if (result.modelName_.size() > 4) {
    std::string suffix = result.modelName_.substr(result.modelName_.size() - 4);
    if (suffix == ".cpo" || suffix == ".CPO")
      result.modelName_.resize(result.modelName_.size() - 4);
  }
  try {
    IloCP cp(env);
    if (!quiet) {
      std::cout << "\n";
      std::cout << "================================================================================\n";
      std::cout << "Model: " << result.modelName_ << "\n";
      std::cout << "================================================================================\n";
      std::cout << std::endl;
    }
    else
      cp.setParameter(IloCP::LogVerbosity, IloCP::Quiet);
    result.objectiveSense_ = getObjectiveSense(modelName);
    cp.importModel(modelName);
    applyCmdParameters(cp, result.parameters_);
    if (quiet)
      cp.setParameter(IloCP::LogVerbosity, IloCP::Quiet);
    LBMonitor lbMonitor;
    cp.addCallback(&lbMonitor);
    result.randomSeed_ = cp.getParameter(IloCP::RandomSeed);
    cp.startNewSearch();
    while (cp.next()) {
      double solveTime = cp.getInfo(IloCP::SolveTime);
      result.bestSolutionTime_ = solveTime;
      if (cp.hasObjective())
        result.objectiveHistory_.push_back({solveTime, cp.getObjValue()});
      else {
        result.objectiveHistory_.push_back({solveTime, IloInfinity});
        break;
      }
    }
    cp.removeAllCallbacks();
    cp.endSearch();
    result.nbSolutions_ = cp.getInfo(IloCP::NumberOfSolutions);
    if (result.nbSolutions_ > 0 && cp.hasObjective()) {
      result.objective_ = cp.getObjValue();
      result.lowerBound_ = cp.getObjBound();
    }
    result.bestLBTime_ = lbMonitor.getLBTime();
    result.lowerBoundHistory_ =  lbMonitor.getLBHistory();
    result.nbFails_ = cp.getInfo(IloCP::NumberOfFails);
    result.nbBranches_ = cp.getInfo(IloCP::NumberOfBranches);
    result.nbIntVars_ = cp.getInfo(IloCP::NumberOfIntegerVariables);
    result.nbIntervalVars_ = cp.getInfo(IloCP::NumberOfIntervalVariables);
    result.nbConstraints_ = cp.getInfo(IloCP::NumberOfConstraints);
    result.memoryUsed_ = cp.getInfo(IloCP::PeakMemoryUsage);
    result.duration_ = cp.getInfo(IloCP::SolveTime);
    result.timeLimit_ = cp.getParameter(IloCP::TimeLimit);
    if (cp.getInfo(IloCP::SearchStatus) == IloCP::SearchCompleted) {
      // Whole search space was explored.
      result.proof_ = true;
      if (result.nbSolutions_ > 0)
        result.status_ = "Optimum";
      else
        result.status_ = "Infeasible";
    }
    else {
      result.proof_ = false;
      assert(cp.getInfo(IloCP::SearchStatus) == IloCP::SearchStopped);
      if (result.nbSolutions_ > 0)
        result.status_ = "Solution";
      else
        result.status_ = "No solution";
    }
    result.nbWorkers_ = cp.getInfo(IloCP::EffectiveWorkers);
    result.error_ = "";
  }
  catch (const IloException& ex) {
    std::cerr << "Exception caught: " << ex << std::endl;
    result.error_ = ex.getMessage();
  }
  catch (const std::exception& ex) {
    std::cerr << "Error: " << ex.what() << std::endl;
    result.error_ = ex.what();
  }
  catch (...) {
    std::cerr << "Caught unknown exception." << std::endl;
    result.error_ = "Unknown exception caught";
  }
  env.end();
  return result;
}

std::ofstream summary;
const char* summaryFileName = nullptr;
std::ofstream json;
const char* jsonFileName = nullptr;
bool jsonNeedsComma = false;
std::string cpuName = "Unknown CPU";
uint32_t nbParallelRuns = 1;
std::vector<const char*> inputModels;

void initSummary(const char* filename)
{
  summaryFileName = filename;
  summary = std::ofstream(filename);
  summary << "Model name;Random seed;Status;Objective;Lower bound;Time;Last solution time;LB time;Solutions;LNS "
             "steps;Restarts;Branches;Fails;Memory;Int Vars;IntervalVars;Constraints;Solver;Workers;Time limit;Parameters;CPU;Date";
  summary << std::endl;
  if (!summary.good())
    throw std::runtime_error(std::string{"Cannot write into summary file '"} + summaryFileName + "'.");
}

void writeSummary(RunResult result)
{
  if (!summaryFileName)
    return; // --summary was not specified.
  summary << result.modelName_ << ";";
  summary << result.randomSeed_ << ";";
  summary << result.status_ << ";";
  if (result.nbSolutions_ > 0)
    summary << result.objective_;
  summary << ";";
  summary << result.lowerBound_ << ";";
  summary << result.duration_ << ";";
  if (result.nbSolutions_ > 0)
    summary << result.bestSolutionTime_;
  summary << ";";
  if (result.bestLBTime_ < IloInfinity)
    summary << result.bestLBTime_;
  summary << ";";
  summary << result.nbSolutions_ << ";";
  summary /*<< result.nbLNSSteps_*/ << ";"; // Not given by CP Optimizer.
  summary /*<< result.nbRestarts_*/ << ";"; // Not given by CP Optimizer.
  summary << result.nbBranches_ << ";";
  summary << result.nbFails_ << ";";
  summary << result.memoryUsed_ << ";";
  summary << result.nbIntVars_ << ";";
  summary << result.nbIntervalVars_ << ";";
  summary << result.nbConstraints_ << ";";
  summary << '"' << result.solver_ << "\";";
  summary << result.nbWorkers_ << ";";
  summary << result.timeLimit_ << ";";
  summary << "\"";
  for (uint32_t i = 0; i < cpParameters.size(); i++) {
    const CPParameter& param = cpParameters[i];
    summary << "--" << param.param_ << " " << param.value_;
    if (i != cpParameters.size() - 1)
      summary << " ";
  }
  summary << "\";";
  summary << '"' << result.cpu_ << "\";";
  // Print current date in ISO 8601 format:
  summary << std::put_time(std::localtime(&result.solveDate_), "%FT%TZ");
  // Sync for the case of a crash:
  summary << std::endl;
  if (summary.bad())
    throw std::runtime_error(std::string{"Cannot write into summary file '"} + summaryFileName + "'.");
}

void initJSON(const char* filename)
{
  jsonFileName = filename;
  json = std::ofstream(filename);
  json << "[\n";
  // Objective is a double. Make sure we don't lose precision when converting
  // to string:
  json << std::setprecision(std::numeric_limits<double>::digits10 + 1);
  if (!summary.good())
    throw std::runtime_error(std::string{"Cannot write into summary file '"} + summaryFileName + "'.");
}

void finalizeJSON()
{
  json << "\n]" << std::endl;
}

void writeJSON(RunResult result)
{
  if (!jsonFileName)
    return; // --output was not specified.
  // Write comma after the previous record (if any):
  if (jsonNeedsComma)
    json << ",\n";
  else
    jsonNeedsComma = true;
  json << "{";
  json << "\"modelName\":\"" << result.modelName_ << "\",";
  json << "\"solveDate\":\"" << std::put_time(std::localtime(&result.solveDate_), "%FT%TZ") << "\",";
  json << "\"parameters\":{";
  for (uint32_t i = 0; i < cpParameters.size(); i++) {
    const CPParameter& param = cpParameters[i];
    // Make sure that time limit parameter has the right case so it could be matched with OptalCP:
    json << "\"" << (!strcasecmp(param.param_, "timelimit") ? "timeLimit" : param.param_) << "\":\"" << param.value_ << "\"";
    if (i != cpParameters.size() - 1)
      json << ",";
  }
  json << "}";
  if (result.error_ != "")
    json << "\"error\":" << result.error_;
  else {
    json << ",";
    // Write the following properties:
    // ObjectiveHistory objectiveHistory_;
    // LowerBoundHistory lowerBoundHistory_;
    json << "\"randomSeed\":" << result.randomSeed_ << ",";
    json << "\"proof\":" << (result.proof_ ? "true" : "false") << ",";
    if (result.objective_ != IloInfinity)
      json << "\"objective\":" << result.objective_ << ",";
    if (result.lowerBound_ != -IloInfinity)
      json << "\"lowerBound\":" << result.lowerBound_ << ",";
    json << "\"duration\":" << result.duration_ << ",";
    if (result.bestSolutionTime_ != IloInfinity)
      json << "\"bestSolutionTime\":" << result.bestSolutionTime_ << ",";
    if (result.bestLBTime_ != IloInfinity)
      json << "\"bestLBTime\":" << result.bestLBTime_ << ",";
    json << "\"nbSolutions\":" << result.nbSolutions_ << ",";
    json << "\"nbLNSSteps\":" << result.nbLNSSteps_ << ",";
    json << "\"nbRestarts\":" << result.nbRestarts_ << ",";
    json << "\"nbBranches\":" << result.nbBranches_ << ",";
    json << "\"nbFails\":" << result.nbFails_ << ",";
    json << "\"memoryUsed\":" << result.memoryUsed_ << ",";
    json << "\"nbIntVars\":" << result.nbIntVars_ << ",";
    json << "\"nbIntervalVars\":" << result.nbIntervalVars_ << ",";
    json << "\"nbConstraints\":" << result.nbConstraints_ << ",";
    json << "\"nbWorkers\":" << result.nbWorkers_ << ",";
    if (result.timeLimit_ != IloInfinity)
      json << "\"timeLimit\":" << result.timeLimit_ << ",";
    json << "\"solver\":\"" << result.solver_ << "\",";
    json << "\"cpu\":\"" << result.cpu_ << "\",";
    json << "\"objectiveSense\":\"" << result.objectiveSense_ << "\",";
    json << "\"objectiveHistory\":[";
    for (uint32_t i = 0; i < result.objectiveHistory_.size(); i++) {
      const auto& obj = result.objectiveHistory_[i];
      if (i != 0)
        json << ",";
      json << "{\"solveTime\":" << obj.solveTime_ << ",\"objective\":" << obj.objective_ << "}";
    }
    json << "],";
    json << "\"lowerBoundHistory\":[";
    for (uint32_t i = 0; i < result.lowerBoundHistory_.size(); i++) {
      const auto& lb = result.lowerBoundHistory_[i];
      if (i != 0)
        json << ",";
      json << "{\"solveTime\":" << lb.solveTime_ << ",\"value\":" << lb.value_ << "}";
    }
    json << "]";
  }
  json << "}";
  // Sync the stream with the file for the case of a crash:
  json.flush();
}

void usage()
{
  std::cout << "Usage: solveCPOs [parameters] [CP Optimizer parameters] [model1.cpo model2.cpo ...]\n\n"
               "Parameters are:\n"
               "   --output <filename.json> : write results in the specified file.\n"
               "   --summary <filename.csv> : write summary of the runs in the specified file.\n"
               "   --cpu <cpuName> : specify the CPU name to be used in the summary file.\n"
               "   --nbParallelRuns <nbRuns> : specify the number of solves to run in parallel.\n\n"
               "CP Optimizer parameters can be specified the following way:\n"
               "   --paramName paramValue\n"
               "\n"
               "For example:\n"
               "   solveCPO --workers 4 --timeLimit 60 --summary mySummary.csv myModel1.cpo myModel2.cpo\n\n";
}

enum class ThreadStatus {
  Unused,
  Running,
  Finished
};

struct ThreadData {
  std::thread thread_;
  const char* modelFile;
  RunResult result_;
  ThreadStatus status_ = ThreadStatus::Unused;
  int32_t index_ = -1;
};

std::mutex mutex;
std::condition_variable cv;

void solveThread(const char* modelFile, ThreadData& data)
{
  assert(data.status_ = ThreadStatus::Running);
  data.result_ = runModel(modelFile, cpuName, true);
  {
    std::lock_guard<std::mutex> lock(mutex);
    data.status_ = ThreadStatus::Finished;
  }
  cv.notify_one();
}

void startThread(const char* modelFile, int32_t index, ThreadData& data)
{
  assert(data.status_ != ThreadStatus::Running);
  std::cout << index << ": Starting " << modelFile << std::endl;
  data.modelFile = modelFile;
  data.status_ = ThreadStatus::Running;
  data.index_ = index;
  data.thread_ = std::thread(solveThread, modelFile, std::ref(data));
}

void runInParallel()
{
  assert(nbParallelRuns > 1);
  std::vector<ThreadData> threads(nbParallelRuns);
  uint32_t i = 0;
  for (; i < std::min(nbParallelRuns, (uint32_t)inputModels.size()); i++)
    startThread(inputModels[i], i, std::ref(threads[i]));
  for (;;) {
    std::unique_lock<std::mutex> lock(mutex);
    cv.wait(lock, [&threads]() {
      // Check whether it isn't a spurious wake-up:
      for (uint32_t j = 0; j < threads.size(); j++)
        if (threads[j].status_ == ThreadStatus::Finished)
          return true;
      return false;
    });
    uint32_t nbRunning = 0;
    for (uint32_t j = 0; j < nbParallelRuns; j++) {
      if (threads[j].status_ == ThreadStatus::Finished) {
        assert(threads[j].thread_.joinable());
        threads[j].thread_.join();
        writeJSON(threads[j].result_);
        writeSummary(threads[j].result_);
        std::cout << "  " << threads[j].index_ << ": Finished " << threads[j].modelFile << std::endl;
        if (i < inputModels.size()) {
          startThread(inputModels[i], i, std::ref(threads[j]));
          i++;
          nbRunning++;
        }
        else
          threads[j].status_ = ThreadStatus::Unused;
      }
      else
        nbRunning += threads[j].status_ == ThreadStatus::Running;
    }
    if (nbRunning == 0)
      break;
  }
}

int main(int argc, const char** argv)
{
  if (argc == 1) {
    usage();
    return 0;
  }

  try {

    // Parse command line
    int32_t paramNum = 1;
    while (paramNum < argc) {
      if (argv[paramNum][0] == '-' && argv[paramNum][1] == '-') {
        // We have --something parameter
        if (paramNum == argc - 1)
          throw std::runtime_error(std::string{"No value given for parameter '"} + argv[paramNum] + "'.");
        if (!strcmp(argv[paramNum], "--help")) {
          usage();
          return 0;
        }
        if (!strcmp(argv[paramNum], "--cpu"))
          cpuName = argv[paramNum + 1];
        else if (!strcmp(argv[paramNum], "--summary"))
          initSummary(argv[paramNum + 1]);
        else if (!strcmp(argv[paramNum], "--output"))
          initJSON(argv[paramNum + 1]);
        else if (!strcmp(argv[paramNum], "--nbParallelRuns"))
          nbParallelRuns = std::stoi(argv[paramNum + 1]);
        else {
          // We assume that unknown parameters belong to IloCP:
          cpParameters.push_back({argv[paramNum] + 2, argv[paramNum + 1]});
        }
        paramNum += 2;
        continue;
      }

      // Parameters that do not start by -- are assumed to be model files
      inputModels.push_back(argv[paramNum]);
      paramNum++;
    }

    if (inputModels.size() == 0)
      throw std::runtime_error("No model files given.");
    if (cpuName == "Unknown CPU")
      std::cerr << "Warning: CPU name was not specified. You can use OptalCP to get it.\n";

    if (inputModels.size() > 1)
      std::cout << "Number of models: " << inputModels.size() << std::endl;

    // Solve those models:
    if (nbParallelRuns == 1) {
      for (const char *modelFile : inputModels) {
        RunResult result = runModel(modelFile, cpuName);
        writeJSON(result);
        writeSummary(result);
      }
    }
    else
      runInParallel();

    finalizeJSON();
    return 0;
  }
  catch (const std::exception& ex) {
    std::cerr << "Error: " << ex.what() << std::endl;
  }

  finalizeJSON();
  return 1;
}
