# PlaneGCS (vendored constraint solver)

Source: FreeCAD `src/Mod/Sketcher/App/planegcs/` (sparse checkout),
files `Constraints.*`, `GCS.*`, `Geo.*`, `SubSystem.*`, `Util.h`, `qp_eq.*`.

- Upstream license: **LGPL-2.1-or-later** (see SPDX headers in each file).
- Used strictly behind `ISketchSolver`
  (`native/cad-core/src/constraints/solver.h`) as its own component, so it
  can be replaced (e.g. by Siemens D-Cubed 2D DCM) without touching the app.
- Local addition: `../../SketcherGlobal.h` shim (empty export macro).
- Deps: Eigen3 + header-only Boost (graph, math) via vcpkg.
- No FreeCAD `Base/` / GUI dependencies: the module is self-contained.

Update procedure: re-run the sparse checkout, copy the directory over,
keep this file.
