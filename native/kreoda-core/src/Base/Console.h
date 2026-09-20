#pragma once

// Minimal standalone shim for FreeCAD's Base/Console.h.
// Upstream Console().log is printf-style variadic; we forward to stderr.
// Logs go to stderr (stdout is the IPC channel, §50).

#include <cstdarg>
#include <cstdio>

namespace Base {

class ConsoleSingleton {
 public:
  void log(const char* fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    std::fprintf(stderr, "[planegcs] ");
    std::vfprintf(stderr, fmt ? fmt : "", ap);
    std::fprintf(stderr, "\n");
    va_end(ap);
  }
  void warning(const char* fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    std::fprintf(stderr, "[planegcs warn] ");
    std::vfprintf(stderr, fmt ? fmt : "", ap);
    std::fprintf(stderr, "\n");
    va_end(ap);
  }
  void error(const char* fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    std::fprintf(stderr, "[planegcs err] ");
    std::vfprintf(stderr, fmt ? fmt : "", ap);
    std::fprintf(stderr, "\n");
    va_end(ap);
  }
};

inline ConsoleSingleton& Console() {
  static ConsoleSingleton instance;
  return instance;
}

}  // namespace Base
