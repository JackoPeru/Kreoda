#include "sketch_face.h"

#if KREODA_WITH_OCCT
#include <BRepAdaptor_Curve.hxx>
#include <BRepAlgoAPI_Section.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepClass_FaceClassifier.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRep_Tool.hxx>
#include <BRep_Builder.hxx>
#include <Bnd_Box.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_Circle.hxx>
#include <Geom_Curve.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <GProp_GProps.hxx>
#include <Precision.hxx>
#include <ShapeFix_Face.hxx>
#include <Standard_Failure.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopAbs_State.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#endif

#include <algorithm>
#include <cmath>
#include <exception>
#include <utility>
#include <vector>

namespace kreoda {

void SketchToModel(const SketchPlane& plane, double x, double y,
                   double out3[3]) {
  out3[0] = plane.origin[0] + x * plane.xAxis[0] + y * plane.yAxis[0];
  out3[1] = plane.origin[1] + x * plane.xAxis[1] + y * plane.yAxis[1];
  out3[2] = plane.origin[2] + x * plane.xAxis[2] + y * plane.yAxis[2];
}

#if KREODA_WITH_OCCT
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

constexpr double kProfileTolerance = 1e-6;

struct ProfileEdge {
  TopoDS_Edge edge;
  gp_Pnt start;
  gp_Pnt end;
  double startTolerance = kProfileTolerance;
  double endTolerance = kProfileTolerance;
  size_t startNode = 0;
  size_t endNode = 0;
  size_t loop = 0;
};

struct ProfileLoop {
  TopoDS_Wire wire;
  TopoDS_Face face;
  gp_Pnt sample;
  double area = 0;
  int parent = -1;
  int depth = 0;
};

bool ProfileFail(std::string* error, const std::string& message) {
  if (error) *error = message;
  return false;
}

bool ValidateProfileEdge(const TopoDS_Edge& edge, const SketchPlane& plane,
                         std::string* error) {
  if (edge.IsNull() || BRep_Tool::Degenerated(edge)) {
    return ProfileFail(error, "profile contains a null or degenerate edge");
  }
  if (!BRepCheck_Analyzer(edge).IsValid()) {
    return ProfileFail(error, "profile edge failed topology validation");
  }
  BRepAdaptor_Curve curve(edge);
  const double first = curve.FirstParameter();
  const double last = curve.LastParameter();
  if (!std::isfinite(first) || !std::isfinite(last) ||
      Precision::IsInfinite(first) || Precision::IsInfinite(last) ||
      !(last > first)) {
    return ProfileFail(error, "profile edge interval must be finite and nonempty");
  }
  const gp_Pnt origin(plane.origin[0], plane.origin[1], plane.origin[2]);
  const gp_Vec normal(plane.normal[0], plane.normal[1], plane.normal[2]);
  const double planeTolerance =
      std::max(kProfileTolerance, BRep_Tool::Tolerance(edge));
  if (!std::isfinite(planeTolerance)) {
    return ProfileFail(error, "profile edge tolerance is nonfinite");
  }
  for (int i = 0; i <= 16; ++i) {
    const gp_Pnt point = curve.Value(first + (last - first) * i / 16.0);
    if (!std::isfinite(point.X()) || !std::isfinite(point.Y()) ||
        !std::isfinite(point.Z())) {
      return ProfileFail(error, "profile edge contains nonfinite points");
    }
    const double distance = gp_Vec(origin, point).Dot(normal);
    if (!std::isfinite(distance) || std::fabs(distance) > planeTolerance) {
      return ProfileFail(error, "profile edge is outside target plane tolerance");
    }
  }

  TopLoc_Location location;
  double curveFirst = 0;
  double curveLast = 0;
  const Handle(Geom_Curve) geometry =
      BRep_Tool::Curve(edge, location, curveFirst, curveLast);
  const Handle(Geom_BSplineCurve) spline =
      Handle(Geom_BSplineCurve)::DownCast(geometry);
  if (!spline.IsNull()) {
    for (int i = 1; i <= spline->NbPoles(); ++i) {
      gp_Pnt pole = spline->Pole(i);
      if (!location.IsIdentity()) pole.Transform(location.Transformation());
      const double poleDistance = gp_Vec(origin, pole).Dot(normal);
      if (!std::isfinite(pole.X()) || !std::isfinite(pole.Y()) ||
          !std::isfinite(pole.Z()) || !std::isfinite(poleDistance) ||
          std::fabs(poleDistance) > planeTolerance) {
        return ProfileFail(error, "profile spline control point is outside target plane");
      }
    }
  }

  GProp_GProps lengthProperties;
  BRepGProp::LinearProperties(edge, lengthProperties);
  const double length = std::fabs(lengthProperties.Mass());
  if (!std::isfinite(length) || !(length > 0)) {
    return ProfileFail(error, "profile edge has zero or nonfinite length");
  }
  return true;
}

bool MakeLoopFace(const TopoDS_Wire& wire, const gp_Pln& plane,
                  TopoDS_Face* output, std::string* error) {
  BRepBuilderAPI_MakeFace make(plane, wire, true);
  make.Build();
  if (!make.IsDone()) {
    return ProfileFail(error, "cannot build planar profile loop face");
  }
  ShapeFix_Face orientation(make.Face());
  orientation.FixOrientation();
  const TopoDS_Face face = orientation.Face();
  if (!BRepCheck_Analyzer(face).IsValid(face)) {
    return ProfileFail(error, "profile loop failed face validation");
  }
  *output = face;
  return true;
}

TopoDS_Vertex VertexAt(const TopoDS_Edge& edge, bool atStart) {
  TopoDS_Vertex first;
  TopoDS_Vertex last;
  TopExp::Vertices(edge, first, last, true);
  return atStart ? first : last;
}

gp_Pnt EndpointPoint(const TopoDS_Edge& edge, bool atStart,
                     const BRepAdaptor_Curve& curve) {
  const TopoDS_Vertex vertex = VertexAt(edge, atStart);
  if (!vertex.IsNull()) return BRep_Tool::Pnt(vertex);
  return curve.Value(atStart ? curve.FirstParameter() : curve.LastParameter());
}

double EndpointTolerance(const TopoDS_Edge& edge, bool atStart) {
  const TopoDS_Vertex vertex = VertexAt(edge, atStart);
  if (vertex.IsNull()) return kProfileTolerance;
  return std::max(kProfileTolerance, BRep_Tool::Tolerance(vertex));
}

}  // namespace

