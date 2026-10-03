// Standalone control test: no OCCT DLLs, so it also runs on restricted hosts.
#include <atomic>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <thread>
#include "diagnostics/crash_barrier.h"

int main() {
  namespace fs = std::filesystem;
  const auto nonce = std::chrono::steady_clock::now().time_since_epoch().count();
  const fs::path dir = fs::temp_directory_path() / ("kreoda-barrier-" + std::to_string(nonce));
  fs::create_directories(dir);
#ifdef _WIN32
  _putenv_s("KREODA_TEST_BARRIER_DIR", dir.string().c_str());
#else
  setenv("KREODA_TEST_BARRIER_DIR", dir.string().c_str(), 1);
#endif
  std::ofstream(dir / "save-before-publish.arm").put('1');
#if !KREODA_CRASH_TEST_BARRIERS
  const auto started = std::chrono::steady_clock::now();
  kreoda::CrashTestBarrier("save-before-publish", 2000);
  const bool disabled = std::chrono::steady_clock::now() - started < std::chrono::milliseconds(100)
      && fs::exists(dir / "save-before-publish.arm") && !fs::exists(dir / "save-before-publish.ready");
  fs::remove_all(dir);
  if (!disabled) { std::cerr << "production build honored a crash barrier\n"; return 1; }
  std::cout << "production crash barriers disabled\n";
#else
  std::atomic<bool> finished{false};
  std::thread operation([&] { kreoda::CrashTestBarrier("save-before-publish", 2000); finished = true; });
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(1);
  while (!fs::exists(dir / "save-before-publish.ready") && std::chrono::steady_clock::now() < deadline) {
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
  const bool blocked = fs::exists(dir / "save-before-publish.ready") && !finished && !fs::exists(dir / "save-before-publish.arm");
  std::ofstream(dir / "save-before-publish.release").put('1');
  operation.join();
  const auto started = std::chrono::steady_clock::now();
  // The consumed arm cannot pause a restarted core a second time.
  kreoda::CrashTestBarrier("save-before-publish", 2000);
  const bool unarmedReturned = std::chrono::steady_clock::now() - started < std::chrono::milliseconds(100);
  fs::remove_all(dir);
  if (!blocked || !unarmedReturned) {
    std::cerr << "crash barrier failed: operation must pause, signal ready and consume its arm\n";
    return 1;
  }
  std::cout << "crash barrier control passed\n";
#endif
}
