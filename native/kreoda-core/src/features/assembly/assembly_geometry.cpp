#include "features/assembly/assembly_geometry.h"

#include "features/assembly/assembly_constraints.h"
#include "features/instance/instance.h"
#include "persistence/ocaf_live.h"
#include "topology/face_roles.h"
#include "model/geometry_availability.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>
#include <vector>

#if KREODA_WITH_OCCT
#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <NCollection_IndexedMap.hxx>
#include <Standard_Failure.hxx>
#include <TopExp_Explorer.hxx>
#include <TopExp.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#endif

namespace kreoda {
namespace {

void fail(std::string* error,const std::string& message) {
  if(error)*error=message;
}

#if KREODA_WITH_OCCT
std::string faceKind(const TopoDS_Face& face) {
  switch(BRepAdaptor_Surface(face).GetType()) {
    case GeomAbs_Plane:return "plane";
    case GeomAbs_Cylinder:return "cylinder";
    case GeomAbs_Cone:return "cone";
    case GeomAbs_Sphere:return "sphere";
    case GeomAbs_Torus:return "torus";
    case GeomAbs_BSplineSurface:return "bspline";
    case GeomAbs_BezierSurface:return "bezier";
    default:return "other";
  }
}

std::string edgeKind(const TopoDS_Edge& edge) {
  switch(BRepAdaptor_Curve(edge).GetType()) {
    case GeomAbs_Line:return "line";
    case GeomAbs_Circle:return "circle";
    case GeomAbs_Ellipse:return "ellipse";
    case GeomAbs_Hyperbola:return "hyperbola";
    case GeomAbs_Parabola:return "parabola";
    case GeomAbs_BSplineCurve:return "bspline";
    case GeomAbs_BezierCurve:return "bezier";
    default:return "other";
  }
}

bool uniqueFaceByRole(const TopoDS_Shape& shape,const std::string& owner,
                      const std::string& type,const std::string& role,
                      TopoDS_Face* out) {
  const auto roles=ClassifyFaceRoles(shape,type,owner);
  const auto matches=static_cast<std::size_t>(std::count_if(roles.begin(),roles.end(),[&](const auto& item) {
    return item==role||item==owner+":"+role;
  }));
  if(matches!=1)return false;
  return FindFaceByRole(shape,owner,type,role,out);
}

bool uniqueEdgeByRole(const TopoDS_Shape& shape,const std::string& owner,
                      const std::string& type,const std::string& role,
                      TopoDS_Edge* out) {
  std::size_t matches=0;
  TopoDS_Edge found;
  for(const auto& item:ClassifyEdgeRoles(shape,type,owner)) {
    const auto cut=item.persistentEdgeId.find(':');
    const auto local=cut==std::string::npos?item.persistentEdgeId:item.persistentEdgeId.substr(cut+1);
    if(local==role) {found=item.edge;++matches;}
  }
  if(matches!=1)return false;
  if(out)*out=found;
  return true;
}

void supportForSelected(const TopoDS_Shape& selected,const std::string& type,
                        const std::string& owner,const std::string& role,
                        const std::string& kind,AssemblyGeometrySelection* out) {
  if(!out||selected.IsNull())return;
  auto unsupported=[&]{out->type.clear();};
  out->type=type;out->featureId=owner;out->persistentId=role;out->geometryKind=kind;
  out->hasAxisLine=false;
  if(type=="face"&&selected.ShapeType()==TopAbs_FACE) {
    const auto face=TopoDS::Face(selected);
    BRepAdaptor_Surface surface(face);
    gp_Pnt point;gp_Dir direction;
    if(surface.GetType()==GeomAbs_Plane) {
      point=surface.Plane().Location();direction=surface.Plane().Axis().Direction();
      if(kind!="plane"){unsupported();return;}
    } else if(surface.GetType()==GeomAbs_Cylinder) {
      point=surface.Cylinder().Location();direction=surface.Cylinder().Axis().Direction();
      out->hasAxisLine=true;
      if(kind!="cylinder"){unsupported();return;}
    } else {unsupported();return;}
    if(face.Orientation()==TopAbs_REVERSED)direction.Reverse();
    out->point={{point.X(),point.Y(),point.Z()}};
    out->direction={{direction.X(),direction.Y(),direction.Z()}};
  } else if(type=="edge"&&selected.ShapeType()==TopAbs_EDGE) {
    const auto edge=TopoDS::Edge(selected);
    BRepAdaptor_Curve curve(edge);
    gp_Pnt point;gp_Dir direction;
    if(curve.GetType()==GeomAbs_Circle) {
      point=curve.Circle().Location();direction=curve.Circle().Axis().Direction();
      out->hasAxisLine=true;
      if(kind!="circle"){unsupported();return;}
    } else if(curve.GetType()==GeomAbs_Line) {
      point=curve.Line().Location();direction=curve.Line().Direction();
      if(kind!="line"){unsupported();return;}
    } else {unsupported();return;}
    if(edge.Orientation()==TopAbs_REVERSED)direction.Reverse();
    out->point={{point.X(),point.Y(),point.Z()}};
    out->direction={{direction.X(),direction.Y(),direction.Z()}};
  } else unsupported();
}

bool oneMappedWorldEntity(const TopoDS_Shape& shape,const std::string& owner,bool edge,
                          std::map<std::string,std::vector<TopoDS_Shape>>* byId,
                          std::string* error) {
  if(edge) {
    for(const auto& item:ClassifyEdgeRoles(shape,"Instance",owner)) {
      const auto cut=item.persistentEdgeId.find(':');
      const auto role=cut==std::string::npos?item.persistentEdgeId:item.persistentEdgeId.substr(cut+1);
      (*byId)[role].push_back(item.edge);
    }
  } else {
    const auto roles=ClassifyFaceRoles(shape,"Instance",owner);
    for(const auto& full:roles) {
      const auto cut=full.find(':');
      const auto role=cut==std::string::npos?full:full.substr(cut+1);
      TopoDS_Face face;
      if(uniqueFaceByRole(shape,owner,"Instance",role,&face))(*byId)[role].push_back(face);
      else (*byId)[role].push_back(TopoDS_Shape{});
    }
  }
  if(byId->empty()) {fail(error,"instance reconstruction has no pickable topology");return false;}
  return true;
}

void supportFor(const TopoDS_Shape& shape,const std::string& featureType,
                const std::string& type,
                const std::string& owner,const std::string& role,
                const std::string& kind,AssemblyGeometrySelection* out) {
  if(!out)return;
  *out=AssemblyGeometrySelection{};
  if(type=="face") {
    TopoDS_Face face;
    if(!uniqueFaceByRole(shape,owner,featureType,role,&face))return;
    supportForSelected(face,type,owner,role,kind,out);
  } else if(type=="edge") {
    TopoDS_Edge edge;
    if(!uniqueEdgeByRole(shape,owner,featureType,role,&edge))return;
    supportForSelected(edge,type,owner,role,kind,out);
  }
}

bool buildBindingMap(const ShapeRecord& instance,
                     AssemblySourceBindingMap* bindings,
                     AssemblySourceBindingErrors* errors,std::string* error) {
  if(!bindings||!errors)return false;
  bindings->clear();errors->clear();
  if(instance.type!="Instance"||instance.paramsMm.size()!=6||instance.dependsOn.size()!=1) {
    fail(error,"instance must have one live source dependency and six placement values");return false;
  }
  ShapeRecord source;
  std::string reason;
  if(!GetCurrentShapeRecord(instance.dependsOn.front(),&source,&reason)||source.shape.IsNull()) {
    fail(error,"instance source is unavailable: "+reason);return false;
  }
  if(source.type=="Instance") {fail(error,"nested instances are not supported");return false;}

  gp_Trsf placement;
  if(!BuildInstanceTransform(instance.paramsMm,&placement,&reason)) {fail(error,reason);return false;}
  BRepBuilderAPI_Copy copied(source.shape,true,false);
  if(!copied.IsDone()||copied.Shape().IsNull()) {fail(error,"source B-Rep deep copy failed");return false;}
  BRepBuilderAPI_Transform transformed(copied.Shape(),placement,true);
  transformed.Build();
  if(!transformed.IsDone()||transformed.Shape().IsNull()) {fail(error,"instance transform-history reconstruction failed");return false;}

  const auto& world=transformed.Shape();
  std::map<std::string,std::vector<TopoDS_Shape>> worldFaces,worldEdges;
  if(!oneMappedWorldEntity(world,instance.featureId,false,&worldFaces,&reason)||
     !oneMappedWorldEntity(world,instance.featureId,true,&worldEdges,&reason)) {fail(error,reason);return false;}
  for(const auto& item:worldFaces)
    if(item.second.size()!=1||item.second.front().IsNull())(*errors)[instance.featureId+":"+item.first]="world face pick is ambiguous";
  for(const auto& item:worldEdges)
    if(item.second.size()!=1||item.second.front().IsNull())(*errors)[instance.featureId+":"+item.first]="world edge pick is ambiguous";
  auto pickForMapped=[](const TopoDS_Shape& mapped,
                        const std::map<std::string,std::vector<TopoDS_Shape>>& candidates,
                        std::string* role) {
    std::size_t matches=0;
    for(const auto& candidate:candidates) {
      if(candidate.second.size()!=1||candidate.second.front().IsNull())continue;
      if(mapped.IsSame(candidate.second.front())) {*role=candidate.first;++matches;}
    }
    return matches==1;
  };
  auto addEdge=[&](const TopoDS_Edge& sourceEdge,const std::string& sourceRole) {
    const auto copyShape=copied.ModifiedShape(sourceEdge);
    const auto mapped=copyShape.IsNull()?TopoDS_Shape{}:transformed.ModifiedShape(copyShape);
    std::string worldRole;
    if(mapped.IsNull()||!pickForMapped(mapped,worldEdges,&worldRole)) {
      (*errors)[instance.featureId+":"+sourceRole]="edge transform history did not resolve uniquely";return;
    }
    const auto worldPick=instance.featureId+":"+worldRole;
    (*bindings)[worldPick]={{"type","edge"},{"featureId",source.featureId},
        {"persistentEdgeId",sourceRole},{"geometryKind",edgeKind(sourceEdge)}};
  };
  auto addFace=[&](const TopoDS_Face& sourceFace,const std::string& sourceRole) {
    const auto copyShape=copied.ModifiedShape(sourceFace);
    const auto mapped=copyShape.IsNull()?TopoDS_Shape{}:transformed.ModifiedShape(copyShape);
    std::string worldRole;
    if(mapped.IsNull()||!pickForMapped(mapped,worldFaces,&worldRole)) {
      (*errors)[instance.featureId+":"+sourceRole]="face transform history did not resolve uniquely";return;
    }
    const auto worldPick=instance.featureId+":"+worldRole;
    (*bindings)[worldPick]={{"type","face"},{"featureId",source.featureId},
        {"persistentFaceId",sourceRole},{"geometryKind",faceKind(sourceFace)}};
  };
  std::map<std::string,std::size_t> roleCounts;
  const auto edgeRoles=ClassifyEdgeRoles(source.shape,source.type,source.featureId);
  for(const auto& item:edgeRoles) {
    const auto cut=item.persistentEdgeId.find(':');
    ++roleCounts[cut==std::string::npos?item.persistentEdgeId:item.persistentEdgeId.substr(cut+1)];
  }
  for(const auto& item:edgeRoles) {
    const auto cut=item.persistentEdgeId.find(':');
    const auto role=cut==std::string::npos?item.persistentEdgeId:item.persistentEdgeId.substr(cut+1);
    if(roleCounts[role]!=1) {(*errors)[instance.featureId+":"+role]="source edge role is ambiguous";continue;}
    addEdge(item.edge,role);
  }
  roleCounts.clear();
  const auto faceRoles=ClassifyFaceRoles(source.shape,source.type,source.featureId);
  for(const auto& full:faceRoles) {
    const auto cut=full.find(':');
    ++roleCounts[cut==std::string::npos?full:full.substr(cut+1)];
  }
  for(const auto& full:faceRoles) {
    const auto cut=full.find(':');
    const auto role=cut==std::string::npos?full:full.substr(cut+1);
    if(roleCounts[role]!=1) {(*errors)[instance.featureId+":"+role]="source face role is ambiguous";continue;}
    TopoDS_Face sourceFace;
    if(!uniqueFaceByRole(source.shape,source.featureId,source.type,role,&sourceFace)) {
      (*errors)[instance.featureId+":"+role]="source face role is missing";continue;
    }
    addFace(sourceFace,role);
  }
  return true;
}

bool resolveStoredBinding(const nlohmann::json& value,const std::string& expectedOwner,
                          const std::string& consumer,AssemblyGeometrySelection* out,
                          std::string* error) {
  if(!value.is_object()) {fail(error,"stored source binding must be an object");return false;}
  const auto type=value.value("type",std::string{});
  const bool edge=type=="edge";
  if((!edge&&type!="face")||value.value("featureId",std::string{})!=expectedOwner) {
    fail(error,"stored source binding owner or topology kind does not match the instance source");return false;
  }
  const auto key=edge?"persistentEdgeId":"persistentFaceId";
  if(!value.contains(key)||!value.at(key).is_string()||!value.contains("geometryKind")||!value.at("geometryKind").is_string()||
     !value.contains("selectionEntry")||!value.at("selectionEntry").is_string()) {
    fail(error,"stored source binding is missing its native selectionEntry");return false;
  }
  const std::set<std::string> allowed={"type","featureId",key,"geometryKind","selectionEntry"};
  for(const auto& field:value.items())if(!allowed.count(field.key())) {
    fail(error,"stored source binding contains an unexpected field");return false;
  }
  if(value.size()!=allowed.size()) {fail(error,"stored source binding is incomplete");return false;}
  auto role=value.at(key).get<std::string>();
  if(role.rfind(expectedOwner+":",0)==0)role=role.substr(expectedOwner.size()+1);
  if(role.empty()) {fail(error,"stored source binding role is empty");return false;}
  ShapeRecord source;
  std::string reason;
  if(!GetCurrentShapeRecord(expectedOwner,&source,&reason)||source.shape.IsNull()) {fail(error,"stored source owner is unavailable: "+reason);return false;}
  const auto resolver=OcafLive::instance().DatumSourceResolver();
  TopoDS_Shape selected;
  const auto fullRole=expectedOwner+":"+role;
  if(!resolver||!resolver(value.at("selectionEntry").get<std::string>(),consumer,expectedOwner,fullRole,edge,&selected,&reason)) {
    fail(error,reason.empty()?"stored source binding needs repair":reason);return false;
  }
  NCollection_IndexedMap<TopoDS_Shape,TopTools_ShapeMapHasher> sourceEntities;
  TopExp::MapShapes(source.shape,edge?TopAbs_EDGE:TopAbs_FACE,sourceEntities);
  std::size_t matches=0;
  for(int index=1;index<=sourceEntities.Extent();++index)
    if(sourceEntities.FindKey(index).IsSame(selected))++matches;
  if(matches!=1) {
    if(HasIndexedTopologyRole(fullRole)) {fail(error,"stored indexed source binding needs repair; ordinal fallback is disabled");return false;}
    // Semantic roles may follow an identity-preserving parameter rebuild. Require
    // the exact role to remain unique; indexed roles never take this path.
    if(edge) {
      TopoDS_Edge semantic;
      if(!uniqueEdgeByRole(source.shape,expectedOwner,source.type,role,&semantic)) {
        fail(error,"stored semantic edge is absent or ambiguous in its source owner");return false;
      }
      selected=semantic;
    } else {
      TopoDS_Face semantic;
      if(!uniqueFaceByRole(source.shape,expectedOwner,source.type,role,&semantic)) {
        fail(error,"stored semantic face is absent or ambiguous in its source owner");return false;
      }
      selected=semantic;
    }
    matches=1;
  }
  const auto actualKind=edge?edgeKind(TopoDS::Edge(selected)):faceKind(TopoDS::Face(selected));
  const auto expectedKind=value.at("geometryKind").get<std::string>();
  if(actualKind!=expectedKind) {fail(error,"stored source geometry kind changed; repair is required");return false;}
  out->type=type;out->featureId=expectedOwner;out->persistentId=role;out->geometryKind=actualKind;
  out->selectionEntry=value.at("selectionEntry").get<std::string>();
  supportForSelected(selected,type,expectedOwner,role,actualKind,out);
  if(out->type.empty()) {fail(error,"stored source geometry is unsupported");return false;}
  return true;
}

using Vec3=std::array<double,3>;
using Mat3=std::array<std::array<double,3>,3>;
constexpr double kPi=3.1415926535897932384626433832795;
constexpr double kAngularTolerance=1e-8;

Vec3 vec(const std::array<double,3>& value) { return value; }
Vec3 add(const Vec3& a,const Vec3& b) { return {{a[0]+b[0],a[1]+b[1],a[2]+b[2]}}; }
Vec3 sub(const Vec3& a,const Vec3& b) { return {{a[0]-b[0],a[1]-b[1],a[2]-b[2]}}; }
Vec3 scale(const Vec3& a,double k) { return {{a[0]*k,a[1]*k,a[2]*k}}; }
double dot(const Vec3& a,const Vec3& b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
Vec3 cross(const Vec3& a,const Vec3& b) {
  return {{a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]}};
}
double norm(const Vec3& a) { return std::sqrt(dot(a,a)); }
bool unit(Vec3* value) {
  if(!value)return false;
  const double length=norm(*value);
  if(!std::isfinite(length)||length<1e-15)return false;
  *value=scale(*value,1.0/length);return true;
}
Mat3 identity() {
  Mat3 result{};for(int i=0;i<3;++i)result[i][i]=1;return result;
}
Mat3 multiply(const Mat3& a,const Mat3& b) {
  Mat3 result{};
  for(int i=0;i<3;++i)for(int j=0;j<3;++j)for(int k=0;k<3;++k)result[i][j]+=a[i][k]*b[k][j];
  return result;
}
Mat3 transpose(const Mat3& a) {
  Mat3 result{};for(int i=0;i<3;++i)for(int j=0;j<3;++j)result[i][j]=a[j][i];return result;
}
Vec3 rotate(const Mat3& a,const Vec3& v) {
  return {{a[0][0]*v[0]+a[0][1]*v[1]+a[0][2]*v[2],
           a[1][0]*v[0]+a[1][1]*v[1]+a[1][2]*v[2],
           a[2][0]*v[0]+a[2][1]*v[1]+a[2][2]*v[2]}};
}
Mat3 rotationForPose(const std::array<double,6>& pose) {
  const double toRad=kPi/180.0;
  const double x=pose[3]*toRad,y=pose[4]*toRad,z=pose[5]*toRad;
  Mat3 rx=identity(),ry=identity(),rz=identity();
  rx[1][1]=std::cos(x);rx[1][2]=-std::sin(x);rx[2][1]=std::sin(x);rx[2][2]=std::cos(x);
  ry[0][0]=std::cos(y);ry[0][2]=std::sin(y);ry[2][0]=-std::sin(y);ry[2][2]=std::cos(y);
  rz[0][0]=std::cos(z);rz[0][1]=-std::sin(z);rz[1][0]=std::sin(z);rz[1][1]=std::cos(z);
  return multiply(multiply(rz,ry),rx);
}
Mat3 rotationStep(const Vec3& angularDelta) {
  const double angle=norm(angularDelta);
  if(angle<1e-16)return identity();
  Vec3 axis=scale(angularDelta,1.0/angle);
  const double c=std::cos(angle),s=std::sin(angle),v=1-c;
  Mat3 result{};
  result[0][0]=axis[0]*axis[0]*v+c;result[0][1]=axis[0]*axis[1]*v-axis[2]*s;result[0][2]=axis[0]*axis[2]*v+axis[1]*s;
  result[1][0]=axis[1]*axis[0]*v+axis[2]*s;result[1][1]=axis[1]*axis[1]*v+c;result[1][2]=axis[1]*axis[2]*v-axis[0]*s;
  result[2][0]=axis[2]*axis[0]*v-axis[1]*s;result[2][1]=axis[2]*axis[1]*v+axis[0]*s;result[2][2]=axis[2]*axis[2]*v+c;
  return result;
}
double rotationDistance(const Mat3& a,const Mat3& b) {
  const Mat3 relative=multiply(transpose(a),b);
  const double cosine=std::max(-1.0,std::min(1.0,(relative[0][0]+relative[1][1]+relative[2][2]-1.0)*0.5));
  const Vec3 skew={{relative[2][1]-relative[1][2],relative[0][2]-relative[2][0],relative[1][0]-relative[0][1]}};
  return std::atan2(0.5*norm(skew),cosine);
}
double angleBetween(const Vec3& a,const Vec3& b) { return std::atan2(norm(cross(a,b)),std::max(-1.0,std::min(1.0,dot(a,b)))); }
Vec3 stablePerpendicular(const Vec3& direction) {
  int axis=0;
  if(std::abs(direction[1])<std::abs(direction[axis]))axis=1;
  if(std::abs(direction[2])<std::abs(direction[axis]))axis=2;
  Vec3 basis{{0,0,0}};basis[axis]=1;
  Vec3 result=cross(direction,basis);unit(&result);return result;
}
Mat3 minimumSwing(const Vec3& fromValue,const Vec3& toValue,const Mat3& current) {
  Vec3 from=fromValue,to=toValue;unit(&from);unit(&to);
  Vec3 axis=cross(from,to);const double sine=norm(axis);const double cosine=std::max(-1.0,std::min(1.0,dot(from,to)));
  if(sine<1e-15&&cosine>0)return current;
  if(sine<1e-15)axis=stablePerpendicular(from);else axis=scale(axis,1.0/sine);
  return multiply(rotationStep(scale(axis,std::atan2(sine,cosine))),current);
}

struct GeometricRelation {
  std::string id,kind;
  double targetAngle=0;
  AssemblyGeometrySelection moving,fixed;
  Mat3 fixedRotation=identity();
  Vec3 fixedTranslation{{0,0,0}},fixedDirection{{0,0,1}},fixedPoint{{0,0,0}};
};

double relationResidual(const GeometricRelation& relation,const Mat3& movingRotation) {
  Vec3 movingDirection=rotate(movingRotation,vec(relation.moving.direction));
  if(!unit(&movingDirection))return std::numeric_limits<double>::infinity();
  const double angle=angleBetween(movingDirection,relation.fixedDirection);
  if(relation.kind=="parallel"||relation.kind=="concentric")
    return dot(movingDirection,relation.fixedDirection)>=0?angle:angle-kPi;
  return angle-relation.targetAngle;
}
double orientationObjective(const std::vector<GeometricRelation>& relations,const Mat3& rotation) {
  double sum=0;for(const auto& relation:relations){const double r=relationResidual(relation,rotation);sum+=r*r;}return sum;
}
bool solve3(Mat3 matrix,Vec3 rhs,Vec3* solution) {
  if(!solution)return false;
  for(int col=0;col<3;++col) {
    int pivot=col;for(int row=col+1;row<3;++row)if(std::abs(matrix[row][col])>std::abs(matrix[pivot][col]))pivot=row;
    if(std::abs(matrix[pivot][col])<1e-24)return false;
    std::swap(matrix[col],matrix[pivot]);std::swap(rhs[col],rhs[pivot]);
    const double divisor=matrix[col][col];for(int j=col;j<3;++j)matrix[col][j]/=divisor;rhs[col]/=divisor;
    for(int row=0;row<3;++row)if(row!=col){const double factor=matrix[row][col];for(int j=col;j<3;++j)matrix[row][j]-=factor*matrix[col][j];rhs[row]-=factor*rhs[col];}
  }
  *solution=rhs;return true;
}
bool refineRotation(const std::vector<GeometricRelation>& relations,Mat3* rotation) {
  if(!rotation)return false;
  for(int iteration=0;iteration<80;++iteration) {
    double maximum=0;for(const auto& relation:relations)maximum=std::max(maximum,std::abs(relationResidual(relation,*rotation)));
    if(maximum<=kAngularTolerance)return true;
    Mat3 normal{};Vec3 rhs{{0,0,0}};
    for(const auto& relation:relations) {
      const double base=relationResidual(relation,*rotation);
      Vec3 row{};
      constexpr double step=1e-6;
      for(int axis=0;axis<3;++axis) {
        Vec3 delta{{0,0,0}};delta[axis]=step;
        const double plus=relationResidual(relation,multiply(rotationStep(delta),*rotation));
        delta[axis]=-step;
        const double minus=relationResidual(relation,multiply(rotationStep(delta),*rotation));
        row[axis]=(plus-minus)/(2*step);
      }
      for(int i=0;i<3;++i) {
        rhs[i]-=row[i]*base;
        for(int j=0;j<3;++j)normal[i][j]+=row[i]*row[j];
      }
    }
    for(int i=0;i<3;++i)normal[i][i]+=1e-12;
    Vec3 delta;
    if(!solve3(normal,rhs,&delta)||norm(delta)<1e-14)break;
    const double before=orientationObjective(relations,*rotation);
    bool accepted=false;
    for(double amount=1;amount>=1.0/256.0;amount*=0.5) {
      const Mat3 candidate=multiply(rotationStep(scale(delta,amount)),*rotation);
      if(orientationObjective(relations,candidate)<before-1e-24) {*rotation=candidate;accepted=true;break;}
    }
    if(!accepted)break;
  }
  for(const auto& relation:relations)if(std::abs(relationResidual(relation,*rotation))>kAngularTolerance)return false;
  return true;
}
void addSeed(std::vector<Mat3>* seeds,const Mat3& candidate) {
  if(!seeds)return;
  for(const auto& item:*seeds)if(rotationDistance(item,candidate)<1e-10)return;
  seeds->push_back(candidate);
}
bool basisForPair(Vec3 first,Vec3 second,Mat3* basis) {
  if(!basis||!unit(&first)||!unit(&second))return false;
  Vec3 orthogonal=sub(second,scale(first,dot(first,second)));
  if(!unit(&orthogonal))return false;
  const Vec3 third=cross(first,orthogonal);
  *basis=Mat3{};
  for(int i=0;i<3;++i){(*basis)[i][0]=first[i];(*basis)[i][1]=orthogonal[i];(*basis)[i][2]=third[i];}
  return true;
}
bool solveOrientation(const std::vector<GeometricRelation>& relations,const Mat3& current,Mat3* solved) {
  if(!solved)return false;
  std::vector<Mat3> seeds{current};
  for(const auto& relation:relations) {
    Vec3 moving=rotate(current,vec(relation.moving.direction));unit(&moving);
    if(relation.kind=="parallel"||relation.kind=="concentric") {
      for(double sign:{1.0,-1.0})addSeed(&seeds,minimumSwing(moving,scale(relation.fixedDirection,sign),current));
    } else {
      Vec3 tangent=sub(moving,scale(relation.fixedDirection,dot(moving,relation.fixedDirection)));
      if(!unit(&tangent))tangent=stablePerpendicular(relation.fixedDirection);
      const Vec3 target=add(scale(relation.fixedDirection,std::cos(relation.targetAngle)),scale(tangent,std::sin(relation.targetAngle)));
      addSeed(&seeds,minimumSwing(moving,target,current));
    }
  }
  for(std::size_t i=0;i<relations.size();++i)for(std::size_t j=i+1;j<relations.size();++j) {
    const auto& first=relations[i];const auto& second=relations[j];
    if((first.kind!="parallel"&&first.kind!="concentric")||(second.kind!="parallel"&&second.kind!="concentric"))continue;
    for(double signA:{1.0,-1.0})for(double signB:{1.0,-1.0}) {
      Mat3 movingBasis,fixedBasis;
      if(!basisForPair(vec(first.moving.direction),vec(second.moving.direction),&movingBasis)||
         !basisForPair(scale(first.fixedDirection,signA),scale(second.fixedDirection,signB),&fixedBasis))continue;
      addSeed(&seeds,multiply(fixedBasis,transpose(movingBasis)));
    }
  }
  double best=std::numeric_limits<double>::infinity();bool found=false;
  for(auto candidate:seeds) {
    if(!refineRotation(relations,&candidate))continue;
    const double score=rotationDistance(current,candidate);
    if(!found||score<best-1e-12) {*solved=candidate;best=score;found=true;}
    else if(std::abs(score-best)<=1e-12) {
      bool less=false;
      for(int i=0;i<3&&!less;++i)for(int j=0;j<3;++j) {
        if(candidate[i][j]<(*solved)[i][j]-1e-12){less=true;break;}
        if(candidate[i][j]>(*solved)[i][j]+1e-12)break;
      }
      if(less)*solved=candidate;
    }
  }
  return found;
}

double nearestAngle(double angle,double current) { return angle+360.0*std::round((current-angle)/360.0); }
bool poseForRotation(const Mat3& rotation,const std::array<double,6>& current,std::array<double,3>* euler) {
  if(!euler)return false;
  const double beta=std::atan2(-rotation[2][0],std::hypot(rotation[0][0],rotation[1][0]));
  const double cb=std::cos(beta);double alpha=0,gamma=0;
  if(std::abs(cb)>1e-10) {
    alpha=std::atan2(rotation[2][1],rotation[2][2]);
    gamma=std::atan2(rotation[1][0],rotation[0][0]);
  } else {
    gamma=current[5]*kPi/180.0;
    if(beta>=0)alpha=std::atan2(rotation[0][1],rotation[1][1])+gamma;
    else alpha=std::atan2(-rotation[0][1],rotation[1][1])-gamma;
  }
  const double toDeg=180.0/kPi;
  (*euler)[0]=nearestAngle(alpha*toDeg,current[3]);
  (*euler)[1]=nearestAngle(beta*toDeg,current[4]);
  (*euler)[2]=std::abs(cb)>1e-10?nearestAngle(gamma*toDeg,current[5]):current[5];
  std::array<double,6> check=current;check[3]=(*euler)[0];check[4]=(*euler)[1];check[5]=(*euler)[2];
  const Mat3 rebuilt=rotationForPose(check);
  double maximum=0;for(int i=0;i<3;++i)for(int j=0;j<3;++j)maximum=std::max(maximum,std::abs(rotation[i][j]-rebuilt[i][j]));
  return maximum<=1e-8;
}

struct LinearRow { Vec3 direction;double value=0;std::string id; };
bool projectTranslation(const Vec3& current,const std::vector<LinearRow>& rows,Vec3* result,std::string* error) {
  if(!result)return false;
  std::vector<Vec3> basis;std::vector<double> coefficients;
  for(const auto& row:rows) {
    Vec3 direction=row.direction;double value=row.value;
    const double length=norm(direction);
    if(!std::isfinite(length)||length<1e-15||!std::isfinite(value)){fail(error,row.id+": invalid translation equation");return false;}
    direction=scale(direction,1.0/length);value/=length;
    Vec3 residual=direction;double target=value-dot(direction,current);
    for(std::size_t i=0;i<basis.size();++i) {
      const double component=dot(direction,basis[i]);
      residual=sub(residual,scale(basis[i],component));target-=component*coefficients[i];
    }
    const double remainder=norm(residual);
    if(remainder<1e-12) {
      if(!AssemblyCoordinatesAgree(target,0.0)){fail(error,row.id+": conflicts with another translation requirement");return false;}
      continue;
    }
    basis.push_back(scale(residual,1.0/remainder));coefficients.push_back(target/remainder);
  }
  Vec3 projected=current;
  for(std::size_t i=0;i<basis.size();++i)projected=add(projected,scale(basis[i],coefficients[i]));
  for(const auto& row:rows)if(!AssemblyCoordinatesAgree(dot(row.direction,projected),row.value)) {
    fail(error,row.id+": translation residual exceeds physical tolerance");return false;
  }
  *result=projected;return true;
}

bool bindingMatchesSelection(const nlohmann::json& binding,const AssemblyGeometrySelection& selection,
                             const std::string& expectedOwner,std::string* error) {
  if(!binding.is_object()||selection.featureId!=expectedOwner||binding.value("featureId",std::string{})!=expectedOwner||
     binding.value("type",std::string{})!=selection.type||binding.value("geometryKind",std::string{})!=selection.geometryKind) {
    fail(error,"captured source selection does not match its source binding owner or analytic kind");return false;
  }
  const auto key=selection.type=="edge"?"persistentEdgeId":"persistentFaceId";
  if(!binding.contains(key)||!binding.at(key).is_string()||binding.at(key).get<std::string>()!=selection.persistentId) {
    fail(error,"captured source selection does not match its source binding identity");return false;
  }
  return true;
}

bool validateGeometryRelation(const GeometricRelation& relation,const Mat3& movingRotation,
                              const Vec3& movingTranslation,std::string* error) {
  const double angular=relationResidual(relation,movingRotation);
  if(!std::isfinite(angular)||std::abs(angular)>kAngularTolerance) {
    fail(error,relation.id+": unsatisfied "+relation.kind+" direction relation");return false;
  }
  if(relation.kind=="concentric") {
    const Vec3 movingPoint=add(rotate(movingRotation,vec(relation.moving.point)),movingTranslation);
    const Vec3 delta=sub(movingPoint,relation.fixedPoint);
    const double lineError=norm(cross(delta,relation.fixedDirection));
    if(!AssemblyCoordinatesAgree(lineError,0.0)) {fail(error,relation.id+": unsatisfied concentric axis lines");return false;}
  }
  return true;
}
#endif

}  // namespace

bool BuildAssemblyInstanceSourceBindings(const ShapeRecord& instance,
                                         AssemblySourceBindingMap* bindings,
                                         AssemblySourceBindingErrors* errors,
                                         std::string* error) {
#if KREODA_WITH_OCCT
  if(!bindings||!errors)return false;
  return buildBindingMap(instance,bindings,errors,error);
#else
  (void)instance;(void)bindings;(void)errors;fail(error,"geometric mates require OCCT");return false;
#endif
}

bool CaptureAssemblyGeometrySelection(const ShapeRecord& instance,
                                      const std::string& worldPickId,
                                      const nlohmann::json& claimedBinding,
                                      AssemblyGeometrySelection* selection,
                                      std::string* error) {
#if KREODA_WITH_OCCT
  if(!selection||instance.type!="Instance"||instance.dependsOn.size()!=1) {fail(error,"selected owner must be a live rigid instance");return false;}
  if(worldPickId.rfind(instance.featureId+":",0)!=0) {fail(error,"world pick does not belong to the named instance");return false;}
  AssemblySourceBindingMap bindings;
  AssemblySourceBindingErrors errors;
  if(!BuildAssemblyInstanceSourceBindings(instance,&bindings,&errors,error))return false;
  const auto found=bindings.find(worldPickId);
  if(found==bindings.end()) {
    const auto unavailable=errors.find(worldPickId);
    fail(error,unavailable==errors.end()?"world pick has no unique source transform-history mapping":unavailable->second);
    return false;
  }
  if(claimedBinding!=found->second) {fail(error,"sourceBinding does not match the current pick transform history");return false;}
  const auto& value=found->second;
  const auto owner=value.at("featureId").get<std::string>();
  if(owner!=instance.dependsOn.front()) {fail(error,"sourceBinding owner does not match the instance dependency");return false;}
  const auto type=value.at("type").get<std::string>();
  const auto key=type=="edge"?"persistentEdgeId":"persistentFaceId";
  const auto role=value.at(key).get<std::string>();
  ShapeRecord source;
  std::string reason;
  if(!GetCurrentShapeRecord(owner,&source,&reason)||source.shape.IsNull()) {fail(error,"instance source is unavailable: "+reason);return false;}
  *selection=AssemblyGeometrySelection{};
  supportFor(source.shape,source.type,type,owner,role,value.at("geometryKind").get<std::string>(),selection);
  if(selection->type.empty()) {fail(error,"source selection could not be resolved uniquely");return false;}
  return true;
#else
  (void)instance;(void)worldPickId;(void)claimedBinding;(void)selection;fail(error,"geometric mates require OCCT");return false;
#endif
}

bool BindAssemblyConstraintSources(const std::string& constraintId,
                                   nlohmann::json* constraint,
                                   std::string* error) {
  if(!constraint||!constraint->is_object()||!constraint->contains("movingSourceBinding")||!constraint->contains("fixedSourceBinding")) {
    fail(error,"geometric constraint source bindings are missing");return false;
  }
  nlohmann::json sources={{"moving",(*constraint)["movingSourceBinding"]},{"fixed",(*constraint)["fixedSourceBinding"]}};
  auto serialized=sources.dump();
  if(!OcafLive::instance().BindDatumSources("assembly/"+constraintId,&serialized,error))return false;
  try {
    sources=nlohmann::json::parse(serialized);
    (*constraint)["movingSourceBinding"]=std::move(sources.at("moving"));
    (*constraint)["fixedSourceBinding"]=std::move(sources.at("fixed"));
    return true;
  } catch(const std::exception& ex) {fail(error,ex.what());return false;}
}

bool PlanAssemblyGeometricConstraints(const nlohmann::json& document,
                                      AssemblyConstraintPlan* plan,
                                      bool requireCurrent,
                                      const AssemblyGeometryCaptures* captures,
                                      std::string* error) {
#if KREODA_WITH_OCCT
  if(!plan||!document.is_object()||!document.contains("constraints")||!document["constraints"].is_object()) {
    fail(error,"invalid assembly geometry plan input");return false;
  }
  std::map<std::string,std::vector<GeometricRelation>> byMoving;
  for(const auto& item:document["constraints"].items()) {
    const auto& value=item.value();
    if(!value.is_object()||!value.contains("kind")||!value["kind"].is_string())continue;
    const auto kind=value["kind"].get<std::string>();
    if(kind!="concentric"&&kind!="parallel"&&kind!="perpendicular"&&kind!="angle")continue;
    const std::string id=item.key();
    auto reject=[&](const std::string& why){fail(error,id+": "+why);return false;};
    if(!value.contains("movingId")||!value["movingId"].is_string()||!value.contains("fixedId")||!value["fixedId"].is_string()||
       !value.contains("movingSourceBinding")||!value.contains("fixedSourceBinding"))return reject("geometric constraint is incomplete");
    const auto movingId=value["movingId"].get<std::string>();
    const auto fixedId=value["fixedId"].get<std::string>();
    const auto grounded=plan->groundedPlacements.find(fixedId);
    if(grounded==plan->groundedPlacements.end())return reject("fixed instance must be grounded");
    ShapeRecord movingInstance,fixedInstance;
    if(!ShapeStore::instance().get(movingId,&movingInstance)||movingInstance.type!="Instance"||movingInstance.paramsMm.size()!=6||movingInstance.dependsOn.size()!=1)
      return reject("moving component must be a live rigid instance with one source dependency");
    if(!ShapeStore::instance().get(fixedId,&fixedInstance)||fixedInstance.type!="Instance"||fixedInstance.paramsMm.size()!=6||fixedInstance.dependsOn.size()!=1)
      return reject("fixed component must be a live rigid instance with one source dependency");

    AssemblyGeometrySelection movingSelection,fixedSelection;
    const auto capture=captures?captures->find(id):AssemblyGeometryCaptures::const_iterator{};
    if(captures&&capture!=captures->end()) {
      movingSelection=capture->second.moving;fixedSelection=capture->second.fixed;
      std::string reason;
      if(!bindingMatchesSelection(value["movingSourceBinding"],movingSelection,movingInstance.dependsOn.front(),&reason))return reject(reason);
      if(!bindingMatchesSelection(value["fixedSourceBinding"],fixedSelection,fixedInstance.dependsOn.front(),&reason))return reject(reason);
    } else {
      std::string reason;
      if(!resolveStoredBinding(value["movingSourceBinding"],movingInstance.dependsOn.front(),"assembly/"+id,&movingSelection,&reason))return reject("moving source binding: "+reason);
      if(!resolveStoredBinding(value["fixedSourceBinding"],fixedInstance.dependsOn.front(),"assembly/"+id,&fixedSelection,&reason))return reject("fixed source binding: "+reason);
    }
    if(kind=="concentric"&&(!movingSelection.hasAxisLine||!fixedSelection.hasAxisLine))
      return reject("concentric requires two cylindrical faces or circular edges");
    Vec3 movingDirection=vec(movingSelection.direction),fixedDirection=vec(fixedSelection.direction);
    if(!unit(&movingDirection)||!unit(&fixedDirection))return reject("selected support has no finite analytic direction");
    if(kind=="angle"&&(!value.contains("angleDeg")||!value["angleDeg"].is_number()||
       !std::isfinite(value["angleDeg"].get<double>())||value["angleDeg"].get<double>()<0||value["angleDeg"].get<double>()>180))
      return reject("angleDeg must be finite and between 0 and 180 degrees");
    GeometricRelation relation;relation.id=id;relation.kind=kind;
    relation.targetAngle=kind=="angle"?value["angleDeg"].get<double>()*kPi/180.0:(kind=="perpendicular"?kPi/2.0:0.0);
    relation.moving=movingSelection;relation.moving.direction=movingDirection;
    relation.fixed=fixedSelection;relation.fixed.direction=fixedDirection;
    std::array<double,6> fixedPose=grounded->second;
    relation.fixedRotation=rotationForPose(fixedPose);
    relation.fixedTranslation={{fixedPose[0],fixedPose[1],fixedPose[2]}};
    relation.fixedDirection=rotate(relation.fixedRotation,fixedDirection);
    relation.fixedPoint=add(rotate(relation.fixedRotation,vec(fixedSelection.point)),relation.fixedTranslation);
    if(!unit(&relation.fixedDirection))return reject("fixed support direction is invalid");
    byMoving[movingId].push_back(std::move(relation));
    plan->referencedInstances.insert(movingId);plan->referencedInstances.insert(fixedId);
  }

  for(auto& group:byMoving) {
    const auto& movingId=group.first;
    auto& relations=group.second;
    std::sort(relations.begin(),relations.end(),[](const auto& a,const auto& b){return a.id<b.id;});
    ShapeRecord instance;
    if(!ShapeStore::instance().get(movingId,&instance)||instance.paramsMm.size()!=6) {fail(error,movingId+": moving instance disappeared");return false;}
    std::array<double,6> currentPose{};
    std::copy(instance.paramsMm.begin(),instance.paramsMm.end(),currentPose.begin());
    const Vec3 currentTranslation{{currentPose[0],currentPose[1],currentPose[2]}};
    const Mat3 currentRotation=rotationForPose(currentPose);
    Mat3 candidateRotation=currentRotation;
    Vec3 candidateTranslation=currentTranslation;
    const auto groundedMoving=plan->groundedPlacements.find(movingId);
    if(requireCurrent) {
      for(const auto& relation:relations)if(!validateGeometryRelation(relation,currentRotation,currentTranslation,error))return false;
      continue;
    }
    if(groundedMoving!=plan->groundedPlacements.end()) {
      std::array<double,6> fixedPose=groundedMoving->second;
      for(std::size_t i=0;i<6;++i)if(!AssemblyCoordinatesAgree(currentPose[i],fixedPose[i])) {
        fail(error,movingId+": grounded component was moved");return false;
      }
      candidateRotation=rotationForPose(fixedPose);
      candidateTranslation={{fixedPose[0],fixedPose[1],fixedPose[2]}};
    } else {
      if(!solveOrientation(relations,currentRotation,&candidateRotation)) {
        fail(error,movingId+": geometric directions are conflicting or did not converge");return false;
      }
      std::vector<LinearRow> rows;
      const auto constrained=plan->constrained.find(movingId);
      if(constrained!=plan->constrained.end())for(int axis=0;axis<3;++axis)if(constrained->second[axis]) {
        Vec3 direction{{0,0,0}};direction[axis]=1;
        rows.push_back({direction,plan->placements[movingId][axis],"legacy placement"});
      }
      for(const auto& relation:relations)if(relation.kind=="concentric") {
        Vec3 normal=stablePerpendicular(relation.fixedDirection);
        Vec3 second=cross(relation.fixedDirection,normal);unit(&second);
        const Vec3 rotatedPoint=rotate(candidateRotation,vec(relation.moving.point));
        const Vec3 target=sub(relation.fixedPoint,rotatedPoint);
        rows.push_back({normal,dot(normal,target),relation.id});
        rows.push_back({second,dot(second,target),relation.id});
      }
      std::string translationError;
      if(!projectTranslation(currentTranslation,rows,&candidateTranslation,&translationError)) {
        fail(error,movingId+": "+translationError);return false;
      }
    }
    for(const auto& relation:relations)if(!validateGeometryRelation(relation,candidateRotation,candidateTranslation,error))return false;

    auto& planned=plan->placements[movingId];
    auto& constrained=plan->constrained[movingId];
    const bool changedRotation=rotationDistance(currentRotation,candidateRotation)>1e-12;
    if(changedRotation) {
      std::array<double,3> euler{};
      if(!poseForRotation(candidateRotation,currentPose,&euler)) {fail(error,movingId+": solved rotation cannot round-trip to ZYX Euler placement");return false;}
      for(int axis=0;axis<3;++axis){planned[axis+3]=euler[axis];constrained[axis+3]=true;}
    }
    for(int axis=0;axis<3;++axis) {
      planned[axis]=candidateTranslation[axis];
      constrained[axis]=true;
    }
  }
  return true;
#else
  (void)plan;(void)requireCurrent;(void)captures;
  if(document.is_object()&&document.contains("constraints")&&document["constraints"].is_object()) {
    for(const auto& item:document["constraints"].items()) {
      const auto& value=item.value();
      if(!value.is_object()||!value.contains("kind")||!value["kind"].is_string())continue;
      const auto kind=value["kind"].get<std::string>();
      if(kind=="concentric"||kind=="parallel"||kind=="perpendicular"||kind=="angle") {
        fail(error,"geometric mates require OCCT");return false;
      }
    }
  }
  return true;
#endif
}

}  // namespace kreoda
