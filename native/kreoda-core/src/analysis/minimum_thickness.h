#pragma once

#include "../model/shapes.h"
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#if KREODA_WITH_OCCT
#include <BRepAdaptor_Surface.hxx>
#include <BRepBndLib.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepClass3d_SolidClassifier.hxx>
#include <BRepClass_FaceClassifier.hxx>
#include <BRepGProp.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <IntCurvesFace_ShapeIntersector.hxx>
#include <Precision.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <NCollection_IndexedMap.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS.hxx>
#include <gp_Lin.hxx>
#include <gp_Pnt2d.hxx>
#endif

namespace kreoda {
struct MinimumThicknessAnalysis {
  std::optional<double> minimumThicknessMm;
  std::array<double,3> pointAMm{}, pointBMm{};
  int solidCount=0,totalFaces=0,sampledFaces=0,attemptedSamples=0,validSamples=0;
  bool timeBudgetExceeded=false;
};

// Surface-normal chord sampling, not a certified global minimum. No tessellation,
// geometry update or dependence on display LOD. Unknown samples remain unknown.
inline bool MeasureMinimumThickness(const ShapeRecord& record, int maxSamples,
                                    MinimumThicknessAnalysis* output, std::string* error=nullptr) {
  auto fail=[&](const char* message) {if(error)*error=message;return false;};
  if(!output || maxSamples<32 || maxSamples>4096)return fail("Invalid thickness sample budget");
#if !KREODA_WITH_OCCT
  (void)record;return fail("Thickness analysis requires OCCT");
#else
  if(record.shape.IsNull() || !BRepCheck_Analyzer(record.shape,true).IsValid())
    return fail("Thickness analysis requires valid closed B-Rep solids");
  NCollection_IndexedMap<TopoDS_Shape,TopTools_ShapeMapHasher> solidMap,faceMap,solidFaces;
  TopExp::MapShapes(record.shape,TopAbs_SOLID,solidMap);
  TopExp::MapShapes(record.shape,TopAbs_FACE,faceMap);
  if(solidMap.Extent()==0)return fail("Thickness analysis requires closed solids, not surfaces");
  if(solidMap.Extent()>128 || faceMap.Extent()>4096)return fail("Selected geometry exceeds the bounded thickness analysis capacity");
  MinimumThicknessAnalysis measured;measured.solidCount=solidMap.Extent();measured.totalFaces=faceMap.Extent();
  struct SolidWork {
    BRepClass3d_SolidClassifier classifier;
    IntCurvesFace_ShapeIntersector rays;
    double extent=0,epsilon=0;
  };
  struct FaceWork {TopoDS_Face face;int solid;double u0=0,u1=0,v0=0,v1=0;bool usable=false,sampled=false;};
  std::vector<std::unique_ptr<SolidWork>> solids;
  std::vector<FaceWork> faces;
  for(int index=1;index<=solidMap.Extent();++index) {
    const auto& shape=solidMap(index);
    GProp_GProps volume;BRepGProp::VolumeProperties(shape,volume);
    if(!std::isfinite(volume.Mass()) || volume.Mass()<=0)return fail("Thickness analysis requires positively oriented closed solids");
    Bnd_Box box;BRepBndLib::AddOptimal(shape,box,false,false);
    if(box.IsVoid() || box.IsOpen())return fail("Thickness analysis requires finite bounds");
    double x0,y0,z0,x1,y1,z1;box.Get(x0,y0,z0,x1,y1,z1);
    auto work=std::make_unique<SolidWork>();
    work->extent=std::hypot(std::hypot(x1-x0,y1-y0),z1-z0);
    if(!std::isfinite(work->extent) || work->extent<=Precision::Confusion())return fail("Solid is below geometric resolution");
    double tolerance=Precision::Confusion();
    for(TopExp_Explorer ex(shape,TopAbs_FACE);ex.More();ex.Next()) {
      const auto face=TopoDS::Face(ex.Current());solidFaces.Add(face);
      tolerance=std::max(tolerance,BRep_Tool::Tolerance(face));
      FaceWork item;item.face=face;item.solid=index-1;
      BRepTools::UVBounds(face,item.u0,item.u1,item.v0,item.v1);
      item.usable=std::isfinite(item.u0)&&std::isfinite(item.u1)&&std::isfinite(item.v0)&&std::isfinite(item.v1)&&
        item.u1>item.u0&&item.v1>item.v0;
      faces.push_back(item);
    }
    work->epsilon=std::max(tolerance*20,work->extent*1e-10);
    work->classifier.Load(shape);work->rays.Load(shape,tolerance);
    solids.push_back(std::move(work));
  }
  if(solidFaces.Extent()!=faceMap.Extent())return fail("Mixed surface and solid geometry cannot be measured as a closed part");
  if(faces.size()>4096)return fail("Selected solid boundaries exceed the bounded thickness analysis capacity");
  measured.totalFaces=static_cast<int>(faces.size());
  // Low-discrepancy UV coverage, interleaved over faces so a small face is not
  // starved by an earlier large one. Trim checks retain the exact face domain.
  auto halton=[](int index,int base) {double value=0,fraction=1;while(index>0){fraction/=base;value+=fraction*(index%base);index/=base;}return value;};
  const auto started=std::chrono::steady_clock::now();
  for(int sample=0;sample<maxSamples;++sample) {
    if(std::chrono::steady_clock::now()-started>std::chrono::seconds(2)) {measured.timeBudgetExceeded=true;break;}
    auto& face=faces[static_cast<size_t>(sample)%faces.size()];
    auto& solid=*solids[face.solid];++measured.attemptedSamples;
    if(!face.usable)continue;
    const int step=sample/static_cast<int>(faces.size())+1;
    const double u=face.u0+(face.u1-face.u0)*halton(step,2),v=face.v0+(face.v1-face.v0)*halton(step,3);
    try {
      BRepClass_FaceClassifier domain(face.face,gp_Pnt2d(u,v),Precision::PConfusion());
      if(domain.State()!=TopAbs_IN)continue;
      BRepAdaptor_Surface surface(face.face,true);gp_Pnt origin;gp_Vec du,dv;
      surface.D1(u,v,origin,du,dv);gp_Vec normal=du.Crossed(dv);
      if(!std::isfinite(normal.SquareMagnitude()) || normal.SquareMagnitude()<=1e-24)continue;
      normal.Normalize();
      const auto positive=origin.Translated(normal*solid.epsilon),negative=origin.Translated(normal*(-solid.epsilon));
      solid.classifier.Perform(positive,solid.epsilon/20);const bool plusInside=solid.classifier.State()==TopAbs_IN;
      solid.classifier.Perform(negative,solid.epsilon/20);const bool minusInside=solid.classifier.State()==TopAbs_IN;
      if(plusInside==minusInside)continue;
      if(!plusInside)normal.Reverse();
      const gp_Lin ray(origin,gp_Dir(normal));
      solid.rays.Perform(ray,solid.epsilon/2,solid.extent+solid.epsilon);
      if(!solid.rays.IsDone())continue;
      solid.rays.SortResult();
      for(int hit=1;hit<=solid.rays.NbPnt();++hit) {
        const double distance=solid.rays.WParameter(hit);
        if(!std::isfinite(distance) || distance<=solid.epsilon)continue;
        solid.classifier.Perform(origin.Translated(normal*(distance+solid.epsilon)),solid.epsilon/20);
        if(solid.classifier.State()!=TopAbs_OUT) {
          if(solid.rays.Transition(hit)==IntCurveSurface_Tangent)continue;
          break; // Unresolved first crossing: never replace a thin cavity with a later outer wall.
        }
        ++measured.validSamples;
        if(!face.sampled) {face.sampled=true;++measured.sampledFaces;}
        if(!measured.minimumThicknessMm || distance<*measured.minimumThicknessMm) {
          measured.minimumThicknessMm=distance;
          measured.pointAMm={origin.X(),origin.Y(),origin.Z()};
          const auto endpoint=solid.rays.Pnt(hit);
          measured.pointBMm={endpoint.X(),endpoint.Y(),endpoint.Z()};
        }
        break; // First exit of THIS solid; never cross a cavity or another part.
      }
    } catch(const Standard_Failure&) { /* Failed sample is counted as missed, never zero. */ }
  }
  *output=measured;return true;
#endif
}
}
