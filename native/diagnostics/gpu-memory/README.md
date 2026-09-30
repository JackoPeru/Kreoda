# Windows GPU memory diagnostic

Standalone test utility; it is not part of the packaged CAD runtime.

```powershell
cmake -S native/diagnostics/gpu-memory -B native/diagnostics/gpu-memory/build
cmake --build native/diagnostics/gpu-memory/build --config Release
./native/diagnostics/gpu-memory/build/Release/kreoda-gpu-memory.exe <GPU-process-PID>
```

The resource E2E tests obtain GPU PIDs from Electron `app.getAppMetrics()` and run
this utility with hidden child windows. It queries each DXGI adapter with
`D3DKMTQueryStatistics(PROCESS_SEGMENT_GROUP)`. Local/nonlocal usage is the whole
process's GPU budget usage, not CPU working set, isolated mesh allocation, or a
guarantee of physically resident VRAM. An unsuccessful NTSTATUS produces null
usage and budget; unsupported measurements must not be interpreted as zero.

The companion `apps/desktop/e2e/gpu-metrics.ts` also flushes a WebGL2 fence and
polls it asynchronously with a ten-second deadline. `queueCompletionMs` observes
completion of prior GL commands, including browser scheduling and polling
overhead. It is not the GPU draw duration, compositor latency, or displayed FPS.
