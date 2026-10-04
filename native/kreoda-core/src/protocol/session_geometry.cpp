#include "protocol/session_geometry.h"
#include "document/document_store.h"
#include "exchange/sew.h"
#include "features/sketch/sketch_store.h"
#include "features/hole/hole.h"
#include "model/body.h"
#include "model/shapes.h"
#include "topology/face_roles.h"
#include <algorithm>
#include <cmath>
#include <set>

#if KREODA_WITH_OCCT
#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepBndLib.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <BRepGProp.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <Precision.hxx>
#include <Standard_Failure.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#endif

namespace kreoda {
namespace {
[[noreturn]] void fail(const std::string& code, const std::string& message) {
  throw SessionQueryError(code, message);
}
std::string string(const Json& p, const char* key, bool required = false) {
  const auto v = json_string_field(p,key,"");
  if (required && v.empty()) fail("BAD_PARAMS",std::string(key)+" must be a non-empty string");
  return v;
}
#if KREODA_WITH_OCCT
Json xyz(const gp_XYZ& v) { return Json::array({v.X(),v.Y(),v.Z()}); }
Json bounds(const TopoDS_Shape& shape) {
  Bnd_Box b; BRepBndLib::AddOptimal(shape,b,false,false);
  if (b.IsVoid() || b.IsOpen()) fail("QUERY_FAILED","shape has no finite bounding box");
  double x0,y0,z0,x1,y1,z1; b.Get(x0,y0,z0,x1,y1,z1);
  return Json::array({x0,y0,z0,x1,y1,z1});
}
std::string surfaceName(GeomAbs_SurfaceType type) {
  switch(type) {
    case GeomAbs_Plane:return "plane"; case GeomAbs_Cylinder:return "cylinder";
    case GeomAbs_Cone:return "cone"; case GeomAbs_Sphere:return "sphere";
    case GeomAbs_Torus:return "torus"; case GeomAbs_BSplineSurface:return "bspline";
    case GeomAbs_BezierSurface:return "bezier"; default:return "other";
  }
}
std::string curveName(GeomAbs_CurveType type) {
  switch(type) {
    case GeomAbs_Line:return "line"; case GeomAbs_Circle:return "circle";
    case GeomAbs_Ellipse:return "ellipse"; case GeomAbs_BSplineCurve:return "bspline";
    case GeomAbs_BezierCurve:return "bezier"; default:return "other";
  }
}
struct Entity {
  std::string id, role, kind;
  ShapeRecord owner;
  TopoDS_Shape shape;
  Json summary;
};
std::string bodyId(const ShapeRecord& rec) {
  BodyRecord body;
  return BodyStore::instance().bodyForFeature(rec.featureId,&body) ? body.bodyId : "";
}
Json baseSummary(const ShapeRecord& rec, const std::string& id,
                 const std::string& role, const std::string& kind, const TopoDS_Shape& shape) {
  return {{"persistentId",id},{kind == "face" ? "persistentFaceId" : "persistentEdgeId",id},
          {"owner",rec.featureId},{"featureId",rec.featureId},{"ownerBody",bodyId(rec)},
          {"role",role},{"kind",kind},{"description",rec.type+" "+kind+" "+role},
          {"bboxMm",bounds(shape)},{"confidence",HasIndexedTopologyRole(id)?0.5:1.0}};
}
std::vector<Entity> faces(const ShapeRecord& rec) {
  std::vector<Entity> out;
  const auto roles=ClassifyFaceRoles(rec.shape,rec.type,rec.featureId);
  size_t index=0;
  for(TopExp_Explorer ex(rec.shape,TopAbs_FACE);ex.More();ex.Next(),++index) {
    if(index>=roles.size()) fail("QUERY_FAILED","face role count mismatch");
    const auto face=TopoDS::Face(ex.Current());
    const auto id=roles[index]; const auto cut=id.find(':');
    const auto role=cut==std::string::npos?id:id.substr(cut+1);
    auto desc=baseSummary(rec,id,role,"face",face);
    BRepAdaptor_Surface a(face); desc["surfaceType"]=surfaceName(a.GetType());
    GProp_GProps props; BRepGProp::SurfaceProperties(face,props);
    desc["areaMm2"]=props.Mass(); desc["centroidMm"]=xyz(props.CentreOfMass().XYZ());
    desc["orientation"]=face.Orientation()==TopAbs_REVERSED?"reversed":"forward";
    if(a.GetType()==GeomAbs_Plane) {
      gp_Dir n=a.Plane().Axis().Direction(); if(face.Orientation()==TopAbs_REVERSED)n.Reverse();
      desc["normal"]=xyz(n.XYZ()); desc["originMm"]=xyz(a.Plane().Location().XYZ());
    } else if(a.GetType()==GeomAbs_Cylinder) {
      desc["radiusMm"]=a.Cylinder().Radius(); desc["axis"]=xyz(a.Cylinder().Axis().Direction().XYZ());
      desc["originMm"]=xyz(a.Cylinder().Location().XYZ());
    } else if(a.GetType()==GeomAbs_Sphere) {
      desc["radiusMm"]=a.Sphere().Radius(); desc["originMm"]=xyz(a.Sphere().Location().XYZ());
    } else if(a.GetType()==GeomAbs_Torus) {
      desc["majorRadiusMm"]=a.Torus().MajorRadius(); desc["radiusMm"]=a.Torus().MinorRadius();
      desc["axis"]=xyz(a.Torus().Axis().Direction().XYZ());
    } else if(a.GetType()==GeomAbs_Cone) {
      desc["axis"]=xyz(a.Cone().Axis().Direction().XYZ()); desc["semiAngleDeg"]=a.Cone().SemiAngle()*180/std::acos(-1.0);
    }
    out.push_back({id,role,"face",rec,face,std::move(desc)});
  }
  return out;
}
std::vector<Entity> edges(const ShapeRecord& rec) {
  std::vector<Entity> out;
  for(const auto& dto:ClassifyEdgeRoles(rec.shape,rec.type,rec.featureId)) {
    const auto cut=dto.persistentEdgeId.find(':');
    const auto role=cut==std::string::npos?dto.persistentEdgeId:dto.persistentEdgeId.substr(cut+1);
    auto desc=baseSummary(rec,dto.persistentEdgeId,role,"edge",dto.edge);
    BRepAdaptor_Curve a(dto.edge); desc["curveType"]=curveName(a.GetType());
    GProp_GProps props; BRepGProp::LinearProperties(dto.edge,props); desc["lengthMm"]=props.Mass();
    if(a.GetType()==GeomAbs_Line) desc["axis"]=xyz(a.Line().Direction().XYZ());
    if(a.GetType()==GeomAbs_Circle) {
      desc["radiusMm"]=a.Circle().Radius(); desc["axis"]=xyz(a.Circle().Axis().Direction().XYZ());
      desc["originMm"]=xyz(a.Circle().Location().XYZ());
    }
    out.push_back({dto.persistentEdgeId,role,"edge",rec,dto.edge,std::move(desc)});
  }
  return out;
}
ShapeRecord record(const std::string& id) {
  ShapeRecord rec;
  if(ShapeStore::instance().get(id,&rec) && !rec.shape.IsNull()) return rec;
  BodyRecord b;
  if(BodyStore::instance().get(id,&b) && ShapeStore::instance().get(b.tipFeatureId,&rec) && !rec.shape.IsNull()) return rec;
  fail("NOT_FOUND","unknown solid feature or body "+id);
}
Entity resolve(const std::string& id) {
  const auto cut=id.find(':');
  if(cut==std::string::npos) {
    const auto rec=record(id); return {id,"","shape",rec,rec.shape,Json::object()};
  }
  const auto rec=record(id.substr(0,cut)); const auto role=id.substr(cut+1);
  std::vector<Entity> found;
  for(auto& e:faces(rec)) if(e.role==role)found.push_back(std::move(e));
  for(auto& e:edges(rec)) if(e.role==role)found.push_back(std::move(e));
  if(found.empty())fail("NOT_FOUND","unknown persistent reference "+id);
  if(found.size()!=1)fail("AMBIGUOUS_REFERENCE","reference resolves to multiple entities: "+id);
  return found.front();
}
std::vector<ShapeRecord> scope(const Json& p) {
  const auto feature=string(p,"featureId"); const auto owner=string(p,"ownerBody"); const auto body=string(p,"bodyId");
  for(const auto key:{"featureId","ownerBody","bodyId"})if(p.contains(key)&&string(p,key).empty())fail("BAD_PARAMS",std::string(key)+" cannot be empty");
  const int requested=(!feature.empty()?1:0)+(!owner.empty()?1:0)+(!body.empty()?1:0);
  if(requested>1)fail("BAD_PARAMS","choose one featureId, bodyId or ownerBody");
  const auto id=!feature.empty()?feature:!owner.empty()?owner:body;
  if(!id.empty())return {record(id)};
  std::vector<ShapeRecord> records; std::string error;
  if(ShapeStore::instance().listInOrder().empty())return records;
  if(!CollectExportRecords(&records,&error))fail("QUERY_FAILED",error);
  return records;
}
TopoDS_Shape scopedShape(const Json& p, bool allowEmpty, bool* empty) {
  const auto ref=string(p,"referenceId");
  if(p.contains("referenceId")&&ref.empty())fail("BAD_PARAMS","referenceId cannot be empty");
  if(!ref.empty()&&(p.contains("featureId")||p.contains("bodyId")||p.contains("ownerBody")))fail("BAD_PARAMS","referenceId cannot be combined with a feature or body scope");
  if(!ref.empty()) {*empty=false; return resolve(ref).shape;}
  const auto recs=scope(p); *empty=recs.empty();
  if(recs.empty()) {
    if(allowEmpty)return {};
    fail("NOT_FOUND","document has no displayed solids");
  }
  if(recs.size()==1)return recs.front().shape;
  TopoDS_Compound compound; std::string error;
  if(!CollectSolidsCompound(&compound,&error))fail("QUERY_FAILED",error);
  return compound;
}
double tolerance(const Json& p, const char* key, double fallback) {
  const auto v=json_double_field(p,key,fallback);
  if(v<0)fail("BAD_PARAMS",std::string(key)+" must be non-negative"); return v;
}
bool directionMatches(const Json& p,const Json& summary,const char* key,double angularTolerance) {
  if(!p.contains(key))return true;
  const auto values=json_number_array(p,key);
  if(values.size()!=3)fail("BAD_PARAMS",std::string(key)+" must contain three numbers");
  const gp_Vec requested(values[0],values[1],values[2]);
  if(requested.SquareMagnitude()<=1e-24)fail("BAD_PARAMS",std::string(key)+" cannot be zero");
  if(!summary.contains(key))return false;
  const auto& a=summary[key];const gp_Vec actual(a[0].get<double>(),a[1].get<double>(),a[2].get<double>());
  double dot=requested.Dot(actual)/(requested.Magnitude()*actual.Magnitude());
  if(std::string(key)=="axis")dot=std::abs(dot);
  return std::acos(std::clamp(dot,-1.0,1.0))*180/std::acos(-1.0)<=angularTolerance;
}
bool matches(const Json& p,const Entity& e,double tol,double angleTol) {
  for(const auto key:{"role","surfaceType","curveType","orientation"}) {
    const auto wanted=string(p,key);
    if(!wanted.empty() && (key==std::string("role") ? (e.role!=wanted && e.id!=wanted) : (!e.summary.contains(key)||e.summary[key]!=wanted)))return false;
  }
  for(const auto key:{"radiusMm","areaMm2","lengthMm"}) {
    if(p.contains(key)) {
      const auto wanted=json_double_field(p,key); if(wanted<0)fail("BAD_PARAMS",std::string(key)+" must be non-negative");
      if(!e.summary.contains(key) || std::abs(e.summary[key].get<double>()-wanted)>tol)return false;
    }
  }
  if(p.contains("dimensionsMm")) {
    const auto dim=json_number_array(p,"dimensionsMm"); if(dim.size()!=3)fail("BAD_PARAMS","dimensionsMm must contain three numbers");
    const auto& box=e.summary["bboxMm"];
    for(int i=0;i<3;++i) {
      if(dim[i]<0)fail("BAD_PARAMS","dimensionsMm cannot be negative");
      if(std::abs(box[i+3].get<double>()-box[i].get<double>()-dim[i])>tol)return false;
    }
  }
  return directionMatches(p,e.summary,"normal",angleTol)&&directionMatches(p,e.summary,"axis",angleTol);
}
Json find(const std::string& method,const Json& p) {
  // Validate filters even in an empty model or before a candidate is skipped.
  for(const auto key:{"role","surfaceType","curveType","orientation"})string(p,key);
  for(const auto key:{"radiusMm","areaMm2","lengthMm"})if(p.contains(key))tolerance(p,key,0);
  for(const auto key:{"normal","axis","dimensionsMm"})if(p.contains(key)) {
    auto v=json_number_array(p,key);if(v.size()!=3)fail("BAD_PARAMS",std::string(key)+" must contain three numbers");
    if(std::string(key)!="dimensionsMm"&&v[0]*v[0]+v[1]*v[1]+v[2]*v[2]<=1e-24)fail("BAD_PARAMS",std::string(key)+" cannot be zero");
    if(std::string(key)=="dimensionsMm"&&std::any_of(v.begin(),v.end(),[](double a){return a<0;}))fail("BAD_PARAMS","dimensionsMm cannot be negative");
  }
  const auto tol=tolerance(p,"toleranceMm",1e-6),angleTol=tolerance(p,"angleToleranceDeg",1);
  Json out=Json::array();
  for(const auto& rec:scope(p)) {
    auto candidates=method=="findFaces"?faces(rec):edges(rec);
    for(auto& e:candidates) {
      const auto duplicate=std::count_if(candidates.begin(),candidates.end(),[&](const Entity& other){return other.id==e.id;})>1;
      e.summary["ambiguous"]=duplicate;
      if(duplicate)e.summary["confidence"]=0.25;
      if(matches(p,e,tol,angleTol))out.push_back(e.summary);
    }
  }
  return {{method=="findFaces"?"faces":"edges",out}};
}
gp_Vec direction(const Entity& e) {
  const char* key=e.summary.contains("normal")?"normal":e.summary.contains("axis")?"axis":nullptr;
  if(!key)fail("NOT_IMPLEMENTED","angle requires an analytic plane normal, straight edge or rotational axis");
  const auto& a=e.summary[key];return gp_Vec(a[0].get<double>(),a[1].get<double>(),a[2].get<double>());
}
Json referenceCheck(const std::string& id) {
  try {
    if(SketchStore::instance().contains(id))return {{"id",id},{"ok",true},{"kind","sketch"}};
    const auto e=resolve(id);
    return {{"id",id},{"ok",true},{"kind",e.kind},{"confidence",e.summary.value("confidence",1.0)}};
  } catch(const SessionQueryError& e) {return {{"id",id},{"ok",false},{"errorCode",e.code},{"detail",e.what()}};}
}
Json manipulators(const Json& p) {
  const auto rec=record(string(p,"featureId",true));const auto& values=rec.paramsMm;
  const auto box=bounds(rec.shape);
  Json origin=Json::array();for(int i=0;i<3;++i)origin.push_back((box[i].get<double>()+box[i+3].get<double>())/2);
  Json out=Json::array();
  auto add=[&](const std::string& id,const std::string& type,const std::string& parameter,const std::string& unit,Json axis=Json(),Json position=Json()) {
    Json entry={{"id",id},{"type",type},{"parameter",parameter},{"unit",unit},{"origin",position.is_null()?origin:position}};
    if(!axis.is_null())entry["axis"]=axis;out.push_back(std::move(entry));
  };
  if(rec.type=="Box"&&values.size()>=3) {
    for(int i=0;i<3;++i) {
      const char* ids[]={"width","height","depth"};const char* params[]={"widthMm","heightMm","depthMm"};
      Json axis=Json::array({0,0,0});axis[i]=1;auto position=origin;position[i]=box[i+3];
      add(ids[i],"linear",params[i],"mm",axis,position);
    }
  } else if(rec.type=="Cylinder"&&values.size()>=2) {
    const auto candidates=faces(rec);std::vector<Entity> walls;
    for(const auto& e:candidates)if(e.summary["surfaceType"]=="cylinder")walls.push_back(e);
    if(walls.size()!=1)fail("AMBIGUOUS_REFERENCE","cylinder manipulator needs one analytic wall");
    const auto axis=walls[0].summary["axis"];
    add("radius","radial","radiusMm","mm",axis);
    auto position=origin;for(int i=0;i<3;++i)position[i]=origin[i].get<double>()+axis[i].get<double>()*values[1]/2;
    add("height","linear","heightMm","mm",axis,position);
  } else if(rec.type=="Sphere")add("radius","radial","radiusMm","mm");
  else if((rec.type=="Extrude"||rec.type=="Revolve")&&!rec.dependsOn.empty()) {
    SketchFeature sketch;if(!SketchStore::instance().get(rec.dependsOn[0],&sketch))fail("NOT_FOUND","manipulator sketch is missing");
    if(rec.type=="Extrude")add("distance","linear","distanceMm","mm",Json::array({sketch.plane.normal[0],sketch.plane.normal[1],sketch.plane.normal[2]}));
    else add("angle","angular","angleDeg","deg",Json::array({sketch.plane.xAxis[0],sketch.plane.xAxis[1],sketch.plane.xAxis[2]}),Json::array({sketch.plane.origin[0],sketch.plane.origin[1],sketch.plane.origin[2]}));
  } else if(rec.type=="Hole"&&!rec.dependsOn.empty()) {
    std::string role,mode;double x=0,y=0;
    if(!DecodeHoleRef(rec.refExtra,&role,&x,&y,&mode))fail("QUERY_FAILED","hole reference is malformed");
    const auto target=record(rec.dependsOn[0]);
    resolve(role.find(':')==std::string::npos?target.featureId+":"+role:role);
    double o[3],xa[3],ya[3],n[3];
    if(!FaceFrameInfo(target.shape,target.featureId,target.type,role,o,xa,ya,n))fail("NOT_IMPLEMENTED","hole manipulator requires a planar support");
    Json position=Json::array(),axis=Json::array();
    for(int i=0;i<3;++i){position.push_back(o[i]+xa[i]*x+ya[i]*y);axis.push_back(-n[i]);}
    add("diameter","radial","diameterMm","mm",axis,position);
    add("depth","linear","depthMm","mm",axis,position);
  } else if(rec.type=="HolePattern") {
    add("diameter","radial","diameterMm","mm");add("depth","linear","depthMm","mm");
  } else if(rec.type=="Fillet")add("radius","radial","radiusMm","mm");
  else if(rec.type=="Chamfer")add("distance","linear","distanceMm","mm");
  else if(rec.type=="Instance"&&values.size()==6) {
    const Json position=Json::array({values[0],values[1],values[2]});
    out.push_back({{"id","position"},{"type","position"},{"parameters",{"txMm","tyMm","tzMm"}},{"origin",position},{"unit","mm"}});
    out.push_back({{"id","rotation"},{"type","angular"},{"parameters",{"rxDeg","ryDeg","rzDeg"}},{"origin",position},{"unit","deg"},{"rotationConvention","extrinsic-ZYX"}});
  }
  return {{"featureId",rec.featureId},{"manipulators",out}};
}
Json validate(const std::string& method,const Json& p) {
  if(method=="validateReferences") {
    if(!p.contains("ids"))fail("BAD_PARAMS","ids is required");
    const auto ids=json_string_array(p,"ids"); Json checks=Json::array();bool valid=true;
    for(const auto& id:ids) {
      if(id.empty())fail("BAD_PARAMS","reference id cannot be empty");
      const auto check=referenceCheck(id);valid=valid&&check["ok"].get<bool>();checks.push_back(check);
    }
    return {{"valid",valid},{"checks",checks},{"scope","kernel-references"}};
  }
  std::vector<ShapeRecord> recs;
  std::vector<SketchFeature> sketches;
  if(method=="validateDocument") {
    recs=ShapeStore::instance().listInOrder();sketches=SketchStore::instance().listInOrder();
  } else if(method=="validateFeature") {
    const auto id=string(p,"featureId",true);SketchFeature sketch;
    if(SketchStore::instance().get(id,&sketch))sketches.push_back(sketch);else recs.push_back(record(id));
  } else {
    const auto id=string(p,"bodyId",true);BodyRecord body;
    if(!BodyStore::instance().get(id,&body))fail("NOT_FOUND","unknown body "+id);
    for(const auto& member:body.history)recs.push_back(record(member));
  }
  Json checks=Json::array();bool valid=true;
  auto check=[&](std::string code,std::string detail,bool ok) {checks.push_back({{"code",code},{"detail",detail},{"ok",ok}});valid=valid&&ok;};
  for(const auto& rec:recs) {
    check("brep-valid",rec.featureId,!rec.shape.IsNull()&&BRepCheck_Analyzer(rec.shape,true).IsValid());
    check("solid-present",rec.featureId,!rec.shape.IsNull()&&TopExp_Explorer(rec.shape,TopAbs_SOLID).More());
    check("params-finite",rec.featureId,std::all_of(rec.paramsMm.begin(),rec.paramsMm.end(),[](double v){return std::isfinite(v);}));
    for(const auto& dep:rec.dependsOn)check("dependency-resolves",rec.featureId+" -> "+dep,ShapeStore::instance().contains(dep)||SketchStore::instance().contains(dep));
    if((rec.type=="Hole"||rec.type=="HolePattern")&&!rec.dependsOn.empty()) {
      const auto start=rec.refExtra.find("face=");
      if(start==std::string::npos)check("reference-resolves",rec.featureId,false);
      else {
        const auto end=rec.refExtra.find(';',start);auto role=rec.refExtra.substr(start+5,end==std::string::npos?end:end-start-5);
        if(role.find(':')==std::string::npos)role=rec.dependsOn[0]+":"+role;
        check("reference-resolves",role,referenceCheck(role)["ok"].get<bool>());
      }
    }
    if((rec.type=="Fillet"||rec.type=="Chamfer")&&!rec.refExtra.empty()&&!rec.dependsOn.empty()) {
      size_t pos=0;
      do {
        const auto end=rec.refExtra.find(',',pos);auto ref=rec.refExtra.substr(pos,end==std::string::npos?end:end-pos);
        if(ref.find(':')==std::string::npos)ref=rec.dependsOn[0]+":"+ref;
        check("reference-resolves",ref,referenceCheck(ref)["ok"].get<bool>());
        if(end==std::string::npos)break;pos=end+1;
      }while(pos<rec.refExtra.size());
    }
  }
  for(const auto& sketch:sketches) {
    if(!sketch.supportRef.empty())check("sketch-support-resolves",sketch.id,referenceCheck(sketch.supportRef)["ok"].get<bool>());
    check("sketch-points-finite",sketch.id,std::all_of(sketch.model.points.begin(),sketch.model.points.end(),[](const auto& point){return std::isfinite(point.x)&&std::isfinite(point.y);}));
  }
  return {{"valid",valid},{"checks",checks},{"scope","kernel"}};
}
#endif
}

Json RunSessionGeometryQuery(const std::string& method,const Json& p) {
  if(!p.is_object())fail("BAD_PARAMS","query params must be an object");
#if KREODA_WITH_OCCT
  try {
    if(method=="findFaces"||method=="findEdges")return find(method,p);
    if(method=="getManipulators")return manipulators(p);
    if(method=="validateDocument"||method=="validateBody"||method=="validateFeature"||method=="validateReferences")return validate(method,p);
    if(method=="measureDistance"||method=="measureAngle") {
      const auto aid=string(p,"a",true),bid=string(p,"b",true);const auto a=resolve(aid),b=resolve(bid);
      if(method=="measureAngle") {
        const double angle=direction(a).Angle(direction(b))*180/std::acos(-1.0);
        return {{"a",aid},{"b",bid},{"angleDeg",angle},{"basis","analytic-direction"}};
      }
      BRepExtrema_DistShapeShape extrema(a.shape,b.shape);
      if(!extrema.IsDone()||extrema.NbSolution()<1)fail("QUERY_FAILED","OCCT minimum-distance computation failed");
      return {{"a",aid},{"b",bid},{"distanceMm",extrema.Value()},{"pointAMm",xyz(extrema.PointOnShape1(1).XYZ())},{"pointBMm",xyz(extrema.PointOnShape2(1).XYZ())},{"basis","brep-minimum"}};
    }
    if(method=="measureRadius"||method=="measureDiameter") {
      const auto ref=string(p,"referenceId");std::vector<Entity> candidates;
      if(p.contains("referenceId")&&ref.empty())fail("BAD_PARAMS","referenceId cannot be empty");
      if(!ref.empty()&&p.contains("featureId"))fail("BAD_PARAMS","choose referenceId or featureId");
      if(!ref.empty())candidates.push_back(resolve(ref));else {
        const auto rec=record(string(p,"featureId",true)); candidates=faces(rec);
      }
      std::vector<double> radii;
      for(const auto& e:candidates)if(e.summary.contains("radiusMm")) {
        const auto radius=e.summary["radiusMm"].get<double>();
        if(std::none_of(radii.begin(),radii.end(),[&](double other){return std::abs(other-radius)<=Precision::Confusion();}))radii.push_back(radius);
      }
      if(radii.empty())fail("NOT_IMPLEMENTED","reference has no analytic constant radius");
      if(radii.size()!=1)fail("AMBIGUOUS_REFERENCE","feature has multiple radii; specify a persistent referenceId");
      Json result={{method=="measureRadius"?"radiusMm":"diameterMm",radii[0]*(method=="measureRadius"?1:2)},{"basis","analytic-geometry"}};
      if(!ref.empty())result["referenceId"]=ref;else result["featureId"]=string(p,"featureId",true);
      return result;
    }
    if(method=="measureVolume"||method=="measureArea"||method=="getBoundingBox") {
      bool empty=false;const auto shape=scopedShape(p,method!="getBoundingBox",&empty);
      GProp_GProps props;
      if(!empty) {
        if(method=="measureVolume"||method=="getBoundingBox")BRepGProp::VolumeProperties(shape,props,false,false,false);
        else BRepGProp::SurfaceProperties(shape,props,false,false);
      }
      Json result={{method=="measureArea"?"areaMm2":"volumeMm3",empty?0:props.Mass()},{"basis","brep"}};
      if(method=="getBoundingBox")result["bboxMm"]=bounds(shape);
      bool selected=false;
      for(const auto key:{"featureId","bodyId","referenceId","ownerBody"})if(p.contains(key)){result[key]=p[key];selected=true;}
      result["modelScope"]=selected?"selected-entity":"current-body-tips-and-displayed-instances";
      return result;
    }
    fail("NOT_IMPLEMENTED","unknown native geometry query "+method);
  } catch(const Standard_Failure& e) {fail("QUERY_FAILED",e.GetMessageString()?e.GetMessageString():"OCCT query failed");}
#else
  fail("NOT_IMPLEMENTED","geometry queries require the real OCCT kernel");
#endif
}
}
