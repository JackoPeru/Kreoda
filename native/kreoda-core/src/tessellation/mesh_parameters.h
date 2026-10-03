#pragma once

#if KREODA_WITH_OCCT
#include <IMeshTools_Parameters.hxx>

namespace kreoda {
inline IMeshTools_Parameters OcctMeshingParameters(double deflection, double angle) {
  IMeshTools_Parameters parameters;
  parameters.Deflection = deflection;
  parameters.Angle = angle;
  parameters.InParallel = true;
  // OCCT 8.0.1 Watson peaked at 10 GB for 1.1M triangles; Delabella used
  // 450 MB with the same deflection. Pin both viewport and export meshing.
  parameters.MeshAlgo = IMeshTools_MeshAlgoType_Delabella;
  return parameters;
}
}  // namespace kreoda
#endif
