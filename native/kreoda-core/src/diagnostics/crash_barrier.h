#pragma once
#if defined(KREODA_CRASH_TEST_BARRIERS) && KREODA_CRASH_TEST_BARRIERS
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>
#include <thread>
#endif
namespace kreoda {
// Opt-in test builds only. Consume the arm before announcing readiness so
// the restarted core cannot pause again after a test kills its predecessor.
inline void CrashTestBarrier(const char* stage, unsigned timeoutMs = 30000) {
#if defined(KREODA_CRASH_TEST_BARRIERS) && KREODA_CRASH_TEST_BARRIERS
  const char* root = std::getenv("KREODA_TEST_BARRIER_DIR");
  if (!root || !*root) return;
  namespace fs = std::filesystem;
  const fs::path prefix = fs::path(root) / stage;
  std::error_code ec;
  if (!fs::remove(prefix.string() + ".arm", ec)) return;
  std::ofstream ready(prefix.string() + ".ready");
  ready << stage;
  ready.close();
  if (!ready) return;
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
  while (std::chrono::steady_clock::now() < deadline && !fs::exists(prefix.string() + ".release", ec)) {
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
#else
  (void)stage;
  (void)timeoutMs;
#endif
}
}
