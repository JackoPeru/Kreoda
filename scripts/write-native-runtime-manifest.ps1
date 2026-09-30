param(
  [Parameter(Mandatory)][string]$ReleaseDirectory,
  [Parameter(Mandatory)][string]$OutputFile,
  [Parameter(Mandatory)][string]$SourceCommit,
  [Parameter(Mandatory)][string]$CompilerVersion
)
$ErrorActionPreference = 'Stop'
if ($SourceCommit -notmatch '^[0-9a-f]{40}$') { throw 'A full source commit is required' }
$minimumVersion = [version]$CompilerVersion.Trim()
$releaseRoot = (Resolve-Path -LiteralPath $ReleaseDirectory).ProviderPath
$core = Get-Item -LiteralPath (Join-Path $releaseRoot 'kreoda-core.exe')
$dlls = @(Get-ChildItem -LiteralPath $releaseRoot -File -Filter '*.dll')
$crtNames = @('msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll')
$crt = foreach ($name in $crtNames) {
  $file = Get-Item -LiteralPath (Join-Path $releaseRoot $name)
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') {
    throw "Required CRT is not valid Microsoft-signed code: $name"
  }
  $version = $file.VersionInfo.FileVersion
  if ($version -notmatch '^\d+\.\d+\.\d+\.\d+$' -or [version]$version -lt $minimumVersion) {
    throw "CRT $name version '$version' is older than compiler $CompilerVersion or malformed"
  }
  [pscustomobject]@{ name = $name; version = $version; signatureStatus = 'Valid'; signerThumbprint = $signature.SignerCertificate.Thumbprint }
}
$payload = foreach ($file in @($core) + $dlls) {
  if ($file.Name -match '^(msvcp|vcruntime|concrt)140.*d\.dll$') { throw "Debug CRT cannot be packaged: $($file.Name)" }
  [pscustomobject]@{ name = $file.Name; bytes = $file.Length; fileVersion = $file.VersionInfo.FileVersion;
    sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$manifest = [ordered]@{ schemaVersion = 1; sourceCommit = $SourceCommit; architecture = 'x64';
  compilerVersion = $CompilerVersion.Trim(); generatedUtc = [DateTime]::UtcNow.ToString('o');
  crt = @($crt); payload = @($payload) }
$outputPath = [IO.Path]::GetFullPath($OutputFile)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputPath)) | Out-Null
[IO.File]::WriteAllText($outputPath, ($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine,
  [Text.UTF8Encoding]::new($false))
Write-Output "Native runtime provenance: $outputPath ($($payload.Count) payload files)"
