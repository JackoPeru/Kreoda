#include "sketch_face.h"

#if INTENTCAD_WITH_OCCT
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <Geom_Circle.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Standard_Failure.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#endif

#include <cmath>

namespace intentcad {

void SketchToModel(const SketchPlane& plane, double x, double y,
                   double out3[3]) {
  out3[0] = plane.origin[0] + x * plane.xAxis[0] + y * plane.yAxis[0];
  out3[1] = plane.origin[1] + x * plane.xAxis[1] + y * plane.yAxis[1];
  out3[2] = plane.origin[2] + x * plane.xAxis[2] + y * plane.yAxis[2];
}

#if INTENTCAD_WITH_OCCT
namespace {

gp_Pnt ToPnt(const SketchPlane& plane, double x, double y) {
  double p[3];
  SketchToModel(plane, x, y, p);
  return gp_Pnt(p[0], p[1], p[2]);
}

const SketchPoint* FindPoint(const SketchModel& m, const std::string& id) {
  for (const auto& p : m.points) {
    if (p.id == id) return &p;
  }
  return nullptr;
}

struct Edge2D {
  TopoDS_Edge edge;
  double x1, y1, x2, y2;  // sketch-space endpoints (for chaining)
};

bool EdgesFromSketch(const SketchFeature& sketch,
                     std::vector<Edge2D>* edges, std::string* error) {
  const auto& m = sketch.model;
  const auto& plane = sketch.plane;
  for (const auto& l : m.lines) {
    const SketchPoint* a = FindPoint(m, l.p1);
    const SketchPoint* b = FindPoint(m, l.p2);
    if (!a || !b) {
      if (error) *error = "line references unknown point";
      return false;
    }
    if (std::hypot(a->x - b->x, a->y - b->y) < 1e-9) continue;  // degenerate
    try {
      BRepBuilderAPI_MakeEdge mk(ToPnt(plane, a->x, a->y),
                                 ToPnt(plane, b->x, b->y));
      if (!mk.IsDone()) {
        if (error) *error = "cannot build line edge";
        return false;
      }
      edges->push_back({mk.Edge(), a->x, a->y, b->x, b->y});
    } catch (const Standard_Failure& f) {
      if (error) *error = std::string("line edge: ") + f.what();
      return false;
    }
  }
  gp_Dir normal(plane.normal[0], plane.normal[1], plane.normal[2]);
  for (const auto& c : m.circles) {
    const SketchPoint* o = FindPoint(m, c.center);
    if (!o) {
      if (error) *error = "circle references unknown point";
      return false;
    }
    if (!(c.r > 1e-9)) {
      if (error) *error = "circle radius must be positive";
      return false;
    }
    try {
      const gp_Pnt center = ToPnt(plane, o->x, o->y);
      const gp_Circ circ(gp_Ax2(center, normal), c.r);
      BRepBuilderAPI_MakeEdge mk(circ);
      if (!mk.IsDone()) {
        if (error) *error = "cannot build circle edge";
        return false;
      }
      edges->push_back(
          {mk.Edge(), o->x, o->y, o->x, o->y});  // closed: same endpoints
    } catch (const Standard_Failure& f) {
      if (error) *error = std::string("circle edge: ") + f.what();
      return false;
    }
  }
  for (const auto& a : m.arcs) {
    const SketchPoint* o = FindPoint(m, a.center);
    if (!o) {
      if (error) *error = "arc references unknown point";
      return false;
    }
    if (!(a.r > 1e-9)) {
      if (error) *error = "arc radius must be positive";
      return false;
    }
    try {
      const gp_Pnt center = ToPnt(plane, o->x, o->y);
      const gp_Circ circ(gp_Ax2(center, normal), a.r);
      GC_MakeArcOfCircle mk(circ, a.startAngleRad, a.endAngleRad, false);
      if (!mk.IsDone()) {
        if (error) *error = "cannot build arc edge";
        return false;
      }
      const Handle(Geom_TrimmedCurve)& tc = mk.Value();
      const gp_Pnt p1 = tc->StartPoint();
      const gp_Pnt p2 = tc->EndPoint();
      BRepBuilderAPI_MakeEdge me(tc);
      if (!me.IsDone()) {
        if (error) *error = "cannot build arc edge";
        return false;
      }
      // Sketch-space endpoints for chaining (invert the plane map).
      const double x1 = (p1.X() - plane.origin[0]) * plane.xAxis[0] +
                        (p1.Y() - plane.origin[1]) * plane.xAxis[1] +
                        (p1.Z() - plane.origin[2]) * plane.xAxis[2];
      const double y1 = (p1.X() - plane.origin[0]) * plane.yAxis[0] +
                        (p1.Y() - plane.origin[1]) * plane.yAxis[1] +
                        (p1.Z() - plane.origin[2]) * plane.yAxis[2];
      const double x2 = (p2.X() - plane.origin[0]) * plane.xAxis[0] +
                        (p2.Y() - plane.origin[1]) * plane.xAxis[1] +
                        (p2.Z() - plane.origin[2]) * plane.xAxis[2];
      const double y2 = (p2.X() - plane.origin[0]) * plane.yAxis[0] +
                        (p2.Y() - plane.origin[1]) * plane.yAxis[1] +
                        (p2.Z() - plane.origin[2]) * plane.yAxis[2];
      edges->push_back({me.Edge(), x1, y1, x2, y2});
    } catch (const Standard_Failure& f) {
      if (error) *error = std::string("arc edge: ") + f.what();
      return false;
    }
  }
  return true;
}

}  // namespace

bool BuildFaceFromSketch(const SketchFeature& sketch, TopoDS_Face* out,
                         std::string* error) {
  std::vector<Edge2D> edges;
  if (!EdgesFromSketch(sketch, &edges, error)) return false;
  if (edges.empty()) {
    if (error) *error = "sketch has no entities";
    return false;
  }
  // Keep sketch-space polygons alongside edges for area sorting.
  std::vector<Edge2D> work = edges;
  std::vector<std::vector<TopoDS_Edge>> loops;
  std::vector<std::vector<std::pair<double, double>>> loopPts;
  // Chain with point tracking.
  constexpr double kTol = 1e-6;
  struct ChainLink {
    TopoDS_Edge edge;
    double x1, y1, x2, y2;
  };
  std::vector<ChainLink> remaining;
  for (const auto& e : work) {
    remaining.push_back({e.edge, e.x1, e.y1, e.x2, e.y2});
  }
  while (!remaining.empty()) {
    std::vector<ChainLink> chain;
    chain.push_back(remaining.back());
    remaining.pop_back();
    bool closed = false;
    if (std::hypot(chain.front().x2 - chain.front().x1,
                   chain.front().y2 - chain.front().y1) < kTol) {
      closed = true;  // single closed edge (circle)
    }
    for (int guard = 0; guard < 10000 && !closed; ++guard) {
      const ChainLink& head = chain.back();
      double best = kTol;
      size_t bestIdx = remaining.size();
      bool bestFlip = false;
      for (size_t i = 0; i < remaining.size(); ++i) {
        const double d0 = std::hypot(head.x2 - remaining[i].x1,
                                     head.y2 - remaining[i].y1);
        const double d1 = std::hypot(head.x2 - remaining[i].x2,
                                     head.y2 - remaining[i].y2);
        if (d0 < best) {
          best = d0;
          bestIdx = i;
          bestFlip = false;
        }
        if (d1 < best) {
          best = d1;
          bestIdx = i;
          bestFlip = true;
        }
      }
      if (bestIdx >= remaining.size()) break;
      ChainLink next = remaining[bestIdx];
      remaining.erase(remaining.begin() + bestIdx);
      if (bestFlip) {
        next.edge.Reverse();
        std::swap(next.x1, next.x2);
        std::swap(next.y1, next.y2);
      }
      chain.push_back(next);
      if (std::hypot(next.x2 - chain.front().x1,
                     next.y2 - chain.front().y1) < kTol) {
        closed = true;
      }
    }
    if (!closed) {
      if (error) *error = "open profile: all loops must be closed";
      return false;
    }
    std::vector<TopoDS_Edge> wire;
    std::vector<std::pair<double, double>> pts;
    for (const auto& l : chain) {
      wire.push_back(l.edge);
      pts.emplace_back(l.x1, l.y1);
    }
    loops.push_back(std::move(wire));
    loopPts.push_back(std::move(pts));
  }
  // Outer loop = largest |shoelace area|; the rest are holes.
  size_t outer = 0;
  double bestArea = -1.0;
  for (size_t i = 0; i < loopPts.size(); ++i) {
    double area = 0.0;
    const auto& pts = loopPts[i];
    for (size_t k = 0; k < pts.size(); ++k) {
      const auto& a = pts[k];
      const auto& b = pts[(k + 1) % pts.size()];
      area += a.first * b.second - b.first * a.second;
    }
    area = std::fabs(area) / 2.0;
    if (area > bestArea) {
      bestArea = area;
      outer = i;
    }
  }
  if (bestArea < 1e-12) {
    if (error) *error = "degenerate profile (zero area)";
    return false;
  }
  try {
    BRepBuilderAPI_MakeWire outerWire;
    for (const auto& e : loops[outer]) outerWire.Add(e);
    if (!outerWire.IsDone()) {
      if (error) *error = "cannot build outer wire";
      return false;
    }
    BRepBuilderAPI_MakeFace mkFace(outerWire.Wire());
    for (size_t i = 0; i < loops.size(); ++i) {
      if (i == outer) continue;
      BRepBuilderAPI_MakeWire hole;
      for (const auto& e : loops[i]) hole.Add(e);
      if (!hole.IsDone()) {
        if (error) *error = "cannot build hole wire";
        return false;
      }
      mkFace.Add(hole.Wire());
    }
    mkFace.Build();
    if (!mkFace.IsDone()) {
      if (error) *error = "cannot build sketch face";
      return false;
    }
    const TopoDS_Face face = mkFace.Face();
    if (!BRepCheck_Analyzer(face).IsValid(face)) {
      if (error) *error = "sketch face failed validation";
      return false;
    }
    *out = face;
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("sketch face: ") + f.what();
    return false;
  }
}

#endif

}  // namespace intentcad
