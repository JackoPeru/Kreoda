#pragma once
#include <string>
// Structured core logs (§50): time, documentId, requestId, featureId,
// operation, durationMs, OCCT status, result. Noisy logs stay out of stdout
// (stdout is the IPC channel) — use stderr.
void LogCore(const std::string& line);
