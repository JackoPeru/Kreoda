// Real PlaneGCS control, linked without OCCT so restricted hosts can run it.
#include "constraints/solver.h"
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <thread>

int main() {
  namespace fs = std::filesystem;
  using namespace kreoda;
  const auto nonce = std::chrono::steady_clock::now().time_since_epoch().count();
  const fs::path dir = fs::temp_directory_path() / ("kreoda-solver-barrier-" + std::to_string(nonce));
  fs::create_directories(dir);
#ifdef _WIN32
  _putenv_s("KREODA_TEST_BARRIER_DIR", dir.string().c_str());
#else
  setenv("KREODA_TEST_BARRIER_DIR", dir.string().c_str(), 1);
#endif
  const fs::path stage = dir / "sketch-solve-after-jacobian";
  std::ofstream(stage.string() + ".arm").put('1');
  SketchModel model;
  model.points = {{"origin", 0, 0, true}, {"end", 7, 0}};
  model.constraints = {{"length", SketchConstraintKind::Distance, {"origin", "end"}, 25}};
  std::atomic<bool> finished{false};
  SolveResult result;
  std::thread operation([&] {
    result = CreateSketchSolver()->solve(model, {});
    finished = true;
  });
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
  while (!finished && !fs::exists(stage.string() + ".ready") && std::chrono::steady_clock::now() < deadline) {
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
#if KREODA_CRASH_TEST_BARRIERS
  const bool control = !finished && fs::exists(stage.string() + ".ready")
      && !fs::exists(stage.string() + ".arm");
#else
  const bool control = fs::exists(stage.string() + ".arm")
      && !fs::exists(stage.string() + ".ready");
#endif
  // Always release/join even on failure; never leave a worker parked.
  std::ofstream(stage.string() + ".release").put('1');
  operation.join();
  const bool solved = result.ok && result.points.count("end")
      && std::fabs(std::hypot(result.points.at("end").first, result.points.at("end").second) - 25) < 1e-3;
  fs::remove_all(dir);
  if (!control || !solved) {
    std::cerr << "solver barrier control failed: control=" << control << " solved=" << solved << ' ' << result.error << '\n';
    return 1;
  }
  std::cout << "solver barrier control passed (enabled=" << KREODA_CRASH_TEST_BARRIERS << ")\n";
}
