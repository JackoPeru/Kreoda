#pragma once

#include "model/commit.h"
#include "model/shapes.h"
#include "model/geometry_availability.h"
#include "topology/face_roles.h"
#include <cmath>
#include <string>

#if KREODA_WITH_OCCT
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <Standard_Failure.hxx>
#include <gp_Vec.hxx>
#endif

namespace kreoda {

// Bounded surface thicken: independently solidify one planar B-Rep face along
// its oriented normal. The source solid is NOT fused, offset or modified.
// Curved offsets and standalone sheet-body ownership are not implemented.
#if KREODA_WITH_OCCT
inline bool BuildSurfaceFaceThicken(const ShapeRecord& source,
                                   const std::string& role,double thicknessMm,
                                   TopoDS_Shape* out,std::string* error) {
  auto fail=[&](const char* reason){if(error)*error=reason;return false;};
  if(!out || !std::isfinite(thicknessMm) || thicknessMm<=0 || thicknessMm>100000)
    return fail("thicknessMm must be finite and positive");
  if(source.shape.IsNull())return fail("missing source B-Rep");
  TopoDS_Face face;
  if(!FindFaceByRole(source.shape,source.featureId,source.type,role,&face))
    return fail("face role vanished or ambiguous");
  double origin[3],u[3],v[3],normal[3];
  if(!FaceFrameInfo(face,origin,u,v,normal))
    return fail("surface thicken requires one planar face");
  try {
    BRepPrimAPI_MakePrism prism(face,gp_Vec(normal[0]*thicknessMm,
      normal[1]*thicknessMm,normal[2]*thicknessMm));
    prism.Build();
    if(!prism.IsDone()||prism.Shape().IsNull()||
       !BRepCheck_Analyzer(prism.Shape()).IsValid())
      return fail("face thicken produced invalid B-Rep");
    int solids=0;
    for(TopExp_Explorer ex(prism.Shape(),TopAbs_SOLID);ex.More();ex.Next())++solids;
    if(solids!=1)return fail("face thicken must produce one solid");
    GProp_GProps volume;
    BRepGProp::VolumeProperties(prism.Shape(),volume);
    if(!std::isfinite(volume.Mass())||std::abs(volume.Mass())<=1e-8)
      return fail("face thicken has zero or invalid volume");
    if(volume.Mass()<0) {
      TopoDS_Shape fixed=prism.Shape();fixed.Reverse();*out=fixed;
    } else *out=prism.Shape();
    return true;
  } catch(const Standard_Failure& ex) {
    if(error)*error=ex.what();return false;
  }
}

inline bool CreateSurfaceFaceThickenFeature(const std::string& featureId,
    const std::string& sourceId,const std::string& faceRole,
    double thicknessMm,std::string* error) {
  if(!CheckNewId(featureId,error))return false;
  if(faceRole.empty()||faceRole.find('|')!=std::string::npos||
      HasIndexedTopologyRole(faceRole)) {
    if(error)*error="thicken requires stable semantic face role";return false;
  }
  ShapeRecord source;
  if(!GetCurrentShapeRecord(sourceId,&source,error))return false;
  TopoDS_Shape result;
  if(!BuildSurfaceFaceThicken(source,faceRole,thicknessMm,&result,error))return false;
  return CommitSingleFeature(featureId,"SurfaceFaceThicken",{thicknessMm},
                             {sourceId},faceRole,result,error);
}

inline bool RebuildSurfaceFaceThickenFromStore(const std::string& featureId,
                                              std::string* error) {
  ShapeRecord previous,source;
  if(!ShapeStore::instance().get(featureId,&previous)||
      previous.type!="SurfaceFaceThicken"||previous.dependsOn.size()!=1||
      previous.paramsMm.size()!=1||
      !GetCurrentShapeRecord(previous.dependsOn[0],&source,error)) {
    if(error&&error->empty())*error="invalid surface thicken history";
    return false;
  }
  TopoDS_Shape result;
  if(!BuildSurfaceFaceThicken(source,previous.refExtra,
                             previous.paramsMm[0],&result,error))return false;
  return CommitShape(featureId,previous.type,previous.paramsMm,previous.dependsOn,
                     previous.refExtra,result,&previous,false,error);
}
#else
inline bool CreateSurfaceFaceThickenFeature(const std::string&,const std::string&,
    const std::string&,double,std::string* error) {
  if(error)*error="surface thicken requires OCCT";return false;
}
inline bool RebuildSurfaceFaceThickenFromStore(const std::string&,std::string* error) {
  if(error)*error="surface thicken requires OCCT";return false;
}
#endif
}