bool BuildPlanarProfileFromEdges(const std::vector<TopoDS_Edge>& sourceEdges,
                                 const SketchPlane& plane,
                                 TopoDS_Shape* output, std::string* error) {
  if (!output) return ProfileFail(error, "profile output is null");
  if (sourceEdges.empty()) return ProfileFail(error, "profile edge list is empty");
  if (!ValidateSketchPlane(plane, error)) return false;

  try {
    const gp_Pln targetPlane(
        gp_Pnt(plane.origin[0], plane.origin[1], plane.origin[2]),
        gp_Dir(plane.normal[0], plane.normal[1], plane.normal[2]));
    std::vector<ProfileEdge> edges;
    edges.reserve(sourceEdges.size());
    for (const auto& source : sourceEdges) {
      if (source.IsNull()) return ProfileFail(error, "profile contains a null edge");
      BRepBuilderAPI_Copy copy(source, Standard_True, Standard_True);
      if (!copy.IsDone() || copy.Shape().IsNull() ||
          copy.Shape().ShapeType() != TopAbs_EDGE) {
        return ProfileFail(error, "cannot safely copy profile edge");
      }
      ProfileEdge edge;
      edge.edge = TopoDS::Edge(copy.Shape());
      if (!ValidateProfileEdge(edge.edge, plane, error)) return false;
      BRepAdaptor_Curve curve(edge.edge);
      edge.start = EndpointPoint(edge.edge, true, curve);
      edge.end = EndpointPoint(edge.edge, false, curve);
      edge.startTolerance = EndpointTolerance(edge.edge, true);
      edge.endTolerance = EndpointTolerance(edge.edge, false);
      edges.push_back(std::move(edge));
    }

    const size_t endpointCount = edges.size() * 2;
    std::vector<size_t> parents(endpointCount);
    std::vector<gp_Pnt> endpointPoints(endpointCount);
    std::vector<double> endpointTolerances(endpointCount, kProfileTolerance);
    for (size_t i = 0; i < edges.size(); ++i) {
      parents[2 * i] = 2 * i;
      parents[2 * i + 1] = 2 * i + 1;
      endpointPoints[2 * i] = edges[i].start;
      endpointPoints[2 * i + 1] = edges[i].end;
      endpointTolerances[2 * i] = edges[i].startTolerance;
      endpointTolerances[2 * i + 1] = edges[i].endTolerance;
    }
    const auto root = [&parents](size_t node) {
      size_t top = node;
      while (parents[top] != top) top = parents[top];
      while (parents[node] != node) {
        const size_t next = parents[node];
        parents[node] = top;
        node = next;
      }
      return top;
    };
    for (size_t i = 0; i < endpointCount; ++i) {
      for (size_t j = i + 1; j < endpointCount; ++j) {
        const double tolerance =
            std::max(endpointTolerances[i], endpointTolerances[j]);
        if (endpointPoints[i].Distance(endpointPoints[j]) <= tolerance) {
          const size_t left = root(i);
          const size_t right = root(j);
          if (left != right) parents[right] = left;
        }
      }
    }

    std::vector<gp_Pnt> nodePoints(endpointCount);
    std::vector<double> nodeTolerances(endpointCount, kProfileTolerance);
    std::vector<bool> hasNodePoint(endpointCount, false);
    for (size_t i = 0; i < endpointCount; ++i) {
      const size_t node = root(i);
      if (!hasNodePoint[node]) {
        nodePoints[node] = endpointPoints[i];
        hasNodePoint[node] = true;
      }
      nodeTolerances[node] = std::max(nodeTolerances[node], endpointTolerances[i]);
    }
    std::vector<std::vector<std::pair<size_t, bool>>> incident(endpointCount);
    for (size_t i = 0; i < edges.size(); ++i) {
      edges[i].startNode = root(2 * i);
      edges[i].endNode = root(2 * i + 1);
      incident[edges[i].startNode].push_back({i, true});
      incident[edges[i].endNode].push_back({i, false});
    }
    for (const auto& endpoints : incident) {
      if (endpoints.empty()) continue;
      if (endpoints.size() != 2) {
        return ProfileFail(error, endpoints.size() < 2
            ? "open profile: every boundary must be closed"
            : "profile boundaries touch or branch at an endpoint");
      }
    }

    std::vector<bool> used(edges.size(), false);
    std::vector<ProfileLoop> loops;
    for (size_t seed = 0; seed < edges.size(); ++seed) {
      if (used[seed]) continue;
      const size_t loopIndex = loops.size();
      const size_t startNode = edges[seed].startNode;
      size_t currentNode = edges[seed].endNode;
      std::vector<TopoDS_Edge> ordered{edges[seed].edge};
      used[seed] = true;
      edges[seed].loop = loopIndex;
      while (currentNode != startNode) {
        size_t nextEdge = edges.size();
        bool atStart = false;
        for (const auto& link : incident[currentNode]) {
          if (used[link.first]) continue;
          if (nextEdge != edges.size()) {
            return ProfileFail(error, "profile boundary is not a simple closed loop");
          }
          nextEdge = link.first;
          atStart = link.second;
        }
        if (nextEdge == edges.size()) {
          return ProfileFail(error, "open profile: every boundary must be closed");
        }
        TopoDS_Edge next = edges[nextEdge].edge;
        if (!atStart) next.Reverse();
        ordered.push_back(next);
        used[nextEdge] = true;
        edges[nextEdge].loop = loopIndex;
        currentNode = atStart ? edges[nextEdge].endNode
                              : edges[nextEdge].startNode;
        if (ordered.size() > edges.size()) {
          return ProfileFail(error, "profile boundary did not close");
        }
      }

      BRepBuilderAPI_MakeWire wireBuilder;
      for (const auto& edge : ordered) wireBuilder.Add(edge);
      if (!wireBuilder.IsDone() || wireBuilder.Wire().IsNull() ||
          !wireBuilder.Wire().Closed() ||
          !BRepCheck_Analyzer(wireBuilder.Wire()).IsValid()) {
        return ProfileFail(error, "cannot build a closed native profile wire");
      }
      ProfileLoop loop;
      loop.wire = wireBuilder.Wire();
      if (!MakeLoopFace(loop.wire, targetPlane, &loop.face, error)) {
        return false;
      }
      GProp_GProps properties;
      BRepGProp::SurfaceProperties(loop.face, properties);
      loop.area = std::fabs(properties.Mass());
      if (!std::isfinite(loop.area) || !(loop.area > 0)) {
        return ProfileFail(error, "profile loop has zero or nonfinite area");
      }
      BRepAdaptor_Curve firstCurve(ordered.front());
      loop.sample = firstCurve.Value(firstCurve.FirstParameter());
      loops.push_back(std::move(loop));
    }

    std::vector<Bnd_Box> bounds(edges.size());
    for (size_t i = 0; i < edges.size(); ++i) {
      BRepBndLib::Add(edges[i].edge, bounds[i], false);
    }
    for (size_t i = 0; i < edges.size(); ++i) {
      for (size_t j = i + 1; j < edges.size(); ++j) {
        if (bounds[i].IsOut(bounds[j])) continue;
        BRepAlgoAPI_Section section(edges[i].edge, edges[j].edge, false);
        section.SetNonDestructive(true);
        section.Build();
        if (!section.IsDone()) {
          return ProfileFail(error, "OCCT could not check profile boundary intersections");
        }
        const TopoDS_Shape intersections = section.Shape();
        TopExp_Explorer intersectionEdges(intersections, TopAbs_EDGE);
        if (intersectionEdges.More()) {
          return ProfileFail(error, "profile boundaries intersect or overlap");
        }
        std::vector<size_t> sharedNodes;
        if (edges[i].loop == edges[j].loop) {
          for (size_t left : {edges[i].startNode, edges[i].endNode}) {
            for (size_t right : {edges[j].startNode, edges[j].endNode}) {
              if (left == right &&
                  std::find(sharedNodes.begin(), sharedNodes.end(), left) ==
                      sharedNodes.end()) {
                sharedNodes.push_back(left);
              }
            }
          }
        }
        for (TopExp_Explorer vertexIt(intersections, TopAbs_VERTEX);
             vertexIt.More(); vertexIt.Next()) {
          const gp_Pnt point = BRep_Tool::Pnt(TopoDS::Vertex(vertexIt.Current()));
          bool allowedJoin = false;
          for (const size_t node : sharedNodes) {
            if (point.Distance(nodePoints[node]) <=
                nodeTolerances[node] + kProfileTolerance) {
              allowedJoin = true;
              break;
            }
          }
          if (!allowedJoin) {
            return ProfileFail(error, "profile boundaries cross or touch");
          }
        }
      }
    }

    for (size_t i = 0; i < loops.size(); ++i) {
      for (size_t j = 0; j < loops.size(); ++j) {
        if (i == j) continue;
        BRepClass_FaceClassifier classifier(loops[j].face, loops[i].sample,
                                             kProfileTolerance);
        if (classifier.State() == TopAbs_ON ||
            classifier.State() == TopAbs_UNKNOWN) {
          return ProfileFail(error, "profile boundaries touch or have ambiguous containment");
        }
        if (classifier.State() == TopAbs_IN) {
          if (!(loops[j].area > loops[i].area)) {
            return ProfileFail(error, "profile containment has inconsistent loop areas");
          }
          if (loops[i].parent < 0 ||
              loops[j].area < loops[loops[i].parent].area) {
            loops[i].parent = static_cast<int>(j);
          }
        }
      }
    }
    for (size_t i = 0; i < loops.size(); ++i) {
      std::vector<bool> seen(loops.size(), false);
      int parent = loops[i].parent;
      while (parent >= 0) {
        if (seen[parent]) return ProfileFail(error, "profile containment cycle detected");
        seen[parent] = true;
        ++loops[i].depth;
        parent = loops[parent].parent;
      }
    }

    std::vector<TopoDS_Face> faces;
    for (size_t i = 0; i < loops.size(); ++i) {
      if (loops[i].depth % 2 != 0) continue;
      BRepBuilderAPI_MakeFace faceBuilder(targetPlane, loops[i].wire, true);
      size_t expectedWires = 1;
      for (size_t j = 0; j < loops.size(); ++j) {
        if (loops[j].parent == static_cast<int>(i) &&
            loops[j].depth == loops[i].depth + 1) {
          faceBuilder.Add(loops[j].wire);
          ++expectedWires;
        }
      }
      faceBuilder.Build();
      if (!faceBuilder.IsDone()) {
        return ProfileFail(error, "cannot assemble native material region");
      }
      ShapeFix_Face orientation(faceBuilder.Face());
      orientation.FixOrientation();
      const TopoDS_Face face = orientation.Face();
      size_t actualWires = 0;
      for (TopExp_Explorer it(face, TopAbs_WIRE); it.More(); it.Next()) {
        ++actualWires;
      }
      if (actualWires != expectedWires) {
        return ProfileFail(error, "profile orientation changed boundary loops");
      }
      if (!BRepCheck_Analyzer(face).IsValid(face)) {
        return ProfileFail(error, "native material region failed face validation");
      }
      faces.push_back(face);
    }
    if (faces.empty()) return ProfileFail(error, "profile contains no material region");

    TopoDS_Shape candidate;
    if (faces.size() == 1) {
      candidate = faces.front();
    } else {
      BRep_Builder builder;
      TopoDS_Compound compound;
      builder.MakeCompound(compound);
      for (const auto& face : faces) builder.Add(compound, face);
      candidate = compound;
    }
    if (!BRepCheck_Analyzer(candidate).IsValid()) {
      return ProfileFail(error, "native planar profile failed validation");
    }
    *output = candidate;
    if (error) error->clear();
    return true;
  } catch (const Standard_Failure& failure) {
    const char* message = failure.GetMessageString();
    return ProfileFail(error, message && message[0]
        ? std::string("native planar profile: ") + message
        : "native planar profile kernel failure");
  } catch (const std::exception& failure) {
    return ProfileFail(error, std::string("native planar profile: ") + failure.what());
  } catch (...) {
    return ProfileFail(error, "native planar profile failed");
  }
}

