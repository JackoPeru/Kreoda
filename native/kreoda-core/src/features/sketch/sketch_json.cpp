#include "model/shapes.h"
#include "sketch_json.h"
#include "sketch_projection.h"
#include "protocol/json_fields.h"

#include <cctype>
#include <iomanip>
#include <sstream>
#include <vector>

namespace kreoda {

bool ExtractJsonValue(const std::string& text, const std::string& key, std::string* raw) {
  return json_value_field(parse_json_object(text), key.c_str(), raw);
}

bool ConstraintKindFromString(const std::string& s,
                              SketchConstraintKind* out) {
  if (s == "coincident") *out = SketchConstraintKind::Coincident;
  else if (s == "horizontal") *out = SketchConstraintKind::Horizontal;
  else if (s == "vertical") *out = SketchConstraintKind::Vertical;
  else if (s == "parallel") *out = SketchConstraintKind::Parallel;
  else if (s == "perpendicular") *out = SketchConstraintKind::Perpendicular;
  else if (s == "equalRadius") *out = SketchConstraintKind::EqualRadius;
  else if (s == "concentric") *out = SketchConstraintKind::Concentric;
  else if (s == "distance") *out = SketchConstraintKind::Distance;
  else if (s == "radius") *out = SketchConstraintKind::Radius;
  else if (s == "diameter") *out = SketchConstraintKind::Diameter;
  else if (s == "angle") *out = SketchConstraintKind::Angle;
  else if (s == "pointOnLine") *out = SketchConstraintKind::PointOnLine;
  else if (s == "fixed") *out = SketchConstraintKind::Fixed;
  else return false;
  return true;
}

std::string ConstraintKindToString(SketchConstraintKind kind) {
  switch (kind) {
    case SketchConstraintKind::Coincident: return "coincident";
    case SketchConstraintKind::Horizontal: return "horizontal";
    case SketchConstraintKind::Vertical: return "vertical";
    case SketchConstraintKind::Parallel: return "parallel";
    case SketchConstraintKind::Perpendicular: return "perpendicular";
    case SketchConstraintKind::EqualRadius: return "equalRadius";
    case SketchConstraintKind::Concentric: return "concentric";
    case SketchConstraintKind::Distance: return "distance";
    case SketchConstraintKind::Radius: return "radius";
    case SketchConstraintKind::Diameter: return "diameter";
    case SketchConstraintKind::Angle: return "angle";
    case SketchConstraintKind::PointOnLine: return "pointOnLine";
    case SketchConstraintKind::Fixed: return "fixed";
  }
  return "fixed";
}

namespace {
const Json& ArrayItems(const Json& value, const char* key) {
  static const Json empty = Json::array();
  if (!value.contains(key)) return empty;
  if (!value.at(key).is_array()) throw JsonFieldError(std::string(key) + " must be a JSON array");
  return value.at(key);
}
std::string RequiredString(const Json& value, const char* key) {
  if (!value.is_object() || !value.contains(key)) throw JsonFieldError(std::string("missing ") + key);
  const auto text = json_string_field(value, key);
  if (text.empty()) throw JsonFieldError(std::string(key) + " must be non-empty");
  return text;
}
double RequiredNumber(const Json& value, const char* key) {
  if (!value.is_object() || !value.contains(key)) throw JsonFieldError(std::string("missing ") + key);
  return json_double_field(value, key);
}
void ParseVector3(const Json& value, const char* key, double out[3]) {
  const auto values = json_number_array(value, key);
  if (values.size() != 3) {
    throw JsonFieldError(std::string(key) + " must contain exactly 3 finite JSON numbers");
  }
  for (int i = 0; i < 3; ++i) out[i] = values[i];
}
SketchPlane ParseSketchPlane(const Json& value) {
  if (!value.is_object()) throw JsonFieldError("plane must be a JSON object");
  SketchPlane plane;
  ParseVector3(value, "origin", plane.origin);
  ParseVector3(value, "xAxis", plane.xAxis);
  ParseVector3(value, "yAxis", plane.yAxis);
  ParseVector3(value, "normal", plane.normal);
  std::string error;
  if (!ValidateSketchPlane(plane, &error)) {
    throw JsonFieldError("invalid sketch plane: " + error);
  }
  return plane;
}
}  // namespace

bool ParseSketchModel(const std::string& text, SketchModel* out, std::string* error) {
  const Json value = parse_json_object(text);
  if (!value.is_object()) { if (error) *error = "sketch model must be a JSON object"; return false; }
  try {
    SketchModel model;
    for (const auto& row : ArrayItems(value, "points")) {
      SketchPoint point;
      point.id = RequiredString(row, "id"); point.x = RequiredNumber(row, "x"); point.y = RequiredNumber(row, "y");
      point.fixed = json_bool_field(row, "fixed", false);
      model.points.push_back(std::move(point));
    }
    for (const auto& row : ArrayItems(value, "lines")) {
      SketchLine line;
      line.id = RequiredString(row, "id"); line.p1 = RequiredString(row, "p1"); line.p2 = RequiredString(row, "p2");
      model.lines.push_back(std::move(line));
    }
    for (const auto& row : ArrayItems(value, "circles")) {
      SketchCircle circle;
      circle.id = RequiredString(row, "id"); circle.center = RequiredString(row, "center"); circle.r = RequiredNumber(row, "r");
      model.circles.push_back(std::move(circle));
    }
    for (const auto& row : ArrayItems(value, "arcs")) {
      SketchArc arc;
      arc.id = RequiredString(row, "id"); arc.center = RequiredString(row, "center"); arc.r = RequiredNumber(row, "r");
      arc.startAngleRad = json_double_field(row, "startAngleRad", arc.startAngleRad);
      arc.endAngleRad = json_double_field(row, "endAngleRad", arc.endAngleRad);
      model.arcs.push_back(std::move(arc));
    }
    for (const auto& row : ArrayItems(value, "constraints")) {
      SketchConstraint constraint;
      constraint.id = RequiredString(row, "id");
      const auto kind = RequiredString(row, "kind");
      if (!ConstraintKindFromString(kind, &constraint.kind)) throw JsonFieldError("unknown constraint kind " + kind);
      constraint.refs = json_string_array(row, "refs");
      constraint.value = json_double_field(row, "value", 0);
      model.constraints.push_back(std::move(constraint));
    }
    *out = std::move(model); return true;
  } catch (const JsonFieldError& failure) { if (error) *error = failure.what(); return false; }
    catch (const Json::exception& failure) { if (error) *error = failure.what(); return false; }
}

namespace {

std::string Esc(const std::string& value) {
  const auto quoted = Json(value).dump();
  return quoted.substr(1, quoted.size() - 2);
}

}  // namespace

std::string SerializeSketchModel(const SketchModel& model) {
  std::ostringstream os;
  os << std::setprecision(17);
  os << "{\"points\":[";
  for (size_t i = 0; i < model.points.size(); ++i) {
    const auto& p = model.points[i];
    if (i) os << ",";
    os << "{\"id\":\"" << Esc(p.id) << "\",\"x\":" << p.x << ",\"y\":" << p.y
       << ",\"fixed\":" << (p.fixed ? "true" : "false") << "}";
  }
  os << "],\"lines\":[";
  for (size_t i = 0; i < model.lines.size(); ++i) {
    const auto& l = model.lines[i];
    if (i) os << ",";
    os << "{\"id\":\"" << Esc(l.id) << "\",\"p1\":\"" << Esc(l.p1)
       << "\",\"p2\":\"" << Esc(l.p2) << "\"}";
  }
  os << "],\"circles\":[";
  for (size_t i = 0; i < model.circles.size(); ++i) {
    const auto& c = model.circles[i];
    if (i) os << ",";
    os << "{\"id\":\"" << Esc(c.id) << "\",\"center\":\"" << Esc(c.center)
       << "\",\"r\":" << c.r << "}";
  }
  os << "],\"arcs\":[";
  for (size_t i = 0; i < model.arcs.size(); ++i) {
    const auto& a = model.arcs[i];
    if (i) os << ",";
    os << "{\"id\":\"" << Esc(a.id) << "\",\"center\":\"" << Esc(a.center)
       << "\",\"r\":" << a.r << ",\"startAngleRad\":" << a.startAngleRad
       << ",\"endAngleRad\":" << a.endAngleRad << "}";
  }
  os << "],\"constraints\":[";
  for (size_t i = 0; i < model.constraints.size(); ++i) {
    const auto& c = model.constraints[i];
    if (i) os << ",";
    os << "{\"id\":\"" << Esc(c.id) << "\",\"kind\":\""
       << ConstraintKindToString(c.kind) << "\",\"refs\":[";
    for (size_t k = 0; k < c.refs.size(); ++k) {
      if (k) os << ",";
      os << "\"" << Esc(c.refs[k]) << "\"";
    }
    os << "],\"value\":" << c.value << "}";
  }
  os << "]}";
  return os.str();
}

namespace {
std::string SerializeSketchFeatureImpl(const SketchFeature& sketch,
                                       bool inspection) {
  std::ostringstream os;
  os << std::setprecision(17);
  os << "{\"id\":\"" << Esc(sketch.id) << "\",\"planeKind\":\""
     << Esc(sketch.planeKind) << "\",\"plane\":{\"origin\":["
     << sketch.plane.origin[0] << "," << sketch.plane.origin[1] << ","
     << sketch.plane.origin[2] << "],\"xAxis\":[" << sketch.plane.xAxis[0]
     << "," << sketch.plane.xAxis[1] << "," << sketch.plane.xAxis[2]
     << "],\"yAxis\":[" << sketch.plane.yAxis[0] << ","
     << sketch.plane.yAxis[1] << "," << sketch.plane.yAxis[2]
     << "],\"normal\":[" << sketch.plane.normal[0] << ","
     << sketch.plane.normal[1] << "," << sketch.plane.normal[2] << "]}"
     << ",\"supportRef\":\"" << Esc(sketch.supportRef) << "\",\"model\":"
      << SerializeSketchModel(sketch.model);
  if (!sketch.projectionGroups.empty())
    os << ",\"projectionGroups\":"
       << (inspection
               ? SerializeSketchProjectionGroupsForInspection(sketch.projectionGroups)
               : SerializeSketchProjectionGroups(sketch.projectionGroups));
  os << "}";
  return os.str();
}
}  // namespace

std::string SerializeSketchFeature(const SketchFeature& sketch) {
  return SerializeSketchFeatureImpl(sketch, false);
}

std::string SerializeSketchFeatureForInspection(const SketchFeature& sketch) {
  return SerializeSketchFeatureImpl(sketch, true);
}

bool ParseSketchFeature(const std::string& text, SketchFeature* out, std::string* error) {
  const Json value = parse_json_object(text);
  if (!value.is_object()) { if (error) *error = "sketch feature must be a JSON object"; return false; }
  try {
    SketchFeature sketch;
    sketch.id = json_string_field(value, "id", json_string_field(value, "featureId", ""));
    if (sketch.id.empty()) throw JsonFieldError("sketch id/featureId required");
    sketch.planeKind = json_string_field(value, "planeKind", "XY");
    if (sketch.planeKind != "XY" && sketch.planeKind != "XZ" && sketch.planeKind != "YZ" && sketch.planeKind != "Datum") throw JsonFieldError("planeKind must be XY|XZ|YZ|Datum");
    sketch.plane = value.contains("plane")
        ? ParseSketchPlane(value.at("plane"))
        : PrincipalPlane(sketch.planeKind);
    sketch.supportRef = json_string_field(value, "supportRef", "");
    if(sketch.planeKind=="Datum"&&(!value.contains("plane")||!ShapeStore::ValidFeatureId(sketch.supportRef))) throw JsonFieldError("Datum sketch requires a frame and valid supportRef");
    if (value.contains("projectionGroups") &&
        !ParseSketchProjectionGroups(value.at("projectionGroups").dump(),
                                     &sketch.projectionGroups, error))
      return false;
    const auto model = value.contains("model") ? value.at("model").dump() : value.dump();
    if (!ParseSketchModel(model, &sketch.model, error)) return false;
    *out = std::move(sketch); return true;
  } catch (const JsonFieldError& failure) { if (error) *error = failure.what(); return false; }
    catch (const Json::exception& failure) { if (error) *error = failure.what(); return false; }
}

}  // namespace kreoda
