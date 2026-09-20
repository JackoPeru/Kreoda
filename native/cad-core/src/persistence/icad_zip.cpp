#include "icad_zip.h"

#if INTENTCAD_WITH_MINIZIP
// minizip-ng ships a compat layer (MZ_COMPAT=ON): classic zip/unzip API.
#include <minizip-ng/unzip.h>
#include <minizip-ng/zip.h>
#endif

#include <cstdio>
#include <vector>

namespace intentcad {

#if INTENTCAD_WITH_MINIZIP

namespace {

bool writeEntry(zipFile zf, const char* name, const std::string& content,
                std::string* error) {
  zip_fileinfo zi = {};
  if (zipOpenNewFileInZip(zf, name, &zi, nullptr, 0, nullptr, 0, nullptr,
                          Z_DEFLATED, Z_DEFAULT_COMPRESSION) != ZIP_OK) {
    if (error) *error = std::string("zip: cannot add entry ") + name;
    return false;
  }
  if (!content.empty() &&
      zipWriteInFileInZip(zf, content.data(),
                          static_cast<unsigned>(content.size())) != ZIP_OK) {
    zipCloseFileInZip(zf);
    if (error) *error = std::string("zip: write failed for ") + name;
    return false;
  }
  if (zipCloseFileInZip(zf) != ZIP_OK) {
    if (error) *error = std::string("zip: close failed for ") + name;
    return false;
  }
  return true;
}

bool readFileBytes(const std::string& path, std::string* out,
                   std::string* error) {
  FILE* f = nullptr;
  if (fopen_s(&f, path.c_str(), "rb") != 0 || !f) {
    if (error) *error = "cannot read " + path;
    return false;
  }
  fseek(f, 0, SEEK_END);
  const long n = ftell(f);
  fseek(f, 0, SEEK_SET);
  out->assign(static_cast<size_t>(n), '\0');
  const size_t got = fread(out->data(), 1, out->size(), f);
  fclose(f);
  if (got != out->size()) {
    if (error) *error = "short read " + path;
    return false;
  }
  return true;
}

}  // namespace

bool WriteIcad(const std::string& icadPath, const std::string& manifestJson,
               const std::string& xbfPath, std::string* error) {
  std::string xbfBytes;
  if (!readFileBytes(xbfPath, &xbfBytes, error)) return false;
  zipFile zf = zipOpen64(icadPath.c_str(), APPEND_STATUS_CREATE);
  if (!zf) {
    if (error) *error = "zip: cannot create " + icadPath;
    return false;
  }
  const bool ok = writeEntry(zf, "manifest.json", manifestJson, error) &&
                  writeEntry(zf, "document.xbf", xbfBytes, error);
  if (zipClose(zf, nullptr) != ZIP_OK) {
    if (error && ok) *error = "zip: close failed for " + icadPath;
    return false;
  }
  return ok;
}

bool ReadIcad(const std::string& icadPath, const std::string& outDir,
              std::string* manifestJsonOut, std::string* xbfPathOut,
              std::string* error) {
  unzFile uf = unzOpen64(icadPath.c_str());
  if (!uf) {
    if (error) *error = "zip: cannot open " + icadPath;
    return false;
  }
  std::string manifest, xbf;
  int rc = unzGoToFirstFile(uf);
  while (rc == UNZ_OK) {
    char name[512] = {0};
    unz_file_info64 info = {};
    if (unzGetCurrentFileInfo64(uf, &info, name, sizeof(name) - 1, nullptr,
                                0, nullptr, 0) != UNZ_OK) {
      break;
    }
    if (std::string(name) == "manifest.json" ||
        std::string(name) == "document.xbf") {
      if (unzOpenCurrentFile(uf) != UNZ_OK) {
        if (error) *error = std::string("zip: cannot open entry ") + name;
        unzClose(uf);
        return false;
      }
      std::string content(static_cast<size_t>(info.uncompressed_size), '\0');
      size_t off = 0;
      while (off < content.size()) {
        const int got = unzReadCurrentFile(
            uf, content.data() + off,
            static_cast<unsigned>(content.size() - off));
        if (got <= 0) break;
        off += static_cast<size_t>(got);
      }
      unzCloseCurrentFile(uf);
      if (off != content.size()) {
        if (error) *error = std::string("zip: short entry ") + name;
        unzClose(uf);
        return false;
      }
      if (std::string(name) == "manifest.json")
        manifest = std::move(content);
      else
        xbf = std::move(content);
    }
    rc = unzGoToNextFile(uf);
  }
  unzClose(uf);
  if (manifest.empty() || xbf.empty()) {
    if (error) *error = "not an intentcad project (manifest/document missing)";
    return false;
  }
  const std::string xbfPath = (outDir.empty() ? std::string(".") : outDir) +
                              "/document.xbf";
  FILE* f = nullptr;
  if (fopen_s(&f, xbfPath.c_str(), "wb") != 0 || !f) {
    if (error) *error = "cannot write " + xbfPath;
    return false;
  }
  const size_t wrote = fwrite(xbf.data(), 1, xbf.size(), f);
  fclose(f);
  if (wrote != xbf.size()) {
    if (error) *error = "short write " + xbfPath;
    return false;
  }
  if (manifestJsonOut) *manifestJsonOut = std::move(manifest);
  if (xbfPathOut) *xbfPathOut = xbfPath;
  return true;
}

#else

bool WriteIcad(const std::string&, const std::string&, const std::string&,
               std::string* error) {
  if (error) *error = ".icad I/O requires minizip-ng (link via vcpkg)";
  return false;
}

bool ReadIcad(const std::string&, const std::string&, std::string*,
              std::string*, std::string* error) {
  if (error) *error = ".icad I/O requires minizip-ng (link via vcpkg)";
  return false;
}

#endif

}  // namespace intentcad
