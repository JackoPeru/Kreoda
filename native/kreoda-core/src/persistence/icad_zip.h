#pragma once

#include <string>

namespace kreoda {

// .icad container (§30, Phase-1 subset): ZIP with manifest.json + document.xbf.
// Thumbnail + assets + recovery journal arrive in later phases.
struct IcadEntry {
  std::string name;     // entry path inside the zip
  std::string content;  // raw bytes
};

bool WriteIcad(const std::string& icadPath, const std::string& manifestJson,
               const std::string& xbfPath, std::string* error);
bool ReadIcad(const std::string& icadPath, const std::string& outDir,
              std::string* manifestJsonOut, std::string* xbfPathOut,
              std::string* error);

}  // namespace kreoda
