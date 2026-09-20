#pragma once

// Local standalone shim for FreeCAD's SketcherGlobal.h export macro.
// (Duplicate at src/ level because vendored planegcs includes it as
// "../../SketcherGlobal.h" relative to src/constraints/planegcs/.)
#ifndef SketcherExport
#define SketcherExport
#endif
