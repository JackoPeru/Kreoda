#pragma once

// Centralized geometric tolerances (§42). No scattered 1e-6 / 0.0001.
// Model-space vs kernel vs UI-snapping vs screen-picking stay separate.

namespace kreoda {

struct GeometryTolerancePolicy {
  double linearModelToleranceMm = 1e-4;   // model-space coincidence
  double angularToleranceRad = 1e-6;      // kernel angular checks
  double coincidenceToleranceMm = 1e-3;   // semantic fallback matching
  double selectionTolerancePx = 6.0;      // screen-space picking only
  double tessellationDeflectionMm = 0.05; // interactive LOD default
};

inline const GeometryTolerancePolicy& tolerances() {
  static const GeometryTolerancePolicy kPolicy{};
  return kPolicy;
}

}  // namespace kreoda
