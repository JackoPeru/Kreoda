#Requires -Version 5.1
<#
.SYNOPSIS
  Configure + build kreoda-core with MSVC + vcpkg manifest mode (§2, §39).
#>
param(
  [string]$BuildType = "Release",
  [string]$VcpkgRoot = $env:VCPKG_ROOT,
  [switch]$AllowStubCore
)

$ErrorActionPreference = "Stop"
$core = Join-Path $PSScriptRoot "..\native\kreoda-core"
$build = Join-Path $core "build"

$args = @("-S", $core, "-B", $build, "-DCMAKE_BUILD_TYPE=$BuildType")
if ($VcpkgRoot -and (Test-Path (Join-Path $VcpkgRoot "scripts\buildsystems\vcpkg.cmake"))) {
  $args += "-DCMAKE_TOOLCHAIN_FILE=$(Join-Path $VcpkgRoot 'scripts/buildsystems/vcpkg.cmake')"
} elseif ($AllowStubCore) {
  Write-Warning "VCPKG_ROOT not set — building STUB core by explicit opt-in (-AllowStubCore). Never ship this."
  $args += "-DKREODA_ALLOW_STUB_CORE=ON"
} else {
  throw "VCPKG_ROOT not set and -AllowStubCore not given — refusing to silently build the stub core. Set VCPKG_ROOT or pass -AllowStubCore for protocol/bootstrap testing only."
}

& cmake @args
if (-not $?) { exit 1 }
& cmake --build $build --config $BuildType
