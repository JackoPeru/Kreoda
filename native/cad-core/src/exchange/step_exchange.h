#pragma once

#include <string>
#include <vector>

namespace intentcad {

// STEP AP214 exchange, Phase 8 (§61). Transport-neutral B-Rep round-trip:
// every solid in the store exports as one product; every solid in the file
// imports as one non-parametric "StepImport" feature (own OCAF label, own
// Undo step as a batch, tessellates + persists like any solid; parametric
// rebuild honestly refuses it — see RebuildNodeFromStore).
// No OCCT (stub core): both calls fail with an honest error.

bool ExportStep(const std::string& path, std::string* error);

// Reads STEP solids and commits one StepImport feature per solid inside a
// single OCAF command (one Undo step). Fills createdIds in file order.
bool ImportStep(const std::string& path, std::vector<std::string>* createdIds,
                std::string* error);

}  // namespace intentcad
