#pragma once

#include <cmath>
#include <string>
#include "model/commit.h"
#include "model/shapes.h"
#include "model/geometry_availability.h"
#include "topology/face_roles.h"
#include "persistence/ocaf_live.h"

#if KREODA_WITH_OCCT
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <GProp_GProps.hxx>
#include <Standard_Failure.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <gp_Vec.hxx>
#endif

namespace kreoda {

// Bounded direct edit: push an exposed planar face OUTWARD along its world
// normal by a positive distance. Adds a prism then fuses it to the imported
// solid; not a general OCCT face replacement or negative offset solver.
#if KREODA_WITH_OCCT
inline bool BuildOutwardFacePush(const ShapeRecord& source,
                                const std::string& role,double distanceMm,
                                TopoDS_Shape* out,std::string* error) {
  if (!out || !(distanceMm>0 && distanceMm<=100000) || !std::isfinite(distanceMm)) {
    if (error) *error="outward face distance must be finite and positive"; return false;
  }
  if (source.shape.IsNull()) { if (error) *error="missing source B-Rep"; return false; }
  TopoDS_Face face;
  if (!FindFaceByRole(source.shape,source.featureId,source.type,role,&face)) {
    if (error) *error="face role vanished or ambiguous"; return false;
  }
  double origin[3],u[3],v[3],normal[3];
  if (!FaceFrameInfo(face,origin,u,v,normal)) {
    if (error) *error="direct push requires a planar face"; return false;
  }
  try {
    BRepPrimAPI_MakePrism prism(face,gp_Vec(normal[0]*distanceMm,normal[1]*distanceMm,normal[2]*distanceMm));
    prism.Build();
    if (!prism.IsDone()) { if (error) *error="face extrusion failed"; return false; }
    BRepAlgoAPI_Fuse fuse(source.shape,prism.Shape());
    fuse.Build();
    if (!fuse.IsDone() || fuse.Shape().IsNull() || !BRepCheck_Analyzer(fuse.Shape()).IsValid()) {
      if (error) *error="face fuse produced invalid B-Rep"; return false;
    }
    GProp_GProps oldProps,newProps;
    BRepGProp::VolumeProperties(source.shape,oldProps);
    BRepGProp::VolumeProperties(fuse.Shape(),newProps);
    if (!(newProps.Mass()>oldProps.Mass()+1e-6)) {
      if (error) *error="face push did not grow solid (face normal or overlap unsupported)"; return false;
    }
    int solids=0;
    for (TopExp_Explorer ex(fuse.Shape(),TopAbs_SOLID);ex.More();ex.Next()) ++solids;
    if (solids!=1) { if (error) *error="face push must produce one solid"; return false; }
    *out=fuse.Shape(); return true;
  } catch (const Standard_Failure& ex) { if (error) *error=ex.what(); return false; }
}

// A bounded imported-face pocket: cut a prism swept from a planar semantic
// face into its supporting solid. The normal sign is resolved by testing the
// two orientations against real OCCT volume, never guessed from face winding.
// This is a face-wide inward cut, NOT a general MoveFace or shell solver.
inline bool BuildInwardFacePocket(const ShapeRecord& source,
                                 const std::string& role,double depthMm,
                                 TopoDS_Shape* out,std::string* error) {
  if (!out || !std::isfinite(depthMm) || !(depthMm>0 && depthMm<=100000)) {
    if(error)*error="inward face depth must be finite and positive";return false;
  }
  if(source.shape.IsNull()) {if(error)*error="missing source B-Rep";return false;}
  TopoDS_Face face;
  if(!FindFaceByRole(source.shape,source.featureId,source.type,role,&face)) {
    if(error)*error="face role vanished or ambiguous";return false;
  }
  double origin[3],u[3],v[3],normal[3];
  if(!FaceFrameInfo(face,origin,u,v,normal)) {
    if(error)*error="inward face pocket requires planar face";return false;
  }
  try {
    GProp_GProps oldProps;
    BRepGProp::VolumeProperties(source.shape,oldProps);
    if(!(oldProps.Mass()>1e-6)) {if(error)*error="source must be solid";return false;}
    for(const double sign:{-1.0,1.0}) {
      BRepPrimAPI_MakePrism prism(face,gp_Vec(sign*normal[0]*depthMm,
          sign*normal[1]*depthMm,sign*normal[2]*depthMm));
      prism.Build();
      if(!prism.IsDone()||prism.Shape().IsNull())continue;
      BRepAlgoAPI_Cut cut(source.shape,prism.Shape());
      cut.Build();
      if(!cut.IsDone()||cut.Shape().IsNull()||!BRepCheck_Analyzer(cut.Shape()).IsValid())continue;
      int solids=0;
      for(TopExp_Explorer ex(cut.Shape(),TopAbs_SOLID);ex.More();ex.Next())++solids;
      if(solids!=1)continue;
      GProp_GProps newProps;
      BRepGProp::VolumeProperties(cut.Shape(),newProps);
      if(newProps.Mass()>1e-6 && newProps.Mass()<oldProps.Mass()-1e-6) {
        *out=cut.Shape();return true;
      }
    }
    if(error)*error="pocket must leave one valid solid with reduced volume";
    return false;
  }catch(const Standard_Failure& ex){if(error)*error=ex.what();return false;}
}

inline bool CreateInwardFacePocketFeature(const std::string& featureId,
                                         const std::string& sourceId,
                                         const std::string& faceRole,
                                         double depthMm,std::string* error) {
  if(!CheckNewId(featureId,error))return false;
  if(faceRole.empty()||faceRole.find('|')!=std::string::npos||HasIndexedTopologyRole(faceRole)) {
    if(error)*error="face role must be stable semantic reference";return false;
  }
  ShapeRecord source;
  if(!GetCurrentShapeRecord(sourceId,&source,error))return false;
  TopoDS_Shape result;
  if(!BuildInwardFacePocket(source,faceRole,depthMm,&result,error))return false;
  return CommitSingleFeature(featureId,"InwardFacePocket",{depthMm},{sourceId},faceRole,result,error);
}

inline bool RebuildInwardFacePocketFromStore(const std::string& featureId,std::string* error) {
  ShapeRecord rec,source;
  if(!ShapeStore::instance().get(featureId,&rec)||rec.type!="InwardFacePocket"||
      rec.dependsOn.size()!=1||rec.paramsMm.size()!=1||
      !GetCurrentShapeRecord(rec.dependsOn[0],&source,error)) {
    if(error&&error->empty())*error="invalid inward face pocket dependencies";return false;
  }
  TopoDS_Shape result;
  if(!BuildInwardFacePocket(source,rec.refExtra,rec.paramsMm[0],&result,error))return false;
  return CommitShape(featureId,rec.type,rec.paramsMm,rec.dependsOn,rec.refExtra,result,&rec,false,error);
}

inline bool CreateOutwardFacePushFeature(const std::string& featureId,
                                        const std::string& sourceId,
                                        const std::string& faceRole,
                                        double distanceMm,std::string* error) {
  if (!CheckNewId(featureId,error)) return false;
  if (faceRole.empty() || faceRole.find('|')!=std::string::npos) {
    if (error) *error="invalid face role"; return false;
  }
  if (HasIndexedTopologyRole(faceRole)) {
    if (error) *error="indexed face roles are not stable; choose a semantic face";
    return false;
  }
  ShapeRecord source;
  if (!GetCurrentShapeRecord(sourceId,&source,error)) return false;
  TopoDS_Shape result;
  if (!BuildOutwardFacePush(source,faceRole,distanceMm,&result,error)) return false;
  return CommitSingleFeature(featureId,"OutwardFacePush",{distanceMm},{sourceId},faceRole,result,error);
}

inline bool RebuildOutwardFacePushFromStore(const std::string& featureId,std::string* error) {
  ShapeRecord rec,source;
  if (!ShapeStore::instance().get(featureId,&rec) || rec.type!="OutwardFacePush" ||
      rec.dependsOn.size()!=1 || rec.paramsMm.size()!=1 ||
      !GetCurrentShapeRecord(rec.dependsOn[0],&source,error)) {
    if (error && error->empty()) *error="invalid face push feature dependencies"; return false;
  }
  TopoDS_Shape result;
  if (!BuildOutwardFacePush(source,rec.refExtra,rec.paramsMm[0],&result,error)) return false;
  return CommitShape(featureId,rec.type,rec.paramsMm,rec.dependsOn,rec.refExtra,result,&rec,false,error);
}
#else
inline bool CreateOutwardFacePushFeature(const std::string&,const std::string&,
                                        const std::string&,double,std::string* error) {
  if (error) *error="direct B-Rep edit requires OCCT"; return false;
}
inline bool RebuildOutwardFacePushFromStore(const std::string&,std::string* error) {
  if (error) *error="direct B-Rep edit requires OCCT"; return false;
}
inline bool CreateInwardFacePocketFeature(const std::string&,const std::string&,
    const std::string&,double,std::string* error) {
  if(error)*error="direct B-Rep edit requires OCCT";return false;
}
inline bool RebuildInwardFacePocketFromStore(const std::string&,std::string* error) {
  if(error)*error="direct B-Rep edit requires OCCT";return false;
}
#endif
} // namespace kreoda
