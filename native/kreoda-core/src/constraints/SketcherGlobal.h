#pragma once

// Local standalone shim for FreeCAD's SketcherGlobal.h export macro.
// PlaneGCS is vendored under LGPL-2.1-or-later (see planegcs/README.md) and
// built as an isolated component behind ISketchSolver — no DLL export
// decoration is needed here.
#ifndef SketcherExport
#define SketcherExport
#endif
