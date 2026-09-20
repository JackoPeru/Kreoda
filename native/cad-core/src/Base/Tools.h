#pragma once

// Minimal standalone shim for FreeCAD's Base/Tools.h (LGPL, same as PlaneGCS).
// Provides only what planegcs/GCS.cpp uses: Base::unreachable().
// Console lives in Base/Console.h (single definition).

#include <stdexcept>

#include "Base/Console.h"

namespace Base {

[[noreturn]] inline void unreachable() {
  throw std::logic_error("unreachable");
}

}  // namespace Base
