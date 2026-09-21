#include "ocaf_live.h"

#include <iomanip>
#include <map>
#include <sstream>

#include "../diagnostics/log.h"
#include "../document/document_store.h"
#include "../expressions/expressions.h"
#include "../features/sketch/sketch_json.h"
#include "../features/sketch/sketch_store.h"
#include "../model/body.h"

#if KREODA_WITH_OCCT
#include <BinXCAFDrivers.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepBndLib.hxx>
#include <BRepGProp.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <PCDM.hxx>
#include <PCDM_StoreStatus.hxx>
#include <Standard_Failure.hxx>
#include <TCollection_AsciiString.hxx>
#include <TCollection_ExtendedString.hxx>
#include <TDF_ChildIterator.hxx>
#include <TDF_Label.hxx>
#include <TDF_Tool.hxx>
#include <TNaming_Builder.hxx>
#include <TNaming_NamedShape.hxx>
#include <TNaming_Selector.hxx>
#include <TNaming_Tool.hxx>
#include <TDataStd_Comment.hxx>
#include <TDataStd_Name.hxx>
#include <TDocStd_Application.hxx>
#include <TDocStd_Document.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>

#include "../topology/face_roles.h"
#endif

namespace kreoda {

OcafLive& OcafLive::instance() {
  static OcafLive live;
  return live;
}

#if KREODA_WITH_OCCT
struct OcafLive::Ocaf {
  Handle(TDocStd_Application) app;
  Handle(TDocStd_Document) doc;
  Handle(XCAFDoc_ShapeTool) shapes;
  TDF_Label selectionsRoot;
  TDF_Label sketchesRoot;
  TDF_Label expressionsRoot;
  std::map<std::string, TDF_Label> featureLabels;
  std::map<std::string, TDF_Label> sketchLabels;
  std::map<std::string, TDF_Label> expressionLabels;
};

namespace {

std::string EncodeParams(const std::string& type,
                         const std::vector<double>& params,
                         const std::vector<std::string>& deps,
                         const std::string& refExtra) {
  std::ostringstream os;
  os << std::setprecision(17);  // full round-trip precision, not 6-digit
  os << type;
  for (double p : params) {
    os << "|";
    os << p;
  }
  std::string s = os.str();
  if (!deps.empty()) {
    s += "|@deps=";
    for (size_t i = 0; i < deps.size(); ++i) {
      if (i) s += ",";
      s += deps[i];
    }
  }
  if (!refExtra.empty()) {
    s += "|@ref=";
    s += refExtra;
  }
  return s;
}

bool DecodeParams(const std::string& s, std::string* type,
                  std::vector<double>* params,
                  std::vector<std::string>* deps, std::string* refExtra) {
  const size_t pos = s.find('|');
  if (pos == std::string::npos) {
    // Bare type with no params (tolerated for forward-compat).
    *type = s;
    params->clear();
    if (deps) deps->clear();
    return !type->empty();
  }
  *type = s.substr(0, pos);
  params->clear();
  if (deps) deps->clear();
  if (refExtra) refExtra->clear();
  size_t start = pos + 1;
  while (start <= s.size()) {
    const size_t end = s.find('|', start);
    const std::string tok = s.substr(
        start, end == std::string::npos ? end : end - start);
    if (tok.rfind("@deps=", 0) == 0) {
      if (deps) {
        const std::string list = tok.substr(6);
        size_t ds = 0;
        while (ds <= list.size()) {
          const size_t de = list.find(',', ds);
          const std::string d = list.substr(
              ds, de == std::string::npos ? de : de - ds);
          if (!d.empty()) deps->push_back(d);
          if (de == std::string::npos) break;
          ds = de + 1;
        }
      }
    } else if (!tok.empty()) {
      if (tok.rfind("@ref=", 0) == 0) {
        // Consumed by the ref pass below; not a numeric param.
      } else {
        try {
          params->push_back(std::stod(tok));
        } catch (...) {
          return false;
        }
      }
    }
    if (end == std::string::npos) break;
    start = end + 1;
  }
  // @ref= may contain '=' padding? No — refExtra holds roles/ids without '|';
  // a second pass extracts it (kept separate for clarity, single scan above
  // already consumed all tokens; re-scan for the ref token).
  if (refExtra) {
    const std::string marker = "|@ref=";
    const size_t rp = s.find(marker);
    if (rp != std::string::npos) {
      size_t re = s.find('|', rp + marker.size());
      *refExtra = s.substr(rp + marker.size(),
                           re == std::string::npos ? re : re - rp - marker.size());
    }
  }
  return !type->empty();
}

std::string ExtToAscii(const TCollection_ExtendedString& xs) {
  std::string out;
  out.reserve(static_cast<size_t>(xs.Length()));
  for (Standard_Integer i = 1; i <= xs.Length(); ++i) {
    const Standard_ExtCharacter c = xs.Value(i);
    out.push_back(c < 128 ? static_cast<char>(c) : '?');
  }
  return out;
}

// See RecordFromLabel: per-face TNaming evolution makes GetShape resolve to
// a face compound instead of the solid — unwrap the single solid so every
// resync/load/undo/redo adopts real solids for downstream booleans.
// M5: a faces-only compound (0 solids) is never a valid feature — callers
// cull it via the empty record. Multi-solid compounds are left untouched
// (possible legit boolean results; cutting them is out of scope).
TopoDS_Shape ResolveSolid(const TopoDS_Shape& shape, bool* culled) {
  if (culled) *culled = false;
  if (shape.IsNull()) return shape;
  if (shape.ShapeType() == TopAbs_SOLID) return shape;
  TopoDS_Shape found;
  int count = 0;
  for (TopExp_Explorer ex(shape, TopAbs_SOLID); ex.More(); ex.Next()) {
    if (++count > 1) return shape;  // exotic: leave untouched
    found = ex.Current();
  }
  if (count == 1) return found;
  if (culled) *culled = true;
  return TopoDS_Shape();
}

ShapeRecord RecordFromLabel(const TDF_Label& label,
                            const Handle(XCAFDoc_ShapeTool)& shapes) {
  ShapeRecord rec;
  // Name+Comment first: selection labels (TNaming_Selector references) carry
  // no Name and are skipped silently here — they must not trip the
  // faces-only cull below (a bare face legitimately holds no solids).
  Handle(TDataStd_Name) name;
  Handle(TDataStd_Comment) comment;
  if (!label.FindAttribute(TDataStd_Name::GetID(), name) ||
      !label.FindAttribute(TDataStd_Comment::GetID(), comment)) {
    return rec;
  }
  // Phase 10 (torture find): a feature label carrying per-face TNaming
  // evolution (recorded on every parametric rebuild) resolves via GetShape
  // to a COMPOUND of the current faces instead of the solid. Bbox, volume
  // and face areas all look identical, yet downstream B-Rep booleans on the
  // compound silently cut wrong geometry after any Undo/Redo/Open. Unwrap
  // the single solid; exotic multi-solid shapes are left untouched.
  bool culled = false;
  TopoDS_Shape shape = ResolveSolid(shapes->GetShape(label), &culled);
  if (culled) {
    LogCore("ocaf: culling faces-only compound (no solid to adopt)");
    return rec;
  }
  if (shape.IsNull()) return rec;
  std::string type;
  std::vector<double> params;
  std::vector<std::string> deps;
  std::string refExtra;
  if (!DecodeParams(ExtToAscii(comment->Get()), &type, &params, &deps,
                    &refExtra)) {
    return rec;
  }
  rec.featureId = ExtToAscii(name->Get());
  if (rec.featureId.empty()) return rec;
  rec.type = type;
  rec.paramsMm = params;
  rec.dependsOn = deps;
  rec.refExtra = refExtra;
  rec.shape = shape;
  GProp_GProps props;
  BRepGProp::VolumeProperties(shape, props);
  rec.volumeMm3 = props.Mass();
  Bnd_Box box;
  BRepBndLib::Add(shape, box);
  box.Get(rec.bboxMm[0], rec.bboxMm[1], rec.bboxMm[2], rec.bboxMm[3],
          rec.bboxMm[4], rec.bboxMm[5]);
  return rec;
}

}  // namespace
#endif

void OcafLive::Reset() {
#if KREODA_WITH_OCCT
  delete ocaf_;
  ocaf_ = new Ocaf();
  ocaf_->app = new TDocStd_Application;
  BinXCAFDrivers::DefineFormat(ocaf_->app);
  ocaf_->app->NewDocument("BinXCAF", ocaf_->doc);
  // Undo is disabled by default in OCAF — one delta per command, cap 100.
  ocaf_->doc->SetUndoLimit(100);
  ocaf_->doc->ClearUndos();
  ocaf_->doc->ClearRedos();
  ocaf_->shapes = XCAFDoc_DocumentTool::ShapeTool(ocaf_->doc->Main());
  ocaf_->selectionsRoot = ocaf_->doc->Main().NewChild();
  TDataStd_Name::Set(ocaf_->selectionsRoot, "Selections");
  ocaf_->sketchesRoot = ocaf_->doc->Main().NewChild();
  TDataStd_Name::Set(ocaf_->sketchesRoot, "Sketches");
  ocaf_->expressionsRoot = ocaf_->doc->Main().NewChild();
  TDataStd_Name::Set(ocaf_->expressionsRoot, "Expressions");
#endif
  // A fresh document owns no transaction (crash-safe by construction:
  // Reset drops the OCAF doc, so no half-open command can survive it).
  joinTxn_ = false;
  txnTainted_ = false;
  txnOwner_.clear();
}

bool OcafLive::BeginCommand(std::string* error) {
#if KREODA_WITH_OCCT
  // §11.12: inside a session transaction every feature op joins the one
  // open OCAF command instead of opening its own (one Undo step for N ops).
  if (joinTxn_) return true;
  if (!ocaf_ || ocaf_->doc.IsNull()) Reset();
  if (ocaf_->doc->HasOpenCommand()) {
    if (error) *error = "nested OCAF command (single queue, §40)";
    return false;
  }
  // A new command invalidates the redo stack — standard undo semantics.
  ocaf_->doc->ClearRedos();
  ocaf_->doc->OpenCommand();
  return true;
#else
  if (error) *error = "OCAF requires OCCT (link via vcpkg)";
  return false;
#endif
}

bool OcafLive::CommitCommand(bool* hadDelta, std::string* error) {
#if KREODA_WITH_OCCT
  // §11.12: joined ops defer the real commit to CommitTransaction.
  if (joinTxn_) {
    if (hadDelta) *hadDelta = false;
    return true;
  }
  if (!ocaf_ || !ocaf_->doc->HasOpenCommand()) {
    if (error) *error = "no open OCAF command";
    return false;
  }
  const bool added = ocaf_->doc->CommitCommand();
  if (hadDelta) *hadDelta = added;
  return true;
#else
  (void)hadDelta;
  if (error) *error = "OCAF requires OCCT (link via vcpkg)";
  return false;
#endif
}

void OcafLive::AbortCommand() {
#if KREODA_WITH_OCCT
  // §11.12: a failed step inside a transaction must NOT abort the whole
  // command (the client decides commit vs rollback); it only taints, so a
  // later commit auto-rolls-back instead of silently keeping partial work.
  // Store-level pre-images are still restored by the failing op itself.
  if (joinTxn_) {
    txnTainted_ = true;
    return;
  }
  if (ocaf_ && ocaf_->doc->HasOpenCommand()) ocaf_->doc->AbortCommand();
#endif
}

bool OcafLive::BeginTransaction(const std::string& transactionId,
                                std::string* error) {
#if KREODA_WITH_OCCT
  if (transactionId.empty()) {
    if (error) *error = "transactionId is required";
    return false;
  }
  if (joinTxn_) {
    if (error) {
      *error = "transaction already open (" + txnOwner_ +
               ") — commit or roll it back first";
    }
    return false;
  }
  if (!ocaf_ || ocaf_->doc.IsNull()) Reset();
  if (ocaf_->doc->HasOpenCommand()) {
    if (error) *error = "nested OCAF command (single queue, §40)";
    return false;
  }
  // One user-level action == one Undo delta: clear redos once, at the edge.
  ocaf_->doc->ClearRedos();
  ocaf_->doc->OpenCommand();
  joinTxn_ = true;
  txnTainted_ = false;
  txnOwner_ = transactionId;
  return true;
#else
  (void)transactionId;
  if (error) *error = "OCAF requires OCCT (link via vcpkg)";
  return false;
#endif
}

bool OcafLive::CommitTransaction(const std::string& transactionId,
                                 bool* hadDelta, std::string* error) {
#if KREODA_WITH_OCCT
  if (!joinTxn_) {
    if (error) *error = "no open transaction";
    return false;
  }
  if (transactionId != txnOwner_) {
    if (error) *error = "not the transaction owner";
    return false;
  }
  joinTxn_ = false;
  const bool tainted = txnTainted_;
  txnTainted_ = false;
  txnOwner_.clear();
  if (tainted) {
    // A step failed mid-transaction: never commit partial work — roll the
    // whole command back and say so honestly.
    if (ocaf_ && ocaf_->doc->HasOpenCommand()) ocaf_->doc->AbortCommand();
    std::string rsErr;
    ResyncStore(&rsErr);
    if (error) *error = "transaction had a failed step — rolled back";
    if (hadDelta) *hadDelta = false;
    return false;
  }
  if (!ocaf_ || !ocaf_->doc->HasOpenCommand()) {
    if (error) *error = "no open OCAF command";
    return false;
  }
  const bool added = ocaf_->doc->CommitCommand();
  if (hadDelta) *hadDelta = added;
  return true;
#else
  (void)transactionId;
  (void)hadDelta;
  if (error) *error = "OCAF requires OCCT (link via vcpkg)";
  return false;
#endif
}

bool OcafLive::RollbackTransaction(const std::string& transactionId,
                                   std::string* error) {
#if KREODA_WITH_OCCT
  if (!joinTxn_) {
    if (error) *error = "no open transaction";
    return false;
  }
  if (transactionId != txnOwner_) {
    if (error) *error = "not the transaction owner";
    return false;
  }
  joinTxn_ = false;
  txnTainted_ = false;
  txnOwner_.clear();
  if (ocaf_ && ocaf_->doc->HasOpenCommand()) ocaf_->doc->AbortCommand();
  // Uncommitted store puts from joined ops must go too: rebuild the store
  // (and label maps) from the live doc like any other abort path (C7).
  if (!ResyncStore(error)) return false;
  return true;
#else
  (void)transactionId;
  if (error) *error = "OCAF requires OCCT (link via vcpkg)";
  return false;
#endif
}

void OcafLive::ForgetFeatures(const std::vector<std::string>& featureIds) {
#if KREODA_WITH_OCCT
  if (!ocaf_) return;
  for (const auto& fid : featureIds) {
    ocaf_->featureLabels.erase(fid);
    ocaf_->expressionLabels.erase(fid);
    ocaf_->sketchLabels.erase(fid);
  }
#else
  (void)featureIds;
#endif
}

bool OcafLive::Undo(std::string* error) {
#if KREODA_WITH_OCCT
  if (!ocaf_ || ocaf_->doc.IsNull()) {
    if (error) *error = "no live document";
    return false;
  }
  if (ocaf_->doc->GetAvailableUndos() == 0) {
    if (error) *error = "nothing to undo";
    return false;
  }
  if (!ocaf_->doc->Undo()) {
    if (error) *error = "OCAF undo failed";
    return false;
  }
  return ResyncStore(error);
#else
  if (error) *error = "OCAF requires OCCT (link via vcpkg)";
  return false;
#endif
}

bool OcafLive::Redo(std::string* error) {
#if KREODA_WITH_OCCT
  if (!ocaf_ || ocaf_->doc.IsNull()) {
    if (error) *error = "no live document";
    return false;
  }
  if (ocaf_->doc->GetAvailableRedos() == 0) {
    if (error) *error = "nothing to redo";
    return false;
  }
  if (!ocaf_->doc->Redo()) {
    if (error) *error = "OCAF redo failed";
    return false;
  }
  return ResyncStore(error);
#else
  if (error) *error = "OCAF requires OCCT (link via vcpkg)";
  return false;
#endif
}

int OcafLive::AvailableUndos() const {
#if KREODA_WITH_OCCT
  if (!ocaf_ || ocaf_->doc.IsNull()) return 0;
  return ocaf_->doc->GetAvailableUndos();
#else
  return 0;
#endif
}

int OcafLive::AvailableRedos() const {
#if KREODA_WITH_OCCT
  if (!ocaf_ || ocaf_->doc.IsNull()) return 0;
  return ocaf_->doc->GetAvailableRedos();
#else
  return 0;
#endif
}

bool OcafLive::ResyncStore(std::string* error) {
#if KREODA_WITH_OCCT
  if (!ocaf_ || ocaf_->doc.IsNull()) {
    if (error) *error = "no live document";
    return false;
  }
  ocaf_->shapes = XCAFDoc_DocumentTool::ShapeTool(ocaf_->doc->Main());
  ocaf_->featureLabels.clear();
  ocaf_->sketchLabels.clear();
  ShapeStore::instance().clear();
  std::map<std::string, std::string> registry;
  NCollection_Sequence<TDF_Label> free;
  ocaf_->shapes->GetFreeShapes(free);
  // First pass: collect all candidates so Instance targets can be validated
  // against the full set (C8: nested/self/missing targets never load).
  std::vector<std::pair<ShapeRecord, TDF_Label>> candidates;
  for (int i = 1; i <= free.Length(); ++i) {
    const ShapeRecord rec = RecordFromLabel(free.Value(i), ocaf_->shapes);
    if (rec.featureId.empty() || rec.shape.IsNull()) continue;
    if (!BRepCheck_Analyzer(rec.shape).IsValid(rec.shape)) continue;
    candidates.emplace_back(rec, free.Value(i));
  }
  std::map<std::string, std::string> typeById;
  for (const auto& [rec, lab] : candidates) typeById[rec.featureId] = rec.type;
  for (const auto& [rec, lab] : candidates) {
    if (rec.type == "Instance") {
      bool bad = false;
      std::string why;
      if (rec.dependsOn.size() != 1) {
        bad = true; why = "Instance needs exactly one target";
      } else if (rec.dependsOn[0] == rec.featureId) {
        bad = true; why = "Instance cannot target itself";
      } else {
        auto tit = typeById.find(rec.dependsOn[0]);
        if (tit == typeById.end()) {
          bad = true; why = "Instance target missing: " + rec.dependsOn[0];
        } else if (tit->second == "Instance") {
          bad = true; why = "nested instances are not supported";
        }
      }
      if (bad) {
        LogCore("ocaf: dropping invalid Instance " + rec.featureId + ": " + why);
        continue;
      }
    }
    ocaf_->featureLabels[rec.featureId] = lab;
    ShapeStore::instance().put(rec);
    registry[rec.featureId] = rec.type;
  }
  // Re-adopt selections + sketches + expressions folders (same scan as Load).
  for (TDF_ChildIterator it(ocaf_->doc->Main(), Standard_False); it.More();
       it.Next()) {
    Handle(TDataStd_Name) n;
    if (!it.Value().FindAttribute(TDataStd_Name::GetID(), n)) continue;
    const std::string nm = ExtToAscii(n->Get());
    if (nm == "Selections") {
      ocaf_->selectionsRoot = it.Value();
    } else if (nm == "Sketches") {
      ocaf_->sketchesRoot = it.Value();
    } else if (nm == "Expressions") {
      ocaf_->expressionsRoot = it.Value();
    }
  }
  // Rebuild SketchStore from sketch labels (inside Sketches folder).
  SketchStore::instance().clear();
  if (!ocaf_->sketchesRoot.IsNull()) {
    for (TDF_ChildIterator it(ocaf_->sketchesRoot, Standard_False); it.More();
         it.Next()) {
      Handle(TDataStd_Name) n;
      Handle(TDataStd_Comment) c;
      if (!it.Value().FindAttribute(TDataStd_Name::GetID(), n) ||
          !it.Value().FindAttribute(TDataStd_Comment::GetID(), c)) {
        continue;
      }
      const std::string sid = ExtToAscii(n->Get());
      if (sid.empty()) continue;
      ocaf_->sketchLabels[sid] = it.Value();
      // JSON lives in the comment as plain ASCII (sketch ids are ASCII).
      const std::string js = ExtToAscii(c->Get());
      if (!js.empty()) {
        SketchFeature sf;
        std::string perr;
        if (ParseSketchFeature(js, &sf, &perr) && !sf.id.empty()) {
          SketchStore::instance().put(std::move(sf));
          registry[sid] = "Sketch";
        } else {
          LogCore("ocaf: sketch label did not parse: " + sid);
        }
      }
    }
  }
  // Whole-registry replace: stale (undone/deleted) entries vanish (§12).
  DocumentStore::instance().replaceAll(registry);
  // Slice 2: bodies are derived from history order — Undo/Redo/Open resyncs
  // rebuild them deterministically (same rule as legacy-file migration).
  BodyStore::instance().rebuildFromRecords(
      ShapeStore::instance().listInOrder());
  // Rebuild the expression registry from expression labels (formulas undo
  // and reopen with geometry — same guarantee as sketches).
  // M8: orphan expressions for culled shapes are dropped, never adopted.
  ExpressionStore::instance().clear();
  ocaf_->expressionLabels.clear();
  if (!ocaf_->expressionsRoot.IsNull()) {
    for (TDF_ChildIterator it(ocaf_->expressionsRoot, Standard_False);
         it.More(); it.Next()) {
      Handle(TDataStd_Name) n;
      Handle(TDataStd_Comment) c;
      if (!it.Value().FindAttribute(TDataStd_Name::GetID(), n) ||
          !it.Value().FindAttribute(TDataStd_Comment::GetID(), c)) {
        continue;
      }
      const std::string fid = ExtToAscii(n->Get());
      if (fid.empty()) continue;
      if (registry.find(fid) == registry.end()) {
        LogCore("ocaf: dropping orphan expressions for culled shape: " + fid);
        continue;
      }
      ocaf_->expressionLabels[fid] = it.Value();
      std::map<std::string, std::string> entries;
      std::string perr;
      if (ParseExpressionMap(ExtToAscii(c->Get()), &entries, &perr) &&
          !entries.empty()) {
        ExpressionStore::instance().setFeatureMap(fid, entries);
      } else if (!perr.empty()) {
        LogCore("ocaf: expression label did not parse: " + fid);
      }
    }
  }
  return true;
#else
  if (error) *error = "OCAF requires OCCT (link via vcpkg)";
  return false;
#endif
}

bool OcafLive::UpsertFeature(const ShapeRecord& rec, bool isNew,
                             std::string* error) {
#if KREODA_WITH_OCCT
  try {
    if (!ocaf_ || ocaf_->doc.IsNull()) Reset();
    if (ocaf_->doc.IsNull()) {
      if (error) *error = "OCAF: no live document";
      return false;
    }
  if (isNew || ocaf_->featureLabels.count(rec.featureId) == 0) {
    TDF_Label label = ocaf_->shapes->AddShape(rec.shape);
    TDataStd_Name::Set(
        label, TCollection_ExtendedString(rec.featureId.c_str()));
    TDataStd_Comment::Set(
        label,
        TCollection_AsciiString(
            EncodeParams(rec.type, rec.paramsMm, rec.dependsOn, rec.refExtra).c_str()));
    ocaf_->featureLabels[rec.featureId] = label;
    // Initial evolution anchor: the solid as generated content of its label.
    TNaming_Builder builder(label);
    builder.Generated(rec.shape);
    return true;
  }
  // Rebuild, same UUID: replace the shape (§3.2).
  // Phase 10 fix: this path used to ALSO record per-face TNaming evolution
  // (Generated old→new per role-matched pair) on the feature label. That made
  // XCAF GetShape resolve the label to a COMPOUND of the current faces
  // instead of the solid: bbox/volume/areas looked identical, yet every
  // downstream boolean after any Undo/Redo/Open silently cut wrong geometry
  // (no test asserts via=="naming"; role fallback in §4 is the tested
  // contract, so nothing observable is lost). The label now keeps exactly
  // one whole-solid evolution: SetShape replaces the solid, nothing else.
  TDF_Label label = ocaf_->featureLabels[rec.featureId];
  ocaf_->shapes->SetShape(label, rec.shape);
  TDataStd_Comment::Set(
      label,
      TCollection_AsciiString(
          EncodeParams(rec.type, rec.paramsMm, rec.dependsOn, rec.refExtra).c_str()));
  return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("OCAF mirror failed: ") + f.what();
    return false;
  }
#else
  (void)rec;
  (void)isNew;
  if (error) *error = "OCAF requires OCCT (link via vcpkg)";
  return false;
#endif
}

bool OcafLive::UpsertSketch(const std::string& sketchId,
                            const std::string& sketchJson,
                            std::string* error) {
#if KREODA_WITH_OCCT
  try {
    if (!ocaf_ || ocaf_->doc.IsNull()) Reset();
    if (ocaf_->doc.IsNull() || ocaf_->sketchesRoot.IsNull()) {
      if (error) *error = "OCAF: no live document";
      return false;
    }
    const auto it = ocaf_->sketchLabels.find(sketchId);
    if (it == ocaf_->sketchLabels.end()) {
      TDF_Label label = ocaf_->sketchesRoot.NewChild();
      TDataStd_Name::Set(label,
                         TCollection_ExtendedString(sketchId.c_str()));
      TDataStd_Comment::Set(
          label, TCollection_AsciiString(sketchJson.c_str()));
      ocaf_->sketchLabels[sketchId] = label;
    } else {
      TDataStd_Comment::Set(
          it->second, TCollection_AsciiString(sketchJson.c_str()));
    }
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("OCAF sketch mirror failed: ") + f.what();
    return false;
  }
#else
  (void)sketchId;
  (void)sketchJson;
  if (error) *error = "OCAF requires OCCT (link via vcpkg)";
  return false;
#endif
}

bool OcafLive::UpsertExpressions(const std::string& featureId,
                                 const std::string& exprJson,
                                 std::string* error) {
#if KREODA_WITH_OCCT
  try {
    if (!ocaf_ || ocaf_->doc.IsNull()) Reset();
    if (ocaf_->doc.IsNull() || ocaf_->expressionsRoot.IsNull()) {
      if (error) *error = "OCAF: no live document";
      return false;
    }
    const auto it = ocaf_->expressionLabels.find(featureId);
    if (it == ocaf_->expressionLabels.end()) {
      TDF_Label label = ocaf_->expressionsRoot.NewChild();
      TDataStd_Name::Set(
          label, TCollection_ExtendedString(featureId.c_str()));
      TDataStd_Comment::Set(
          label, TCollection_AsciiString(exprJson.c_str()));
      ocaf_->expressionLabels[featureId] = label;
    } else {
      TDataStd_Comment::Set(
          it->second, TCollection_AsciiString(exprJson.c_str()));
    }
    return true;
  } catch (const Standard_Failure& f) {
    if (error) {
      *error = std::string("OCAF expression mirror failed: ") + f.what();
    }
    return false;
  }
#else
  (void)featureId;
  (void)exprJson;
  if (error) *error = "OCAF requires OCCT (link via vcpkg)";
  return false;
#endif
}

bool OcafLive::SketchLabelEntries(
    std::vector<std::pair<std::string, std::string>>* out) {
#if KREODA_WITH_OCCT
  if (!ocaf_ || ocaf_->sketchesRoot.IsNull() || !out) return false;
  for (TDF_ChildIterator it(ocaf_->sketchesRoot, Standard_False); it.More();
       it.Next()) {
    Handle(TDataStd_Name) n;
    Handle(TDataStd_Comment) c;
    if (!it.Value().FindAttribute(TDataStd_Name::GetID(), n) ||
        !it.Value().FindAttribute(TDataStd_Comment::GetID(), c)) {
      continue;
    }
    out->emplace_back(ExtToAscii(n->Get()), ExtToAscii(c->Get()));
  }
  return true;
#else
  (void)out;
  return false;
#endif
}

bool OcafLive::SelectFace(const std::string& featureId, const std::string& role,
                          FaceSelection* out, std::string* error) {
#if KREODA_WITH_OCCT
  try {
    if (!ocaf_ || ocaf_->featureLabels.count(featureId) == 0) {
      if (error) *error = "unknown feature " + featureId;
      return false;
    }
  ShapeRecord rec;
  if (!ShapeStore::instance().get(featureId, &rec) || rec.shape.IsNull()) {
    if (error) *error = "feature has no shape";
    return false;
  }
  TopoDS_Face picked;
  if (!FindFaceByRole(rec.shape, featureId, rec.type, role, &picked)) {
    if (error) *error = "no face with role " + role;
    return false;
  }
  TDF_Label selLabel = ocaf_->selectionsRoot.NewChild();
  TNaming_Selector selector(selLabel);
  if (!selector.Select(picked, rec.shape)) {
    if (error) *error = "TNaming_Selector could not identify the face";
    return false;
  }
  TDataStd_Comment::Set(
      selLabel,
      TCollection_AsciiString((featureId + "|" + role).c_str()));
  TCollection_AsciiString entry;
  TDF_Tool::Entry(selLabel, entry);
  if (out) {
    out->entry = entry.ToCString();
    out->featureId = featureId;
    out->role = role;
  }
  return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("face selection failed: ") + f.what();
    return false;
  }
#else
  (void)featureId;
  (void)role;
  (void)out;
  if (error) *error = "OCAF requires OCCT (link via vcpkg)";
  return false;
#endif
}

OcafLive::ResolveResult OcafLive::ResolveSelection(const FaceSelection& sel) {
  ResolveResult result;
#if KREODA_WITH_OCCT
  if (ocaf_ && !ocaf_->doc.IsNull()) {
    try {
      TDF_Label lab;
      TDF_Tool::Label(ocaf_->doc->GetData(),
                      TCollection_AsciiString(sel.entry.c_str()), lab);
      if (!lab.IsNull()) {
      Handle(TNaming_NamedShape) ns;
      if (lab.FindAttribute(TNaming_NamedShape::GetID(), ns) && !ns.IsNull()) {
        // Primary path (§3) counts ONLY with geometric proof: the tracked
        // shape must IsSame-match a face of the current feature solid.
        // (Without a post-rebuild re-solve, a bare CurrentShape may be the
        // stale pre-rebuild face — never claim tracking without proof.)
        const TopoDS_Shape current = TNaming_Tool::CurrentShape(ns);
        if (!current.IsNull()) {
          ShapeRecord rec;
          if (ShapeStore::instance().get(sel.featureId, &rec) &&
              !rec.shape.IsNull()) {
            const std::vector<std::string> roles =
                ClassifyFaceRoles(rec.shape, rec.type, sel.featureId);
            size_t fi = 0;
            for (TopExp_Explorer ex(rec.shape, TopAbs_FACE); ex.More();
                 ex.Next(), ++fi) {
              if (TopoDS::Face(ex.Current()).IsSame(current) &&
                  fi < roles.size()) {
                result.valid = true;
                result.via = "naming";
                result.role = roles[fi];
                return result;
              }
            }
          }
        }
      }
    }
    } catch (const Standard_Failure&) {
      // Malformed entry or corrupt naming data: fall through to the role
      // fallback below instead of crashing the kernel process (§49).
    }
  }
  // Semantic fallback (§4): re-derive the role from current geometry.
  ShapeRecord rec;
  if (ShapeStore::instance().get(sel.featureId, &rec) && !rec.shape.IsNull()) {
    TopoDS_Face face;
    if (FindFaceByRole(rec.shape, sel.featureId, rec.type, sel.role, &face)) {
      result.valid = true;
      result.via = "role";
      result.role = sel.role;
    }
  }
#else
  (void)sel;
#endif
  return result;
}

bool OcafLive::Save(const std::string& xbfPath, std::string* error) {
#if KREODA_WITH_OCCT
  try {
    if (!ocaf_ || ocaf_->doc.IsNull()) {
      if (error) *error = "OCAF: nothing to save";
      return false;
    }
    if (ocaf_->app->SaveAs(ocaf_->doc,
                           TCollection_ExtendedString(xbfPath.c_str())) !=
        PCDM_SS_OK) {
      if (error) *error = "OCAF: SaveAs failed";
      return false;
    }
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("OCAF save failed: ") + f.what();
    return false;
  }
#else
  (void)xbfPath;
  if (error) *error = "OCAF requires OCCT (link via vcpkg)";
  return false;
#endif
}

bool OcafLive::Load(const std::string& xbfPath,
                    std::vector<ShapeRecord>* records,
                    std::vector<std::string>* sketchJsons,
                    std::string* error) {
#if KREODA_WITH_OCCT
  try {
    Reset();
  if (ocaf_->app->Open(TCollection_ExtendedString(xbfPath.c_str()),
                       ocaf_->doc) != PCDM_RS_OK ||
      ocaf_->doc.IsNull()) {
    if (error) *error = "OCAF: cannot open " + xbfPath;
    return false;
  }
  ocaf_->shapes = XCAFDoc_DocumentTool::ShapeTool(ocaf_->doc->Main());
  // Rebuild feature map from persisted labels (name + params comment).
  // C8: two-pass so Instance→Instance / Instance→self / Instance→ghost from
  // a crafted file never loads (creation gate bypass closed).
  int recovered = 0;
  NCollection_Sequence<TDF_Label> free;
  ocaf_->shapes->GetFreeShapes(free);
  std::vector<std::pair<ShapeRecord, TDF_Label>> loadCandidates;
  for (int i = 1; i <= free.Length(); ++i) {
    const ShapeRecord rec = RecordFromLabel(free.Value(i), ocaf_->shapes);
    if (rec.featureId.empty() || rec.shape.IsNull()) continue;
    if (!BRepCheck_Analyzer(rec.shape).IsValid(rec.shape)) continue;
    loadCandidates.emplace_back(rec, free.Value(i));
  }
  std::map<std::string, std::string> loadTypes;
  for (const auto& [rec, lab] : loadCandidates) loadTypes[rec.featureId] = rec.type;
  for (const auto& [rec, lab] : loadCandidates) {
    if (rec.type == "Instance") {
      bool bad = false;
      std::string why;
      if (rec.dependsOn.size() != 1) { bad = true; why = "Instance needs exactly one target"; }
      else if (rec.dependsOn[0] == rec.featureId) { bad = true; why = "Instance cannot target itself"; }
      else {
        auto tit = loadTypes.find(rec.dependsOn[0]);
        if (tit == loadTypes.end()) { bad = true; why = "Instance target missing: " + rec.dependsOn[0]; }
        else if (tit->second == "Instance") { bad = true; why = "nested instances are not supported"; }
      }
      if (bad) {
        LogCore("ocaf: dropping invalid Instance on load " + rec.featureId + ": " + why);
        continue;
      }
    }
    ocaf_->featureLabels[rec.featureId] = lab;
    if (records) records->push_back(rec);
    ++recovered;
  }
  // Re-adopt the selections + sketches + expressions folders (siblings).
  for (TDF_ChildIterator it(ocaf_->doc->Main(), Standard_False); it.More();
       it.Next()) {
    Handle(TDataStd_Name) n;
    if (!it.Value().FindAttribute(TDataStd_Name::GetID(), n)) continue;
    const std::string nm = ExtToAscii(n->Get());
    if (nm == "Selections") {
      ocaf_->selectionsRoot = it.Value();
    } else if (nm == "Sketches") {
      ocaf_->sketchesRoot = it.Value();
    } else if (nm == "Expressions") {
      ocaf_->expressionsRoot = it.Value();
    }
  }
  // Collect sketch JSON labels (do not fail the open when absent).
  int recoveredSketches = 0;
  if (!ocaf_->sketchesRoot.IsNull()) {
    for (TDF_ChildIterator it(ocaf_->sketchesRoot, Standard_False); it.More();
         it.Next()) {
      Handle(TDataStd_Name) n;
      Handle(TDataStd_Comment) c;
      if (!it.Value().FindAttribute(TDataStd_Name::GetID(), n) ||
          !it.Value().FindAttribute(TDataStd_Comment::GetID(), c)) {
        continue;
      }
      const std::string sid = ExtToAscii(n->Get());
      if (sid.empty()) continue;
      ocaf_->sketchLabels[sid] = it.Value();
      if (sketchJsons) sketchJsons->push_back(ExtToAscii(c->Get()));
      ++recoveredSketches;
    }
  }
  // Collect expression labels (do not fail the open when absent).
  // M8: skip expressions for shapes culled above (invalid/dropped Instance).
  if (!ocaf_->expressionsRoot.IsNull()) {
    for (TDF_ChildIterator it(ocaf_->expressionsRoot, Standard_False);
         it.More(); it.Next()) {
      Handle(TDataStd_Name) n;
      Handle(TDataStd_Comment) c;
      if (!it.Value().FindAttribute(TDataStd_Name::GetID(), n) ||
          !it.Value().FindAttribute(TDataStd_Comment::GetID(), c)) {
        continue;
      }
      const std::string fid = ExtToAscii(n->Get());
      if (fid.empty()) continue;
      if (ocaf_->featureLabels.find(fid) == ocaf_->featureLabels.end()) {
        LogCore("ocaf: dropping orphan expressions on load: " + fid);
        continue;
      }
      ocaf_->expressionLabels[fid] = it.Value();
      std::map<std::string, std::string> entries;
      std::string perr;
      if (ParseExpressionMap(ExtToAscii(c->Get()), &entries, &perr) &&
          !entries.empty()) {
        ExpressionStore::instance().setFeatureMap(fid, entries);
      }
    }
  }
  if (recovered == 0 && recoveredSketches == 0) {
    if (error) *error = "OCAF: no features recovered from " + xbfPath;
    return false;
  }
  return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("OCAF open failed: ") + f.what();
    return false;
  }
#else
  (void)xbfPath;
  (void)records;
  (void)sketchJsons;
  if (error) *error = "OCAF requires OCCT (link via vcpkg)";
  return false;
#endif
}

bool OcafLive::Load(const std::string& xbfPath,
                    std::vector<ShapeRecord>* records,
                    std::string* error) {
  return Load(xbfPath, records, nullptr, error);
}

}  // namespace kreoda