bool BuildProfileFromSketch(const SketchFeature& sketch, TopoDS_Shape* output,
                            std::string* error) {
  if (!output) return ProfileFail(error, "profile output is null");
  std::vector<Edge2D> sketchEdges;
  if (!EdgesFromSketch(sketch, &sketchEdges, error)) return false;
  std::vector<TopoDS_Edge> edges;
  edges.reserve(sketchEdges.size());
  for (const auto& edge : sketchEdges) edges.push_back(edge.edge);
  TopoDS_Shape candidate;
  if (!BuildPlanarProfileFromEdges(edges, sketch.plane, &candidate, error)) {
    return false;
  }
  *output = candidate;
  return true;
}

bool BuildFaceFromSketch(const SketchFeature& sketch, TopoDS_Face* output,
                         std::string* error) {
  if (!output) return ProfileFail(error, "face output is null");
  TopoDS_Shape profile;
  if (!BuildProfileFromSketch(sketch, &profile, error)) return false;
  if (profile.ShapeType() == TopAbs_FACE) {
    *output = TopoDS::Face(profile);
    return true;
  }
  size_t faceCount = 0;
  TopoDS_Face onlyFace;
  for (TopExp_Explorer it(profile, TopAbs_FACE); it.More(); it.Next()) {
    onlyFace = TopoDS::Face(it.Current());
    ++faceCount;
  }
  if (faceCount != 1) {
    return ProfileFail(error,
        "sketch has multiple material regions; legacy face output accepts one");
  }
  *output = onlyFace;
  return true;
}

#endif

}  // namespace kreoda
