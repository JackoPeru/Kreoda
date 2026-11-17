param(
    [string]$Compiler = 'C:\Program Files\dotnet\sdk\10.0.402\Roslyn\bincore\csc.dll'
)
$ErrorActionPreference = 'Stop'
$project = Join-Path (Split-Path -Parent $PSScriptRoot) 'clients\quest-unity'
$rsp = Join-Path $project 'Library\Bee\artifacts\1300b0aP.dag\Kreoda.QuestRuntime.rsp'
if (!(Test-Path $rsp)) { throw "Missing Unity-generated compilation references: $rsp" }
if (!(Test-Path $Compiler)) { throw "Missing Roslyn compiler: $Compiler" }
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ('kreoda-phase12-roslyn-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDir | Out-Null
try {
    $argsFile = Join-Path $tempDir 'QuestRuntime.rsp'
    $source = Get-Content -LiteralPath $rsp
    $updated = foreach ($line in $source) {
        if ($line.StartsWith('-out:')) { '-out:"' + (Join-Path $tempDir 'Kreoda.QuestRuntime.dll') + '"' }
        elseif ($line.StartsWith('-refout:')) { '-refout:"' + (Join-Path $tempDir 'Kreoda.QuestRuntime.ref.dll') + '"' }
        else { $line }
    }
    # Unity Bee outputs are never overwritten; only a disposable response file is used.
    [IO.File]::WriteAllLines($argsFile, [string[]]$updated)
    Push-Location $project
    try {
        & dotnet $Compiler "@$argsFile"
        if ($LASTEXITCODE -ne 0) { throw "QuestRuntime Roslyn compilation failed: $LASTEXITCODE" }
        if (!(Test-Path (Join-Path $tempDir 'Kreoda.QuestRuntime.dll'))) { throw 'Compiler reported success without output DLL' }
        Write-Output 'QuestRuntime C# source compilation succeeded; Unity graphics/shader/IL2CPP remain unverified.'
    }
    finally { Pop-Location }
}
finally { Remove-Item -LiteralPath $tempDir -Recurse -Force }
