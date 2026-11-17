$ErrorActionPreference='Stop'
$repo='C:/Users/matte/Desktop/Saas/Kreoda-phase10-ci'
$qa='C:/Users/matte/Documents/Codex-tools/Native/projection-desktop-parent-20261016'
Set-Location -LiteralPath $repo
function Sources {
  $paths=git ls-files -c -o --exclude-standard -- apps/desktop packages/protocol packages/command-schema
  $result=[ordered]@{}
  foreach($path in ($paths | Sort-Object -Unique)) { $result[$path]=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
  return $result
}
$before=Sources
$before | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$qa/source-before.json" -Encoding UTF8
& pnpm --filter '@kreoda/desktop' build *> "$qa/build.log"
if($LASTEXITCODE -ne 0){throw 'Desktop build failed'}
& pnpm --filter '@kreoda/desktop' exec vitest run --reporter=default --reporter=junit --outputFile="$qa/unit.xml" *> "$qa/unit.log"
if($LASTEXITCODE -ne 0){throw 'Desktop tests failed'}
[xml]$unit=Get-Content -LiteralPath "$qa/unit.xml" -Raw
$cases=@($unit.SelectNodes('//testcase'))
if($cases.Count -lt 313 -or @($unit.SelectNodes('//failure|//error|//skipped')).Count -ne 0){throw 'Desktop tests missing, failed or skipped'}
$env:PLAYWRIGHT_JUNIT_OUTPUT_NAME="$qa/e2e.xml"
& pnpm --filter '@kreoda/desktop' exec playwright test e2e/projection-desktop.spec.ts '--reporter=line,junit' *> "$qa/e2e.log"
if($LASTEXITCODE -ne 0){throw 'Hidden native projection E2E failed'}
[xml]$e2e=Get-Content -LiteralPath "$qa/e2e.xml" -Raw
if(@($e2e.SelectNodes('//testcase')).Count -ne 1 -or @($e2e.SelectNodes('//failure|//error|//skipped')).Count -ne 0){throw 'Hidden projection E2E missing, failed or skipped'}
$after=Sources
$after | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$qa/source-after.json" -Encoding UTF8
$changed=@($before.Keys + $after.Keys | Sort-Object -Unique | Where-Object {$before[$_] -ne $after[$_]})
if($changed.Count -ne 0){throw ('Source changed: '+($changed -join ', '))}
[ordered]@{status='passed';desktopTests=$cases.Count;nativeHiddenE2e=1;sourceFiles=$before.Count;sourceChanges=$changed;physicalQuestTested=$false} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$qa/summary.json" -Encoding UTF8
Write-Output 'PARENT_DESKTOP_PROJECTION_PASSED'
