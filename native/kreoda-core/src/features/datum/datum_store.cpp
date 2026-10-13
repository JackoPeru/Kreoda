#include "datum_store.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <stdexcept>
#include "../../model/shapes.h"
#include "../../protocol/json_fields.h"
#include "../../topology/face_roles.h"
#if KREODA_WITH_OCCT
#include <BRepAdaptor_Curve.hxx>
#include <Standard_Failure.hxx>
#include <gp_Lin.hxx>
#endif
namespace kreoda {
DatumStore& DatumStore::instance() { static DatumStore store; return store; }
void DatumStore::clear() { std::lock_guard<std::mutex> lock(mutex_); records_.clear(); order_.clear(); }
void DatumStore::put(DatumRecord record) { std::lock_guard<std::mutex> lock(mutex_); if (!records_.count(record.featureId)) order_.push_back(record.featureId); records_[record.featureId] = std::move(record); }
bool DatumStore::get(const std::string& id, DatumRecord* out) const { std::lock_guard<std::mutex> lock(mutex_); auto it = records_.find(id); if (it == records_.end()) return false; if (out) *out = it->second; return true; }
bool DatumStore::contains(const std::string& id) const { return get(id, nullptr); }
bool DatumStore::remove(const std::string& id) { std::lock_guard<std::mutex> lock(mutex_); if (!records_.erase(id)) return false; order_.erase(std::remove(order_.begin(), order_.end(), id), order_.end()); return true; }
std::vector<DatumRecord> DatumStore::listInOrder() const { std::lock_guard<std::mutex> lock(mutex_); std::vector<DatumRecord> out; for (const auto& id : order_) out.push_back(records_.at(id)); return out; }
namespace {
using V = std::array<double, 3>;
constexpr double kPointTolerance = 1e-7, kParallelTolerance = 1e-9;
[[noreturn]] void fail(const std::string& message) { throw std::runtime_error(message); }
V vec(const double* p) { return {p[0],p[1],p[2]}; }
void put(const V& v, double* p) { std::copy(v.begin(),v.end(),p); }
V add(V a, V b) { return {a[0]+b[0],a[1]+b[1],a[2]+b[2]}; }
V sub(V a, V b) { return {a[0]-b[0],a[1]-b[1],a[2]-b[2]}; }
V mul(V a, double s) { return {a[0]*s,a[1]*s,a[2]*s}; }
double dot(V a, V b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
V cross(V a, V b) { return {a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]}; }
double length(V v) { return std::hypot(v[0],v[1],v[2]); }
V finite(V v) { for (double x:v) if (!std::isfinite(x)) fail("datum geometry must be finite"); return v; }
V unit(V v, double threshold) { const auto n=length(v); if (!std::isfinite(n)||n<=threshold) fail("datum sources are degenerate"); return mul(v,1/n); }
std::string text(const Json& j, const char* key) {
  const auto s=json_string_field(j,key,""); if(s.empty()) fail(std::string(key)+" is required"); return s;
}
double number(const Json& j, const char* key, double limit=1000000) {
  double v; if(!json_double_strict(j,key,&v)||std::fabs(v)>limit) fail(std::string(key)+" is outside the finite input range"); return v;
}
V coordinates(const Json& j) {
  const auto& p=j.at("positionMm"); if(!p.is_array()||p.size()!=3) fail("positionMm must contain exactly three numbers");
  V out{}; for(int i=0;i<3;++i) { if(!p[i].is_number()) fail("positionMm must contain numbers"); out[i]=p[i].get<double>(); if(!std::isfinite(out[i])||std::fabs(out[i])>1000000) fail("positionMm is outside the finite input range"); } return out;
}
void dependency(const std::string& id, DatumRecord& out) {
  if(!ShapeStore::ValidFeatureId(id)) fail("invalid source featureId");
  if(id==out.featureId&&!id.empty()) fail("datum cannot reference itself");
  if(std::find(out.dependsOn.begin(),out.dependsOn.end(),id)==out.dependsOn.end()) out.dependsOn.push_back(id);
}
bool storedShape(const std::string& id, const DatumSourceRecords* sources, ShapeRecord* out) {
  if(!sources) return ShapeStore::instance().get(id,out);
  int count=0; for(const auto& record:sources->shapes) if(record.featureId==id) { *out=record; ++count; }
  if(count>1) fail("incoming native source is ambiguous: "+id); return count==1;
}
bool storedDatum(const std::string& id, const DatumSourceRecords* sources, DatumRecord* out) {
  if(!sources) return DatumStore::instance().get(id,out);
  int count=0; for(const auto& record:sources->datums) if(record.featureId==id) { *out=record; ++count; }
  if(count>1) fail("incoming datum source is ambiguous: "+id); return count==1;
}
DatumRecord datum(const Json& ref, DatumKind kind, DatumRecord& out, const DatumSourceRecords* sources) {
  const auto id=text(ref,"featureId"); dependency(id,out); DatumRecord source;
  if(!storedDatum(id,sources,&source)) fail("missing datum source "+id);
  if(source.kind!=kind) fail("datum source has the wrong kind: "+id);
  if(source.status!="ok") fail("broken datum source "+id+": "+source.error);
  return source;
}
V pointRef(const Json& ref, DatumRecord& out, const DatumSourceRecords* sources) {
  const auto type=text(ref,"type");
  if(type=="coordinates") return coordinates(ref);
  if(type=="datum") return finite(vec(datum(ref,DatumKind::Point,out,sources).positionMm));
  fail("unsupported point reference type "+type);
}
SketchPlane principal(const Json& ref) {
  const auto kind=text(ref,"planeKind"); if(kind!="XY"&&kind!="XZ"&&kind!="YZ") fail("planeKind must be XY|XZ|YZ"); return PrincipalPlane(kind);
}
SketchPlane planeRef(const Json& ref, DatumRecord& out, const DatumSourceRecords* sources) {
  const auto type=text(ref,"type");
  SketchPlane p;
  if(type=="principal") p=principal(ref);
  else if(type=="datum") p=datum(ref,DatumKind::Plane,out,sources).plane;
  else if(type=="face") {
#if KREODA_WITH_OCCT
    const auto id=text(ref,"featureId"), role=text(ref,"persistentFaceId"); dependency(id,out); ShapeRecord shape;
    if(!storedShape(id,sources,&shape)||shape.shape.IsNull()) fail("missing native face owner "+id);
    if(HasIndexedTopologyRole(role)) fail("indexed face source is not persistent");
    const auto full=role.find(':')==std::string::npos?id+":"+role:role;
    const auto roles=ClassifyFaceRoles(shape.shape,shape.type,id);
    if(std::count(roles.begin(),roles.end(),full)!=1) fail("native face source missing or ambiguous");
    if(!FaceFrameInfo(shape.shape,id,shape.type,full,p.origin,p.xAxis,p.yAxis,p.normal)) fail("native face source must be planar");
    // FaceFrameInfo supplies outward normal; rebuild y for reversed faces.
    put(cross(vec(p.normal),vec(p.xAxis)),p.yAxis);
#else
    fail("native face reference requires OCCT");
#endif
  } else fail("unsupported plane reference type "+type);
  std::string error; if(!ValidateSketchPlane(p,&error)) fail(error); return p;
}
struct Axis { V origin, direction; };
Axis axisRef(const Json& ref, DatumRecord& out, const DatumSourceRecords* sources) {
  const auto type=text(ref,"type");
  Axis axis{{0,0,0},{0,0,0}};
  if(type=="principal") {
    const auto a=text(ref,"axis"); if(a=="X") axis.direction[0]=1; else if(a=="Y") axis.direction[1]=1; else if(a=="Z") axis.direction[2]=1; else fail("axis must be X|Y|Z");
  } else if(type=="datum") {
    const auto d=datum(ref,DatumKind::Axis,out,sources); axis={vec(d.originMm),vec(d.direction)};
  } else if(type=="edge") {
#if KREODA_WITH_OCCT
    const auto id=text(ref,"featureId"), role=text(ref,"persistentEdgeId"); dependency(id,out); ShapeRecord shape;
    if(!storedShape(id,sources,&shape)||shape.shape.IsNull()) fail("missing native edge owner "+id);
    if(HasIndexedTopologyRole(role)) fail("indexed edge source is not persistent");
    const auto full=role.find(':')==std::string::npos?id+":"+role:role;
    TopoDS_Edge edge; int matches=0;
    for(const auto& candidate:ClassifyEdgeRoles(shape.shape,shape.type,id)) if(candidate.persistentEdgeId==full) { edge=candidate.edge; ++matches; }
    if(matches!=1) fail("native edge source missing or ambiguous");
    BRepAdaptor_Curve curve(edge); if(curve.GetType()!=GeomAbs_Line) fail("native edge source must be a straight line");
    const auto line=curve.Line(); const auto p=line.Location(); const auto n=line.Direction(); axis={{p.X(),p.Y(),p.Z()},{n.X(),n.Y(),n.Z()}};
#else
    fail("native edge reference requires OCCT");
#endif
  } else fail("unsupported axis reference type "+type);
  finite(axis.origin); finite(axis.direction); if(std::fabs(length(axis.direction)-1)>1e-9) fail("datum axis direction must be unit length"); return axis;
}
V rotate(V v, V axis, double radians) {
  const auto c=std::cos(radians), s=std::sin(radians); return add(add(mul(v,c),mul(cross(axis,v),s)),mul(axis,dot(axis,v)*(1-c)));
}
}
static bool ResolveDatumDefinitionImpl(DatumKind kind, const std::string& definitionJson,
                            DatumRecord* out, std::string* error, const DatumSourceRecords* sources) {
  if(!out) { if(error) *error="datum output is required"; return false; }
  try {
    if(definitionJson.size()>65536) fail("datum definition too large");
    const auto def=parse_json_object(definitionJson); if(!def.is_object()) fail("datum definition must be an object");
    DatumRecord result; result.featureId=out->featureId; result.kind=kind; result.definitionJson=def.dump();
    const auto type=text(def,"type");
    if(kind==DatumKind::Point) {
      V p;
      if(type=="coordinates") p=coordinates(def);
      else if(type=="midpoint") { const auto a=pointRef(def.at("first"),result,sources),b=pointRef(def.at("second"),result,sources); p=mul(add(a,b),.5); }
      else fail("unsupported point definition type "+type);
      put(finite(p),result.positionMm);
    } else if(kind==DatumKind::Plane) {
      SketchPlane p;
      if(type=="principal") p=principal(def);
      else if(type=="offset") { p=planeRef(def.at("base"),result,sources); put(add(vec(p.origin),mul(vec(p.normal),number(def,"offsetMm"))),p.origin); }
      else if(type=="mid") {
        p=planeRef(def.at("first"),result,sources); const auto second=planeRef(def.at("second"),result,sources);
        if(length(cross(vec(p.normal),vec(second.normal)))>kParallelTolerance) fail("midplane sources must be parallel");
        put(add(vec(p.origin),mul(vec(p.normal),dot(vec(p.normal),sub(vec(second.origin),vec(p.origin)))*.5)),p.origin);
      } else if(type=="angle") {
        p=planeRef(def.at("base"),result,sources); const auto axis=axisRef(def.at("axis"),result,sources); const auto radians=number(def,"angleDeg",360)*std::acos(-1.0)/180;
        put(add(axis.origin,rotate(sub(vec(p.origin),axis.origin),axis.direction,radians)),p.origin);
        put(rotate(vec(p.xAxis),axis.direction,radians),p.xAxis); put(rotate(vec(p.yAxis),axis.direction,radians),p.yAxis); put(rotate(vec(p.normal),axis.direction,radians),p.normal);
      } else if(type=="threePoint") {
        const auto a=pointRef(def.at("first"),result,sources),b=pointRef(def.at("second"),result,sources),c=pointRef(def.at("third"),result,sources);
        const auto x=unit(sub(b,a),kPointTolerance),n=unit(cross(x,sub(c,a)),kPointTolerance); put(a,p.origin); put(x,p.xAxis); put(n,p.normal); put(cross(n,x),p.yAxis);
      } else fail("unsupported plane definition type "+type);
      std::string planeError; if(!ValidateSketchPlane(p,&planeError)) fail(planeError); result.plane=p;
    } else if(kind==DatumKind::Axis) {
      Axis axis;
      if(type=="twoPoint") { axis.origin=pointRef(def.at("first"),result,sources); axis.direction=unit(sub(pointRef(def.at("second"),result,sources),axis.origin),kPointTolerance); }
      else if(type=="planeNormal") { const auto p=planeRef(def.at("plane"),result,sources); axis.direction=vec(p.normal); axis.origin=def.contains("through")?pointRef(def.at("through"),result,sources):vec(p.origin); }
      else if(type=="planeIntersection") {
        const auto a=planeRef(def.at("first"),result,sources),b=planeRef(def.at("second"),result,sources); const auto n1=vec(a.normal),n2=vec(b.normal),n=cross(n1,n2);
        const auto size=length(n); if(size<=kParallelTolerance) fail("intersection planes are parallel");
        const auto d1=dot(n1,vec(a.origin)),d2=dot(n2,vec(b.origin)); axis.origin=mul(cross(sub(mul(n2,d1),mul(n1,d2)),n),1/(size*size)); axis.direction=mul(n,1/size);
      } else fail("unsupported axis definition type "+type);
      put(finite(axis.origin),result.originMm); put(finite(axis.direction),result.direction);
    } else fail("unsupported datum kind");
    *out=std::move(result); return true;
#if KREODA_WITH_OCCT
  } catch(const Standard_Failure& failure) { if(error) *error=std::string("native datum source failed: ")+failure.what(); return false;
#endif
  } catch(const std::exception& failure) { if(error) *error=std::string("datum definition: ")+failure.what(); return false; }
}

}

namespace kreoda {
bool ResolveDatumDefinition(DatumKind kind, const std::string& definitionJson, DatumRecord* out, std::string* error) { return ResolveDatumDefinitionImpl(kind,definitionJson,out,error,nullptr); }
bool ResolveDatumDefinition(DatumKind kind, const std::string& definitionJson, const DatumSourceRecords& sources, DatumRecord* out, std::string* error) { return ResolveDatumDefinitionImpl(kind,definitionJson,out,error,&sources); }
}
