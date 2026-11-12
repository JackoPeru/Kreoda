#pragma once

#include <cmath>
#include <string>

#include "../model/shapes.h"
#include "../model/geometry_kind.h"

#if KREODA_WITH_OCCT
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopoDS_Shape.hxx>
#endif

namespace kreoda {

// Read-only geometric measurements. Density is supplied in kg/mm^3;
// callers may use 0 for geometric properties without material assignment.
struct MassProperties {
  double volumeMm3 = 0;
  double surfaceAreaMm2 = 0;
  double massKg = 0;
  double centroidMm[3] = {0, 0, 0};
};

inline bool MeasureMassProperties(const ShapeRecord& record, double densityKgPerMm3,
                                  MassProperties* result, std::string* error = nullptr) {
  if (!result || !std::isfinite(densityKgPerMm3) || densityKgPerMm3 < 0) {
    if (error) *error = "Invalid output or material density";
    return false;
  }
#if KREODA_WITH_OCCT
  if (record.shape.IsNull()) {
    if (error) *error = "Feature has no B-Rep geometry";
    return false;
  }
  if (!HasSolidTopology(record.shape)) {
    if (error) *error = HasSurfaceTopology(record.shape)
        ? "Surface geometry has no enclosed volume or mass"
        : "Feature has no measurable solid volume or mass";
    return false;
  }
  if (HasMixedSolidSurfaceTopology(record.shape)) {
    if (error) *error = "Selected geometry mixes solid and free surface faces";
    return false;
  }
  GProp_GProps volume, surface;
  BRepGProp::VolumeProperties(record.shape, volume);
  BRepGProp::SurfaceProperties(record.shape, surface);
  const double v = volume.Mass(), a = surface.Mass();
  const gp_Pnt center = volume.CentreOfMass();
  if (!std::isfinite(v) || !std::isfinite(a) || v <= 0 || a <= 0 ||
      !std::isfinite(center.X()) || !std::isfinite(center.Y()) || !std::isfinite(center.Z())) {
    if (error) *error = "Feature is not a measurable closed solid";
    return false;
  }
  MassProperties measured;
  measured.volumeMm3 = v;
  measured.surfaceAreaMm2 = a;
  measured.massKg = v * densityKgPerMm3;
  measured.centroidMm[0] = center.X();
  measured.centroidMm[1] = center.Y();
  measured.centroidMm[2] = center.Z();
  if (!std::isfinite(measured.massKg)) {
    if (error) *error = "Calculated mass exceeds numeric range";
    return false;
  }
  *result = measured;
  return true;
#else
  if (error) *error = "Mass analysis requires OCCT";
  return false;
#endif
}

}  // namespace kreoda
