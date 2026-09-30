// Diagnostic only: whole-process local/nonlocal GPU budget usage, not CPU RAM.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <winternl.h>
#include <dxgi1_2.h>
#include <d3dkmthk.h>
#include <wrl/client.h>
#include <charconv>
#include <cstdint>
#include <iostream>
#include <limits>
#include <memory>
#include <sstream>
#include <string_view>

int main(int argc, char** argv) {
  std::uint64_t parsed = 0;
  const std::string_view text = argc == 2 ? argv[1] : "";
  const auto result = std::from_chars(text.data(), text.data() + text.size(), parsed);
  if (text.empty() || result.ec != std::errc{} || result.ptr != text.data() + text.size() ||
      parsed == 0 || parsed > std::numeric_limits<DWORD>::max()) {
    std::cerr << "Usage: kreoda-gpu-memory <positive Windows PID>\n";
    return 1;
  }
  const DWORD pid = static_cast<DWORD>(parsed);
  std::unique_ptr<void, decltype(&CloseHandle)> process(
      OpenProcess(PROCESS_QUERY_INFORMATION, FALSE, pid), CloseHandle);
  if (!process) {
    std::cerr << "OpenProcess failed: " << GetLastError() << '\n';
    return 2;
  }
  Microsoft::WRL::ComPtr<IDXGIFactory1> factory;
  if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) {
    std::cerr << "CreateDXGIFactory1 failed\n";
    return 3;
  }
  std::ostringstream output;
  output << "{\"pid\":" << pid << ",\"samples\":[";
  bool comma = false;
  for (UINT index = 0; ; ++index) {
    Microsoft::WRL::ComPtr<IDXGIAdapter1> adapter;
    const HRESULT enumerated = factory->EnumAdapters1(index, &adapter);
    if (enumerated == DXGI_ERROR_NOT_FOUND) break;
    DXGI_ADAPTER_DESC1 description{};
    if (FAILED(enumerated) || FAILED(adapter->GetDesc1(&description))) {
      std::cerr << "DXGI adapter query failed\n";
      return 4;
    }
    for (int group = 0; group < 2; ++group) {
      D3DKMT_QUERYSTATISTICS query{};
      query.Type = D3DKMT_QUERYSTATISTICS_PROCESS_SEGMENT_GROUP;
      query.AdapterLuid = description.AdapterLuid;
      query.hProcess = process.get();
      query.QueryProcessSegmentGroup = static_cast<D3DKMT_MEMORY_SEGMENT_GROUP>(group);
      const NTSTATUS status = D3DKMTQueryStatistics(&query);
      if (comma) output << ',';
      comma = true;
      output << "{\"adapter\":" << index << ",\"vendorId\":" << description.VendorId
             << ",\"deviceId\":" << description.DeviceId
             << ",\"software\":" << ((description.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) ? "true" : "false")
             << ",\"segmentGroup\":\"" << (group == 0 ? "local" : "nonlocal")
             << "\",\"status\":" << status;
      if (status >= 0) {
        const auto& info = query.QueryResult.ProcessSegmentGroupInformation;
        output << ",\"usageBytes\":" << info.Usage << ",\"budgetBytes\":" << info.Budget;
      } else {
        // Unsupported/no GPU context is not a measured zero allocation.
        output << ",\"usageBytes\":null,\"budgetBytes\":null";
      }
      output << '}';
    }
  }
  std::cout << output.str() << "]}\n";
}
