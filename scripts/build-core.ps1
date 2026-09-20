#Requires -Version 5.1
<#
.SYNOPSIS
  Configure + build kreoda-core with MSVC + vcpkg manifest mode (§2, §39).
#>
param(
  [string]$BuildType = "Release",
  [string]$VcpkgRoot = $env:VCPKG_ROOT
)

$ErrorActionPreference = "Stop"
$core = Join-Path $PSScriptRoot "..\native\kreoda-core"
$build = Join-Path $core "build"

$args = @("-S", $core, "-B", $build, "-DCMAKE_BUILD_TYPE=$BuildType")
if ($VcpkgRoot -and (Test-Path (Join-Path $VcpkgRoot "scripts\buildsystems\vcpkg.cmake"))) {
  $args += "-DCMAKE_TOOLCHAIN_FILE=$(Join-Path $VcpkgRoot 'scripts/buildsystems/vcpkg.cmake')"
} else {
  Write-Warning "VCPKG_ROOT not set — building STUB core without OCCT (Phase 0 ok, Phase 1 needs vcpkg)."
}

& cmake @args
if (-not $?) { exit 1 }
& cmake --build $build --config $BuildType
