#include "log.h"
#include <chrono>
#include <cstdio>
void LogCore(const std::string& line) {
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                      std::chrono::system_clock::now().time_since_epoch())
                      .count();
  std::fprintf(stderr, "[kreoda-core %lldms] %s\n", (long long)ms, line.c_str());
}
