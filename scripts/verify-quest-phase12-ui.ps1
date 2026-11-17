param(
    [string]$Unity = 'C:\Users\matte\Documents\Codex-tools\Unity\Editors\6000.3.25f1\Editor\Unity.exe',
    [string]$UnityCli = 'C:\Users\matte\Documents\Codex-tools\Unity\CLI\1.0.0-beta.12\unity.exe',
    [switch]$SourceOnly,
    [switch]$InstallToQuest
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$project = Join-Path $repo 'clients\quest-unity'
$log = Join-Path $project 'Build\phase12-visual-review.log'
$proof = Join-Path $repo 'docs\superpowers\evidence\2026-10-18-phase12-quest-ui'
$required = @('home.png','workspace.png','connection.png','pc-discovery.png','metrics.png','home-notice.png','section.png','edit.png','references.png','configurations.png','commands.png','sketch.png','voice.png')
$renderer = Get-Content -LiteralPath (Join-Path $project 'Assets\Kreoda\Editor\QuestHomeRender.cs') -Raw -Encoding UTF8
$controlsSource = Get-Content -LiteralPath (Join-Path $project 'Assets\Kreoda\Runtime\QuestControls.cs') -Raw -Encoding UTF8
if ($renderer -notmatch 'static\s+void\s+FitRealPage\(Camera camera, Transform page, out float halfHeight, out Vector2 center\)' -or
    $renderer -notmatch 'FitRealPage\(camera, page, out halfHeight, out center\)' -or
    $renderer -notmatch 'camera\.orthographicSize\s*=\s*halfHeight' -or
    $renderer -notmatch 'cameraHalfHeights\s*=\s*halfHeights\.ToArray\(\)' -or
    $renderer -notmatch 'cameraCenters\s*=\s*centers\.ToArray\(\)') {
    throw 'Quest capture fit regression: page-specific orthographic camera bounds or per-page manifest evidence missing'
}
$proofLeaf = Split-Path -Leaf $proof
if ($proofLeaf -cne '2026-10-18-phase12-quest-ui' -or
    $renderer -notmatch [regex]::Escape('docs/superpowers/evidence/' + $proofLeaf) -or
    $renderer -match '2026-10-16-quest-home-ui') {
    throw 'Quest capture proof path mismatch: renderer and source verifier must target current Phase12 evidence without touching historical captures'
}
$fieldBlock = [regex]::Match($renderer, 'PageFields\s*=\s*\{(?<items>.*?)\}', 'Singleline').Groups['items'].Value
$fileBlock = [regex]::Match($renderer, 'PageFiles\s*=\s*\{(?<items>.*?)\}', 'Singleline').Groups['items'].Value
$fields = @([regex]::Matches($fieldBlock, '"(_\w+Page)"') | ForEach-Object { $_.Groups[1].Value })
$files = @([regex]::Matches($fileBlock, '"([^"\r\n]+\.png)"') | ForEach-Object { $_.Groups[1].Value })
if ($fields.Count -ne 13 -or $files.Count -ne 13 -or (($files -join '|') -ne ($required -join '|'))) {
    throw 'Quest capture structural regression: required pages, filenames or ordering changed'
}
foreach ($field in $fields) {
    if ($controlsSource -notmatch [regex]::Escape($field)) { throw "Quest capture structural regression: missing controls field $field" }
}
Write-Output 'Offline structural validation passed: Home plus 12 secondary pages mapped to 13 required PNGs.'
if ($SourceOnly -and $InstallToQuest) { throw 'SourceOnly cannot be combined with InstallToQuest' }
$expectedStart = $controlsSource.IndexOf('static int ExpectedActions(string page)')
$semanticStart = $controlsSource.IndexOf('static int SemanticZone(', $expectedStart)
if ($expectedStart -lt 0 -or $semanticStart -le $expectedStart) { throw 'Quest source contract missing semantic action map' }
$expectedSource = $controlsSource.Substring($expectedStart, $semanticStart - $expectedStart)
$actionCases = @([regex]::Matches($expectedSource, 'case\s+"([^"]+)"\s*:\s*return\s+(\d+)\s*;'))
$totalActions = 0
foreach ($entry in $actionCases) { $totalActions += [int]$entry.Groups[2].Value }
$focusBody = [regex]::Match($controlsSource,
    'void\s+CreateDomainFocus\(Transform page, string pageName\)(?<body>.*?)(?=\n\s*void\s+RefreshDomainFocusStages\()', 'Singleline')
$summaryBody = [regex]::Match($controlsSource,
    'void\s+AddPageSummary\([^)]*\)(?<body>.*?)(?=\n\s*void\s+UpdatePageSummary\()', 'Singleline')
$readoutBody = [regex]::Match($controlsSource,
    'void\s+RefreshPanelReadouts\([^)]*\)(?<body>.*?)(?=\n\s*// The secondary line belongs)', 'Singleline')
$operationBody = [regex]::Match($controlsSource,
    'TextMesh\s+OperationControl\([^)]*\)(?<body>.*?)(?=\n\s*void\s+ValidateAuthoredActionGeometry\()', 'Singleline')
$uiSource = Get-Content -LiteralPath (Join-Path $project 'Assets\Kreoda\Runtime\QuestUi.cs') -Raw -Encoding UTF8
$operationAction = [regex]::Match($uiSource,
    'public static TextMesh OperationAction\([^)]*\)(?<body>.*?)(?=\n\s*// Second factual line)', 'Singleline')
$largeComposition = [regex]::Match($uiSource,
    'public static void SetLargeActionComposition\([^)]*\)(?<body>.*?)(?=\n\s*// Flow-backed operational controls)', 'Singleline')
$operationSection = [regex]::Match($uiSource,
    'public static Transform OperationSection\([^)]*\)(?<body>.*?)(?=\n\s*// A status is explicit)', 'Singleline')
$instrumentBody = [regex]::Match($controlsSource,
    'void\s+CreateActionInstrument\([^)]*\)(?<body>.*?)(?=\n\s*static void TintInstrument\()', 'Singleline')
$artworkBody = [regex]::Match($controlsSource,
    'void\s+CreateComposedCardArtwork\([^)]*\)(?<body>.*?)(?=\n\s*void SetLargeComposedCard\()', 'Singleline')
if ($actionCases.Count -ne 12 -or $totalActions -ne 113 -or
    !$focusBody.Success -or $focusBody.Groups['body'].Value -notmatch 'CreateLiveFocusStage\(' -or
    $focusBody.Groups['body'].Value -match 'FocusShape\(' -or
    !$summaryBody.Success -or $summaryBody.Groups['body'].Value -match 'SummaryCard\(' -or
    !$readoutBody.Success -or $readoutBody.Groups['body'].Value -match 'SetDomainFacts\(' -or
    !$operationBody.Success -or $operationBody.Groups['body'].Value -notmatch 'CreateOperationPanel\(' -or
    !$operationAction.Success -or $operationAction.Groups['body'].Value -notmatch 'Operation semantic rail' -or
    !$largeComposition.Success -or $largeComposition.Groups['body'].Value -notmatch 'SetActionDataCard\(' -or
    $largeComposition.Groups['body'].Value -match 'Label\(' -or
    !$operationSection.Success -or $operationSection.Groups['body'].Value -notmatch 'GlassCard\(' -or
    $operationSection.Groups['body'].Value -match 'Divider\(' -or
    !$instrumentBody.Success -or $instrumentBody.Groups['body'].Value -notmatch 'GetComponent<MeshRenderer>\(\)\.enabled\s*=\s*false' -or
    !$artworkBody.Success -or $artworkBody.Groups['body'].Value -notmatch 'GetComponent<MeshRenderer>\(\)\.enabled\s*=\s*false' -or
    $controlsSource -notmatch '_domainFocus\.Count\s*!=\s*12\s*\|\|\s*_measuredPanels\.Count\s*!=\s*37' -or
    $controlsSource -notmatch 'CreateActionInstrument\(page\.name, text, label, hitWidth, hitHeight\)' -or
    $controlsSource -notmatch 'CreateComposedCardArtwork\(label, composition, hitWidth, hitHeight\)' -or
    $controlsSource -notmatch 'RefreshDomainFocusStages\(\);' -or
    $uiSource -notmatch 'public void SetDomainFacts\(' -or
    $uiSource -notmatch 'public void SetMeasuredValue\(float normalizedValue\)') {
    throw 'Quest compact UI regression: expected 12 live summaries, 37 semantic panels, 113 original actions, and no duplicate visual layers'
}
Write-Output 'Source-only compact UI contract passed: 12 service-bound summaries, 37 semantic panels, 113 original actions, one panel heading and one live action detail.'

# Geometric invariants checked directly against the authored source. These checks
# cannot establish actual collider overlap or correct text rendering in Unity.
if ($controlsSource -match '\bAuthoredRows\s*\(') { throw 'Quest geometry regression: obsolete AuthoredRows dependency exists' }
$expectedStart = $controlsSource.IndexOf('static int ExpectedActions(string page)')
$semanticStart = $controlsSource.IndexOf('static int SemanticZone(', $expectedStart)
$operationStart = $controlsSource.IndexOf('TextMesh OperationControl(', $semanticStart)
if ($expectedStart -lt 0 -or $semanticStart -le $expectedStart -or $operationStart -le $semanticStart) { throw 'Quest geometry regression: semantic layout methods missing' }
$expectedSource = $controlsSource.Substring($expectedStart, $semanticStart - $expectedStart)
$semanticSource = $controlsSource.Substring($semanticStart, $operationStart - $semanticStart)
$cases = @([regex]::Matches($expectedSource, 'case\s+"([^"]+)"\s*:\s*return\s+(\d+)\s*;'))
if ($cases.Count -ne 12) { throw "Quest geometry regression: expected 12 semantic pages, found $($cases.Count)" }
$counts = @{}; $totalSlots = 0
foreach ($case in $cases) {
    $name = $case.Groups[1].Value; $slots = [int]$case.Groups[2].Value
    if ($counts.ContainsKey($name) -or $slots -lt 1 -or $semanticSource -notmatch [regex]::Escape('case "' + $name + '"')) { throw "Quest semantic page mapping invalid: $name" }
    $counts[$name] = $slots; $totalSlots += $slots
}
if ($totalSlots -ne 113) { throw "Quest geometry regression: expected 113 semantic actions, found $totalSlots" }
# Decode C# source literal escapes before comparing actual action identities.
# In particular, Unicode arrows and the minus sign must not degrade to '?'.
function Convert-CSharpActionLiteral([string]$literal) {
    return [regex]::Replace($literal, '\\u([0-9a-fA-F]{4})|\\U([0-9a-fA-F]{8})|\\([\\"nrt])', {
        param($m)
        if ($m.Groups[1].Success) { return [string][char][Convert]::ToInt32($m.Groups[1].Value,16) }
        if ($m.Groups[2].Success) { return [char]::ConvertFromUtf32([Convert]::ToInt32($m.Groups[2].Value,16)) }
        switch ($m.Groups[3].Value) { 'n' { return "`n" } 'r' { return "`r" } 't' { return "`t" } default { return $m.Groups[3].Value } }
    })
}
$identityStart = $controlsSource.IndexOf('static string[] WorkflowActionIds(')
$identityTail = if ($identityStart -ge 0) { $controlsSource.Substring($identityStart) } else { '' }
$nextIdentityMethod = [regex]::Match($identityTail, '\n\s*static\s+(?:Vector3|Vector4\[\]|int|bool)\s+\w+\s*\(', 'Singleline')
$identityEnd = if ($nextIdentityMethod.Success) { $identityStart + $nextIdentityMethod.Index } else { -1 }
if ($identityStart -lt 0 -or $identityEnd -le $identityStart) { throw 'Quest ActionId regression: missing identity map or placement consumer' }
$identitySource = $controlsSource.Substring($identityStart, $identityEnd - $identityStart)
$identityCases = @([regex]::Matches($identitySource, 'case\s+"([^"]+)"\s*:(?<body>.*?)(?=\s*case\s+"|\s*default\s*:)', 'Singleline'))
if ($identityCases.Count -ne 12) { throw "Quest ActionId regression: expected 12 identity pages, got $($identityCases.Count)" }
$identityMap = @{}
foreach ($entry in $identityCases) {
    $page = $entry.Groups[1].Value
    if (!$counts.ContainsKey($page) -or $identityMap.ContainsKey($page)) { throw "Quest ActionId regression: unknown/duplicate page $page" }
    $zoneSets = @([regex]::Matches($entry.Groups['body'].Value, 'return\s+new\[\]\s*\{(?<ids>[^}]+)\}'))
    $ids = @()
    foreach ($zoneSet in $zoneSets) {
        $zoneIds = @([regex]::Matches($zoneSet.Groups['ids'].Value, '"((?:\\.|[^"\\])*)"') | ForEach-Object { Convert-CSharpActionLiteral $_.Groups[1].Value })
        if (!$zoneIds.Count -or @($zoneIds | Group-Object | Where-Object Count -gt 1).Count) { throw "Quest ActionId regression: empty or duplicate zone IDs for $page" }
        foreach ($id in $zoneIds) { if ($id.Contains('?')) { throw "Quest ActionId regression: placeholder '?' in $page / $id" } }
        $ids += $zoneIds
    }
    if ($ids.Count -ne $counts[$page]) { throw "Quest ActionId regression: $page mapped $($ids.Count) IDs, expected $($counts[$page])" }
    # Same label may occur in different modal zones, but never twice in one zone.
    $identityMap[$page] = $ids
}
# Placement implementations may change. The identity map must remain consumed
# by interactive action construction; a particular old layout helper is not a contract.
if ($controlsSource -notmatch 'WorkflowActionIds\(page,\s*zone\)' -and
    $controlsSource -notmatch 'WorkflowActionIds\(page\.name,\s*groupIndex\)') {
    throw 'Quest ActionId regression: identity map is not used by action composition'
}
$callSites = [regex]::Matches($controlsSource, 'OperationControl\(').Count - 1
if ($callSites -ne 105) { throw "Quest geometry regression: expected 105 action call sites, found $callSites" }
if ($controlsSource -notmatch '_pcChoices\s*=\s*new\s+TextMesh\[4\]' -or $controlsSource -notmatch 'for\s*\(int i = 0; i < _pcChoices\.Length; i\+\+\)' -or $totalSlots -ne $callSites + 3 + 5) { throw 'Quest geometry regression: PC loop expansion mismatch' }
if ($counts['Display controls'] -ne 22) { throw 'Quest geometry regression: View must have 22 actions' }
if ($controlsSource -notmatch 'var\s+scales\s*=\s*new\[\]\s*\{[^}]*"Fit"' -or $controlsSource -notmatch 'for\s*\(int i = 0; i < scales\.Length; i\+\+\)') { throw 'Quest geometry regression: six View scale presets loop missing' }
if ($controlsSource -notmatch 'SemanticZoneCapacity\(page\.name, groupIndex\)' -or $controlsSource -notmatch 'ActionId' -or $controlsSource -notmatch 'ControlVisibleWithinPage\(' -or $controlsSource -notmatch 'for\s*\(var x = -1; x <= 1; x \+= 2\)') { throw 'Quest geometry regression: capacity, action identity or 8-corner collider overlap guard missing' }
$pageCreates = @([regex]::Matches($controlsSource, '(_\w+Page)\s*=\s*PageRoot\("([^"]+)"\)'))
if ($pageCreates.Count -ne 12) { throw "Quest geometry regression: expected 12 page roots, found $($pageCreates.Count)" }
foreach ($create in $pageCreates) {
    $page = $create.Groups[2].Value; $field = $create.Groups[1].Value
    if (!$counts.ContainsKey($page) -or $field -notin $fields) { throw "Quest geometry regression: unmapped page $page" }
    $next = @($pageCreates | Where-Object { $_.Index -gt $create.Index } | Select-Object -First 1)
    $end = if ($next.Count) { $next[0].Index } else { $controlsSource.IndexOf('BuildSecondaryPageLayouts();', $create.Index) }
    if ($end -le $create.Index) { throw "Quest geometry regression: missing page action region $page" }
    $segment = $controlsSource.Substring($create.Index, $end - $create.Index)
    $actions = [regex]::Matches($segment, 'OperationControl\(').Count
    if ($field -eq '_pcPage') { $actions += 3 }; if ($field -eq '_viewPage') { $actions += 5 }
    if ($actions -ne $counts[$page]) { throw "Quest geometry regression: $page expected $($counts[$page]), found $actions" }
    # OperationAction assigns ActionId from the action text. Catch repeated
    # source-literal IDs within each page; loop-generated/dynamic names require
    # runtime validation and are deliberately not treated as proven unique.
    $literalIds = @([regex]::Matches($segment, 'OperationControl\(\s*"([^"]+)"\s*(?=,)') | ForEach-Object { $_.Groups[1].Value })
    $duplicates = @($literalIds | Group-Object | Where-Object { $_.Count -gt 1 })
    if ($duplicates.Count) { throw "Quest duplicate literal ActionId on $page : $($duplicates.Name -join ', ')" }
    $actualIds = @($literalIds | ForEach-Object { Convert-CSharpActionLiteral $_ })
    if ($field -eq '_pcPage') { $actualIds += @('PC 1','PC 2','PC 3','PC 4') }
    if ($field -eq '_viewPage') { $actualIds += @('1:10','1:5','1:1','2:1','10:1','Fit') }
    $expectedIds = @($identityMap[$page])
    $missing = @($actualIds | Where-Object { $_ -cnotin $expectedIds })
    $extra = @($expectedIds | Where-Object { $_ -cnotin $actualIds })
    if ($actualIds.Count -ne $expectedIds.Count -or $missing.Count -or $extra.Count) {
        throw "Quest ActionId mismatch $page : unmapped construction IDs=[$($missing -join ', ')], unmapped registry IDs=[$($extra -join ', ')] ($($actualIds.Count)/$($expectedIds.Count))"
    }
    # A page containing correctly named but inert placeholders is not a
    # functional composition. Require delegates in its actual construction
    # segment rather than counting PageRoot labels alone.
    if ($segment -notmatch 'OperationControl\([\s\S]*?(?:\(\)\s*=>|\w+\.\w+|,\s*[A-Z]\w+\s*[,\)])') {
        throw "Quest functional composition missing action callbacks: $page"
    }
}
if ($controlsSource -notmatch 'SetScale\(preset\)' -or
    $controlsSource -notmatch 'var\s+scales\s*=\s*new\[\]\s*\{\s*"1:10"\s*,\s*"1:5"\s*,\s*"1:1"\s*,\s*"2:1"\s*,\s*"10:1"\s*,\s*"Fit"\s*\}') {
    throw 'Quest action identity regression: six View scale presets are not distinct'
}
if ($controlsSource -notmatch 'SemanticZone\(page\.name, text\)' -or $controlsSource -notmatch 'ExpectedActions\(page\.name\)' -or $controlsSource -notmatch 'ValidateAuthoredActionGeometry\(\)') { throw 'Quest geometry regression: semantic action routing/validation missing' }
if ($renderer -notmatch 'using\s*\(var sha = SHA256\.Create\(\)\)' -or
    $renderer -notmatch 'File\.WriteAllText\(Path\.Combine\(output, "capture-manifest\.json"\)' -or
    $renderer -notmatch 'camera\.Render\(\)' -or $renderer -notmatch 'image\.ReadPixels\(') {
    throw 'Quest capture regression: real renderer, hash or manifest writer missing'
}
$readoutBlock = [regex]::Match($controlsSource, 'void\s+BuildSecondaryPageLayouts\(\)\s*\{(?<body>.*?)\n\s*\}', 'Singleline').Groups['body'].Value
$readouts = @([regex]::Matches($readoutBlock, 'OperationalReadout\(\s*(_\w+Page)\s*,\s*"[^"]+"\s*,\s*([-.\d]+)f(?:\s*,\s*([-.\d]+)f)?\s*\)'))
if ($readouts.Count -ne 12) { throw "Quest geometry regression: expected 12 secondary readouts, found $($readouts.Count)" }
$seenReadouts = @{}
foreach ($match in $readouts) {
    $page = $match.Groups[1].Value
    if ($seenReadouts.ContainsKey($page)) { throw "Quest geometry regression: duplicate readout on $page" }
    $seenReadouts[$page] = $true
    $y = [double]::Parse($match.Groups[2].Value, [Globalization.CultureInfo]::InvariantCulture)
    $h = if ($match.Groups[3].Success) { [double]::Parse($match.Groups[3].Value, [Globalization.CultureInfo]::InvariantCulture) } else { 0.047 }
    if ($h -le 0 -or ($y - $h / 2) -lt -0.32 -or ($y + $h / 2) -gt 0.17) {
        throw "Quest geometry regression: $page status readout exceeds secondary panel bounds"
    }
}
Write-Output 'Offline geometric invariants passed: 12 semantic layouts, 113 expected actions, 105 source action call sites and 12 distinct readouts.'
# Analyze measured panel rectangles (metres) independently of button call-site counts.
# AABB tests are conservative: they detect authored panel intersections, not Unity render order.
$geoStart = $controlsSource.IndexOf('static Vector4 RawSemanticPanelGeometry(')
$geoEnd = $controlsSource.IndexOf('readonly Dictionary<string, QuestUi.OperationPanel>', $geoStart)
if ($geoStart -lt 0 -or $geoEnd -le $geoStart) { throw 'Missing semantic panel geometry table' }
$geometryText = $controlsSource.Substring($geoStart, $geoEnd - $geoStart)
if ($geometryText -notmatch 'static\s+Vector4\s+SemanticPanelGeometry\(' -or
    $geometryText -notmatch 'return rectangle;' -or
    $geometryText -match 'previousBottom') {
    throw 'Unsupported Quest geometry: expected direct authored two-column placements'
}
$caseMatches = @([regex]::Matches($geometryText, 'case\s+"([^"]+)"\s*:\s*return\s+([^;]+);'))
if ($caseMatches.Count -ne 12) { throw "Expected 12 semantic geometry page definitions, found $($caseMatches.Count)" }
$summaryCards = @([regex]::Matches($controlsSource, 'AddPageSummary\(\s*(_\w+Page)\s*,\s*_\w+\s*,\s*"[^"]+"\s*,\s*([-\.\d]+)f(?:\s*,\s*([-\.\d]+)f)?\s*\)'))
if ($summaryCards.Count -ne 12) { throw "Expected 12 authored AddPageSummary cards, found $($summaryCards.Count)" }
$overlaps = @(); $outOfBounds = @(); $rectangles = 0; $sideBySide = 0; $geometrySignatures = @{}; $highestPanelTop = -1.0
foreach ($caseMatch in $caseMatches) {
    $page = $caseMatch.Groups[1].Value
    $rects = @([regex]::Matches($caseMatch.Groups[2].Value, 'new\s+Vector4\(\s*([-.\d]+)f?\s*,\s*([-.\d]+)f?\s*,\s*([-.\d]+)f?\s*,\s*([-.\d]+)f?\s*\)'))
    $namesCase = [regex]::Match($controlsSource, 'case\s+"'+[regex]::Escape($page)+'"\s*:\s*return\s+new\[\]\s*\{([^}]+)\}')
    $zones = if ($namesCase.Success) { [regex]::Matches($namesCase.Groups[1].Value, '"[^"]+"').Count } else { 0 }
    if ($rects.Count -ne $zones -or $zones -eq 0) { throw "Panel geometry/zone mismatch: $page ($($rects.Count) vs $zones)" }
    $signature = ($caseMatch.Groups[2].Value -replace '\s+', '')
    if ($geometrySignatures.ContainsKey($signature)) { throw "Repeated static workstation composition: $page and $($geometrySignatures[$signature])" }
    $geometrySignatures[$signature] = $page
    $boxes = @()
    foreach ($rect in $rects) {
        $n = @(1..4 | ForEach-Object { [double]::Parse($rect.Groups[$_].Value, [Globalization.CultureInfo]::InvariantCulture) })
        $boxes += ,@(($n[0]-$n[2]/2),($n[0]+$n[2]/2),($n[1]-$n[3]/2),($n[1]+$n[3]/2))
        $highestPanelTop = [Math]::Max($highestPanelTop, $boxes[-1][3])
        if ($n[2] -le 0 -or $n[3] -le 0 -or $boxes[-1][0] -lt -.2101 -or $boxes[-1][1] -gt .2101 -or $boxes[-1][2] -lt -.3201 -or $boxes[-1][3] -gt .1531) { $outOfBounds += "$page zone $($boxes.Count-1)" }
        $rectangles++
    }
    for ($i=0; $i -lt $boxes.Count; $i++) { for ($j=$i+1; $j -lt $boxes.Count; $j++) {
        $a=$boxes[$i]; $b=$boxes[$j]
        if ($page -ne 'Riferimenti CAD' -and
            [Math]::Min($a[3],$b[3]) - [Math]::Max($a[2],$b[2]) -gt .005 -and
            [Math]::Min($a[1],$b[1]) - [Math]::Max($a[0],$b[0]) -le .0005) { $sideBySide++ }
        if ([Math]::Min($a[1],$b[1])-[Math]::Max($a[0],$b[0]) -gt .0005 -and [Math]::Min($a[3],$b[3])-[Math]::Max($a[2],$b[2]) -gt .0005) {
            # Reference workflows are alternative visibility states; these overlaps
            # are allowed only when the mode-based surface toggling code exists.
            if ($page -ne 'Riferimenti CAD') { $overlaps += "$page zones $i/$j" }
        }
    }}

}
if ($controlsSource -notmatch 'RefreshReferencePanelSurfaces\(\)' -or $controlsSource -notmatch 'bool home = References\.IsHome, inspect = References\.IsInspecting, form = References\.IsFormOpen') { throw 'Reference modal-aware panel visibility contract missing' }
if ($rectangles -ne 37 -or $geometrySignatures.Count -ne 12 -or $sideBySide -lt 6) {
    throw "Quest two-column geometry regression: $rectangles zones, $($geometrySignatures.Count) distinct compositions, $sideBySide side-by-side pairs (require >=6)"
}
Write-Output "Offline spatial composition: $($geometrySignatures.Count) distinct page geometries and $sideBySide side-by-side nonmodal surface pairs."
Write-Output "Offline panel AABB check: $rectangles zone rectangles; $($outOfBounds.Count) outside safe bounds; $($overlaps.Count) non-modal zone intersections. Reference modal alternatives excluded."
if ($outOfBounds.Count) { throw ('Panel bounds regression: '+($outOfBounds -join '; ')) }
if ($overlaps.Count) { throw ('Nonmodal authored panel surface intersections: '+($overlaps -join '; ')) }

# The contextual surface contract must stay connected to real Quest/Desktop
# state, not simply compile as unused presentation helpers.
$uiSource = Get-Content -LiteralPath (Join-Path $project 'Assets\Kreoda\Runtime\QuestUi.cs') -Raw -Encoding UTF8
$homeSource = Get-Content -LiteralPath (Join-Path $project 'Assets\Kreoda\Runtime\QuestHome.cs') -Raw -Encoding UTF8
if ($controlsSource -notmatch 'RefreshContextualActions\(localPcs\)' -or
    $controlsSource -notmatch 'peers\[index\]\.PcId == _selectedPcId' -or
    $uiSource -notmatch 'void SetContext\(string heading, StatusSeverity severity, bool available\)' -or
    $controlsSource -notmatch 'panel\.SetContext\(' -or
    $homeSource -notmatch 'bool\? authenticated = null' -or
    $controlsSource -notmatch 'SetConnectionStatus\(Connection\.Status, Connection\.Connected\)') {
    throw 'Quest contextual UI regression: stateful panels, PC identity or authenticated Home binding missing'
}
$contextPages = @('_pcPage','_connectionPage','_homeNoticePage','_configurationPage',
    '_viewPage','_metricsPage','_sectionPage','_editPage','_commandPage',
    '_referencePage','_sketchPage','_voicePage')
foreach ($page in $contextPages) {
    if ($controlsSource -notmatch ('SetPanelContext\(' + [regex]::Escape($page) + ',')) {
        throw "Quest contextual UI regression: no live work-surface header for $page"
    }
}
Write-Output 'Offline contextual UI contract passed: 12 live operational surfaces, stable peer identity and authenticated Home state.'
# Authored panel roles remain semantic ownership; visible state now lives in
# the single page summary and the registered action details checked below.
$roleBlock = [regex]::Match($controlsSource, 'static\s+QuestUi\.OperationPanelRole\s+AuthoredPanelRole\(string page, int zone\)(?<body>.*?)(?=\s*static int ExpectedActions\()', 'Singleline')
$roleCases = @([regex]::Matches($roleBlock.Groups['body'].Value, 'case\s+"([^"]+)"\s*:') | ForEach-Object { $_.Groups[1].Value })
foreach ($page in $counts.Keys) {
    if ($page -cnotin $roleCases) { throw "Quest workstation lacks semantic role: $page" }
}
$livePages = $contextPages
# Independent live action / consequence integration: action IDs must also be
# members of the exact per-page registry, not fabricated display-only labels.
$liveActionBlock = [regex]::Match($controlsSource, 'void\s+RefreshLiveActionDetails\([^)]*\)(?<body>.*?)(?=\n\s*(?:static\s+)?(?:void|TextMesh|Vector3|int|bool)\s+\w+\()', 'Singleline')
if (!$liveActionBlock.Success -or $controlsSource -notmatch 'RefreshLiveActionDetails\(localPcs\)' -or
    $controlsSource -notmatch 'QuestUi\.SetActionDetail\(label, value,' -or
    $uiSource -notmatch 'public\s+static\s+void\s+SetActionDetail\(') {
    throw 'Quest live workflow integration missing: Update/action or panel consequence wiring'
}
$liveLiteralActions = @([regex]::Matches($liveActionBlock.Groups['body'].Value, 'SetLiveActionDetail\(\s*(_\w+Page)\s*,\s*"((?:\\.|[^"\\])*)"\s*,') )
$livePageFields = @{}
foreach ($actionMatch in $liveLiteralActions) {
    $field = $actionMatch.Groups[1].Value
    $page = @($pageCreates | Where-Object { $_.Groups[1].Value -eq $field })
    if ($page.Count -ne 1) { throw "Quest live action uses unknown page: $field" }
    $name = $page[0].Groups[2].Value
    $id = Convert-CSharpActionLiteral $actionMatch.Groups[2].Value
    if ($id -cnotin $identityMap[$name]) { throw "Quest live action '$id' not in WorkflowActionIds for $name" }
    $livePageFields[$field] = $true
}
if ($liveActionBlock.Groups['body'].Value -notmatch 'SetLiveActionDetail\(_pcPage,\s*"PC "\s*\+\s*\(slot\s*\+\s*1\)' -or
    $identityMap['PC locali'] -cnotcontains 'PC 1' -or $identityMap['PC locali'] -cnotcontains 'PC 4') {
    throw 'Quest live peer slots not grounded in four registered PC identities'
}
$livePageFields['_pcPage'] = $true
foreach ($field in $livePages) {
    if (!$livePageFields.ContainsKey($field)) { throw "Quest page missing real action-specific detail: $field" }
}
if ($liveLiteralActions.Count -lt 12 -or $controlsSource -notmatch 'Connection\.RttMilliseconds\.HasValue' -or
    $liveActionBlock.Groups['body'].Value -notmatch 'SketchDimensions\.Selected' -or
    $liveActionBlock.Groups['body'].Value -notmatch 'Commands\.FieldValue') {
    throw 'Quest live workflow lacks distinct service-derived field values'
}
Write-Output "Offline live workflow data passed: $($livePages.Count) page bindings, $($liveLiteralActions.Count) registered literal action details plus four peer slots; actual service values and panel consequences wired."
# CAD commands without editable fields can still be confirmable. The controls
# must consume the authoritative command contract, not SelectedField != null.
$commandsSource = Get-Content -LiteralPath (Join-Path $project 'Assets\Kreoda\Runtime\QuestCommands.cs') -Raw -Encoding UTF8
$connectionSource = Get-Content -LiteralPath (Join-Path $project 'Assets\Kreoda\Runtime\QuestConnection.cs') -Raw -Encoding UTF8
if ($commandsSource -notmatch 'public\s+bool\s+CanConfirm\s*=>' -or
    $controlsSource -notmatch 'SetContextAction\(_commandPage,\s*"Conferma",\s*commandsReady\s*&&\s*Commands\.CanConfirm\)' -or
    $commandsSource -notmatch 'if\s*\(!CanConfirm\)') {
    throw 'Quest CAD command confirmation is not bound to authoritative CanConfirm'
}
if ($controlsSource -notmatch 'section\.Plane\.Value\.Axis\.HasValue' -or
    $controlsSource -notmatch 'SectionAxis\.X' -or $controlsSource -notmatch 'SectionAxis\.Y' -or
    $controlsSource -notmatch 'SectionAxis\.Z' -or
    $connectionSource -notmatch '_scene\.IsCurrent\(ticket\)') {
    throw 'Quest section axis selection or stale scene request guard missing'
}
Write-Output 'Offline CAD confirmation, real section-axis selection and stale scene fencing passed.'
# Ensure semantic workstation commands are actual click targets attached to
# authored panels, with unique per-page action identities and live context.
$operationBody = $controlsSource.Substring($controlsSource.IndexOf('TextMesh OperationControl('))
if ($operationBody -notmatch 'SemanticZone\(page\.name, text\)' -or
    $operationBody -notmatch 'SemanticZoneCapacity\(page\.name, groupIndex\)' -or
    $operationBody -notmatch 'QuestUi\.CreateOperationPanel\(page,' -or
    $operationBody -notmatch 'panel\.SetRole\(AuthoredPanelRole\(page\.name, groupIndex\)\)' -or
    $operationBody -notmatch 'ComposedActionPosition\(page\.name, groupIndex, text,' -or
    $operationBody -notmatch 'QuestUi\.OperationAction\(panel\.Content, Font, ButtonMaterial, text, text,' -or
    $operationBody -notmatch 'action, RegisterTextBounds\)' -or
    $operationBody -notmatch 'bound\.ContainsKey\(text\)' -or
    $operationBody -notmatch 'bound\.Add\(text, label\)' -or
    $uiSource -notmatch 'public\s+static\s+TextMesh\s+OperationAction\(' -or
    $uiSource -notmatch 'Collider') {
    throw 'Quest functional workstation regression: action identity, click callback, collider or role not bound to real panel'
}
$referenceSurface = [regex]::Match($controlsSource, 'void\s+RefreshReferencePanelSurfaces\(\)(?<body>.*?)(?=\s*static void Show\()', 'Singleline')
if (!$referenceSurface.Success -or
    $referenceSurface.Groups['body'].Value -notmatch 'foreach\s*\(Transform child in panel\.Content\)' -or
    $referenceSurface.Groups['body'].Value -notmatch 'child\.gameObject\.activeSelf' -or
    $referenceSurface.Groups['body'].Value -notmatch 'panel\.Root\.gameObject\.SetActive\(hasVisibleAction\)' -or
    $controlsSource -notmatch 'RefreshReferencePanelSurfaces\(\);') {
    throw 'Quest modal reference regression: panel visibility no longer follows active action children'
}
Write-Output 'Offline interactive workstation structure passed: 12 per-page click routes, panel collider ownership and modal reference action visibility.'
# Telemetry displayed in the summary must still use actual session values.
if ($controlsSource -notmatch 'model && Connection\.TriangleBudget > 0 && Connection\.TriangleCount >= 0' -or
    $controlsSource -notmatch 'Mathf\.Clamp01\(\(float\)Connection\.TriangleCount / Connection\.TriangleBudget\)' -or
    $controlsSource -notmatch 'Connection\.RttMilliseconds\.HasValue') {
    throw 'Quest telemetry regression: actual connected mesh/RTT data binding missing'
}
# The primary authoring contract is ComposedActionPosition. The obsolete
# PerWorkflowControlGeometry/PlaceAction table may remain for migration, but
# MUST NOT be invoked by the actual OperationControl click-target builder.
$composedBody = [regex]::Match($controlsSource, 'static\s+Vector3\s+ComposedActionPosition\((?<body>.*?)(?=\n\s*static\s+void\s+ValidateComposedFootprints\()', 'Singleline')
$composedCases = [regex]::Match($controlsSource, 'static\s+AuthoredControl\s+AuthoredActionComposition\(string page, string action\)(?<body>.*?)(?=\n\s*static\s+Vector3\s+ComposedActionPosition\()', 'Singleline')
$composedValidator = [regex]::Match($controlsSource, 'static\s+void\s+ValidateComposedFootprints\(\)(?<body>.*?)(?=\n\s*void\s+CreateComposedCardArtwork\()', 'Singleline')
if (!$composedBody.Success -or !$composedCases.Success -or !$composedValidator.Success -or
    $operationBody -notmatch 'CreateComposedCardArtwork\(label, composition, hitWidth, hitHeight\)' -or
    $controlsSource -notmatch 'ValidateComposedFootprints\(\);' -or
    $composedBody.Groups['body'].Value -notmatch 'Array\.IndexOf\(WorkflowActionIds\(page, zone\), action\)' -or
    $composedBody.Groups['body'].Value -notmatch 'AuthoredActionComposition\(page, action\)' -or
    $composedValidator.Groups['body'].Value -notmatch 'checkedActions\s*!=\s*113' -or
    $composedValidator.Groups['body'].Value -notmatch 'xIntersection\s*>\s*\.0005f\s*&&\s*yIntersection\s*>\s*\.0005f' -or
    $composedValidator.Groups['body'].Value -notmatch 'SemanticZone\(page, ids\[i\]\)\s*!=\s*zone') {
    throw 'Quest composed card regression: 113 exact action ID bounds/zone, actual callback and pairwise overlap validation disconnected'
}
$authoredCases = @([regex]::Matches($composedCases.Groups['body'].Value, 'case\s+"([^"]+)"\s*:') | ForEach-Object { $_.Groups[1].Value })
foreach ($page in $counts.Keys) { if ($page -cnotin $authoredCases) { throw "Quest authored composition missing page $page" } }
if ($authoredCases.Count -ne 12) { throw 'Quest authored action composition requires exactly 12 distinct workflow cases' }
Write-Output 'Offline composed action source contract passed: 12 authored workflow roles and 113-ID C# rectangle validator wired. C# validator compiled in Roslyn checks, NOT EXECUTED by SourceOnly.'
# Legacy normalized slots below are retained as a secondary regression audit,
# not evidence for the NEW operational hitboxes.
# The slot arrays are authored literal Vector4s; do not claim Unity collider
# world-transform validation (that remains an Editor/device responsibility).
$slotStart = $controlsSource.IndexOf('static Vector4[] PerWorkflowControlGeometry(')
$slotEnd = $controlsSource.IndexOf('static string[] WorkflowActionIds(', $slotStart)
$capacityStart = $controlsSource.IndexOf('static int SemanticZoneCapacity(')
$capacityEnd = $controlsSource.IndexOf('TextMesh OperationControl(', $capacityStart)
if ($slotStart -lt 0 -or $slotEnd -le $slotStart -or $capacityStart -lt 0 -or $capacityEnd -le $capacityStart -or
    $controlsSource -notmatch 'hitWidth\s*=\s*contentWidth\s*\*\s*slot\.z' -or
    $controlsSource -notmatch 'hitHeight\s*=\s*panelHeight\s*\*\s*\.68f\s*\*\s*slot\.w' -or
    $controlsSource -notmatch 'Mathf\.Clamp\(y,\s*-panelHeight\s*\*\s*\.45f\s*\+\s*hitHeight\s*\*\s*\.5f,\s*panelHeight\s*\*\s*\.23f\s*-\s*hitHeight\s*\*\s*\.5f\)') {
    throw 'Quest hitbox geometry formula changed: cannot reproduce normalized action bounds'
}
$slotText = $controlsSource.Substring($slotStart, $slotEnd - $slotStart)
$capacityText = $controlsSource.Substring($capacityStart, $capacityEnd - $capacityStart)
$slotPages = @([regex]::Matches($slotText, 'case\s+"([^"]+)"\s*:(?<body>.*?)(?=\s*case\s+"|\s*default\s*:)', 'Singleline'))
$checkedHitboxes = 0
foreach ($slotPage in $slotPages) {
    $page = $slotPage.Groups[1].Value
    $capacityCase = [regex]::Match($capacityText, 'case\s+"' + [regex]::Escape($page) + '"\s*:\s*return\s+(?:new\[\]\s*\{(?<values>[^}]+)\}\[zone\]|(?<single>\d+))\s*;')
    if (!$capacityCase.Success) { throw "Quest hitbox capacity not parseable for $page" }
    $capacities = if ($capacityCase.Groups['single'].Success) { @([int]$capacityCase.Groups['single'].Value) } else { @($capacityCase.Groups['values'].Value.Split(',') | ForEach-Object { [int]$_.Trim() }) }
    $groups = @([regex]::Matches($slotPage.Groups['body'].Value, 'new\[\]\s*\{(?<slots>[^}]+)\}'))
    $parsedGroups = @()
    foreach ($group in $groups) {
        $vectors = @([regex]::Matches($group.Groups['slots'].Value, 'new\s+Vector4\(\s*([-.\d]+)f?\s*,\s*([-.\d]+)f?\s*,\s*([-.\d]+)f?\s*,\s*([-.\d]+)f?\s*\)'))
        if (!$vectors.Count) { throw "Quest hitbox literals missing in $page" }
        $parsedGroups += ,$vectors
    }
    $nextGroup = 0
    $previousGroup = -1
    foreach ($zone in 0..($capacities.Count - 1)) {
        $count = $capacities[$zone]
        if ($nextGroup -lt $parsedGroups.Count -and $parsedGroups[$nextGroup].Count -eq $count) {
            $groupIndex = $nextGroup; $nextGroup++
        } elseif ($previousGroup -ge 0 -and $parsedGroups[$previousGroup].Count -eq $count) {
            $groupIndex = $previousGroup
        } else { throw "Quest hitbox zone layout ambiguous: $page zone $zone" }
        $previousGroup = $groupIndex
        $hitboxes = @()
        foreach ($vector in $parsedGroups[$groupIndex]) {
            $n = @(1..4 | ForEach-Object { [double]::Parse($vector.Groups[$_].Value, [Globalization.CultureInfo]::InvariantCulture) })
            $w = $n[2]; $h = .68 * $n[3]
            $low = -.45 + $h / 2; $high = .23 - $h / 2
            if ($low -gt $high -or $w -le 0 -or $h -le 0) { throw "Invalid Quest action hitbox size: $page zone $zone" }
            $y = [Math]::Max($low, [Math]::Min($high, -.11 + $n[1] * .68))
            $box = @(($n[0]-$w/2),($n[0]+$w/2),($y-$h/2),($y+$h/2))
            if ($box[0] -lt -.5001 -or $box[1] -gt .5001 -or $box[2] -lt -.4501 -or $box[3] -gt .2301) {
                throw "Quest action hitbox leaves content: $page zone $zone"
            }
            foreach ($prior in $hitboxes) {
                if ([Math]::Min($box[1],$prior[1]) - [Math]::Max($box[0],$prior[0]) -gt .0005 -and
                    [Math]::Min($box[3],$prior[3]) - [Math]::Max($box[2],$prior[2]) -gt .0005) {
                    throw "Quest action hitbox collision: $page zone $zone"
                }
            }
            $hitboxes += ,$box; $checkedHitboxes++
        }
    }
    if ($nextGroup -ne $parsedGroups.Count) { throw "Quest unused authored hitbox slots: $page" }
}
if ($checkedHitboxes -ne 113) { throw "Quest hitbox expansion expected 113, found $checkedHitboxes" }
Write-Output "Offline LEGACY slot geometry check passed: $checkedHitboxes old normalized action slots. NOT a numeric test of the NEW AuthoredActionComposition click-hitboxes."
# LiveFocusStage is a distinct, ray-transparent functional surface above the
# authored actions, not a replacement for the 37 modal-aware action panels.
$focusFactory = [regex]::Match($controlsSource, 'void\s+CreateDomainFocus\(Transform page, string pageName\)(?<body>.*?)(?=\n\s*void\s+RefreshDomainFocusStages\()', 'Singleline')
$focusLookup = [regex]::Match($controlsSource, 'static\s+FocusKind\s+FocusFor\(string page\)(?<body>.*?)(?=\n\s*(?:static|void)\s+\w+\s*\()', 'Singleline')
$focusRefresh = [regex]::Match($controlsSource, 'void\s+RefreshDomainFocusStages\(\)(?<body>.*?)(?=\n\s*void\s+AddPageSummary\()', 'Singleline')
$focusCases = if ($focusLookup.Success) { @([regex]::Matches($focusLookup.Groups['body'].Value, 'case\s+"([^"]+)"\s*:') | ForEach-Object { $_.Groups[1].Value }) } else { @() }
if (!$focusFactory.Success -or !$focusRefresh.Success -or $focusCases.Count -ne 12 -or
    $controlsSource -notmatch 'CreateDomainFocus\(page, name\)' -or
    $controlsSource -notmatch 'RefreshDomainFocusStages\(\);' -or
    $focusFactory.Groups['body'].Value -notmatch 'FocusFor\(pageName\)' -or
    $focusFactory.Groups['body'].Value -notmatch '_domainFocus\.Add\(page, new DomainFocus' -or
    $focusFactory.Groups['body'].Value -notmatch 'QuestUi\.CreateLiveFocusStage\(page, Font, PanelMaterial,\s*PageTitle\(pageName\), new Vector3\(0,\s*\.163f,\s*\.011f\),\s*\.394f,\s*\.105f' -or
    $focusRefresh.Groups['body'].Value -notmatch 'CurrentFocus\(focus\.Kind\)' -or
    $focusRefresh.Groups['body'].Value -notmatch 'focus\.Stage\.SetData\(' -or
    $uiSource -notmatch 'public\s+sealed\s+class\s+LiveFocusStage\s*:\s*IDisposable' -or
    $uiSource -notmatch 'public\s+static\s+LiveFocusStage\s+CreateLiveFocusStage\(') {
    throw 'Quest live focus regression: require 12 instantiated, independently refreshed service-bound stages'
}
foreach ($page in $counts.Keys) { if ($page -cnotin $focusCases) { throw "Quest focus kind missing for $page" } }
$stageBottom = .163 - .105 / 2; $stageTop = .163 + .105 / 2
if ($highestPanelTop -gt $stageBottom - .004 -or $stageTop -gt .2175 - .001 -or
    .394 / 2 -gt .2101 -or $focusFactory.Groups['body'].Value -match 'FocusShape\(' -or
    $uiSource -notmatch 'GetComponent<Collider>\(\)\.enabled\s*=\s*false') {
    throw "Quest focus geometry/raycast regression: focus y=$stageBottom..$stageTop, authored panel top=$highestPanelTop"
}
Write-Output "Offline live-focus contract passed: 12 mapped service stages, .394x.105m, top $stageTop below tabs, bottom $stageBottom above panels (max $highestPanelTop), ray-transparent primitives."
# Source checks for the new ACTUAL control-local workstation instruments, not
# just the existing 37 headings / page role names. The same registered
# QuestButton retains its callback: each new icon/diagram/recording indicator
# is made of ray-transparent surfaces and driven by genuine service snapshots.
$instrumentBlock = [regex]::Match($controlsSource,
    'static\s+ActionInstrumentKind\?\s+InstrumentFor\(string page, string action\)(?<body>.*?)(?=\s*void CreateActionInstrument\()', 'Singleline')
$instrumentRefresh = [regex]::Match($controlsSource,
    'void\s+RefreshDomainActionCards\([^)]*\)(?<body>.*?)(?=\s*(?:// Each workspace|static Vector4\[\] PerWorkflowControlGeometry))', 'Singleline')
if (!$instrumentBlock.Success -or !$instrumentRefresh.Success -or
    $controlsSource -notmatch 'CreateActionInstrument\(page\.name, text, label, hitWidth, hitHeight\)' -or
    $controlsSource -notmatch 'RefreshDomainActionCards\(localPcs\)' -or
    $controlsSource -notmatch 'QuestUi\.SetActionDataCard\(label, actualDetail, selected, enabled, severity\)' -or
    $controlsSource -notmatch 'QuestUi\.Surface\(root, _instrumentGlass,' -or
    $uiSource -notmatch 'public static void SetActionDataCard\(' -or
    $uiSource -notmatch 'var\s+detail\s*=\s*actualDetail\s*\?\?\s*string\.Empty' -or
    $uiSource -notmatch 'SetActionDetail\(actionLabel, detail, severity\)' -or
    $uiSource -notmatch 'SetOperationActionState\(actionLabel, selected, enabled, severity\)' -or
    $uiSource -notmatch 'GetComponent<Collider>\(\)\.enabled = false') {
    throw 'Quest functional instrument not instantiated inside original raycastable QuestButton'
}
$instrumentPages = @([regex]::Matches($instrumentBlock.Groups['body'].Value, 'case\s+"([^"]+)"\s*:') |
    ForEach-Object { $_.Groups[1].Value })
foreach ($page in $counts.Keys) {
    if ($page -cnotin $instrumentPages) { throw "Quest page missing functional control instrument: $page" }
}
foreach ($field in $livePages) {
    if ($instrumentRefresh.Groups['body'].Value -notmatch ('SetDomainActionCard\(\s*' + [regex]::Escape($field) + '\s*,')) {
        throw "Quest page missing live instrument refresh: $field"
    }
}
$instrumentLiteralActions = @([regex]::Matches($instrumentRefresh.Groups['body'].Value,
    'SetDomainActionCard\(\s*(_\w+Page)\s*,\s*"((?:\\.|[^"\\])*)"\s*,'))
foreach ($item in $instrumentLiteralActions) {
    $origin = @($pageCreates | Where-Object { $_.Groups[1].Value -eq $item.Groups[1].Value })
    if ($origin.Count -ne 1) { throw "Quest instrument targets unknown page $($item.Groups[1].Value)" }
    $name = $origin[0].Groups[2].Value
    $id = Convert-CSharpActionLiteral $item.Groups[2].Value
    if ($id -cnotin $identityMap[$name]) { throw "Quest instrument ID not registered for $name : $id" }
}
if ($controlsSource -notmatch 'center\.z\s*-\s*\.0047f' -or
    $controlsSource -notmatch 'var\s+metricBar\s*=\s*active\s*&&\s*visual\.Kind\s*==\s*ActionInstrumentKind\.Metric\s*&&\s*validMagnitude' -or
    $controlsSource -notmatch 'var\s+ratio\s*=\s*metricBar\s*\?\s*normalized\s*:\s*1f') {
    throw 'Quest instrument depth or real-only metric/selection indicator contract regressed'
}
Write-Output "Offline interactive instrument construction passed: $($instrumentPages.Count) distinct workflows and $($instrumentLiteralActions.Count) registered literal action-card bindings."
# The MR placement outline is a *physical* CAD footprint calculated from true
# current mesh bounds and Root scale. Every edge must be noncolliding and lost
# tracking must hide the marker before a placement can be confirmed.
$displaySource = Get-Content -LiteralPath (Join-Path $project 'Assets\Kreoda\Runtime\QuestDisplay.cs') -Raw -Encoding UTF8
if ($displaySource -notmatch 'void\s+CreatePlacementFootprint\(' -or
    $displaySource -notmatch 'void\s+UpdatePlacementFootprint\(' -or
    $displaySource -notmatch '\(max\.x\s*-\s*min\.x\)\s*\*\s*Root\.localScale\.x' -or
    $displaySource -notmatch '\(max\.z\s*-\s*min\.z\)\s*\*\s*Root\.localScale\.z' -or
    $displaySource -notmatch '_marker\.SetActive\(false\)' -or
    $displaySource -notmatch 'edge\.GetComponent<Collider>\(\)\.enabled\s*=\s*false' -or
    $displaySource -notmatch 'RemoveMarker\(\)') {
    throw 'Quest real-world CAD placement footprint/interactive safety contract missing'
}
Write-Output 'Offline real-CAD placement footprint passed: scaled mesh bounds, ray-transparent edges, tracking-loss hide and cleanup.'
if ($SourceOnly) {
    if ($InstallToQuest) { throw 'SourceOnly cannot be combined with InstallToQuest' }
    Write-Output 'Source-only preflight complete. No Unity Editor, license check, GPU capture or APK attempted.'
    return
}

if (!(Test-Path $Unity) -or !(Test-Path $UnityCli)) { throw 'Unity Editor or Unity CLI missing' }
$license = (& $UnityCli license status 2>&1 | Out-String)
Write-Output $license
if ($license -notmatch 'License: active' -or $license -notmatch 'Signed in: yes') { throw 'Unity Editor license inactive; no build/render attempted' }
$active = Get-CimInstance Win32_Process -Filter "name='Unity.exe'" | Where-Object { $_.CommandLine -like '*quest-unity*' }
if ($active) { throw 'Unity project is already open. Close the other Unity instance to avoid project lock.' }
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
$captureStarted = Get-Date
$captureStartedUtc = $captureStarted.ToUniversalTime()
$p = Start-Process -FilePath $Unity -WindowStyle Hidden -ArgumentList @('-batchmode','-quit','-projectPath',('"'+$project+'"'),'-executeMethod','Kreoda.QuestEditor.QuestHomeRender.Capture','-logFile',('"'+$log+'"')) -PassThru -Wait
if ($p.ExitCode -ne 0) { throw "Unity visual capture failed with exit $($p.ExitCode); see $log" }
$manifestPath = Join-Path $proof 'capture-manifest.json'
if (!(Test-Path -LiteralPath $manifestPath)) { throw "Missing capture manifest: $manifestPath" }
if ((Get-Item -LiteralPath $manifestPath).LastWriteTimeUtc -lt $captureStartedUtc.AddSeconds(-2)) { throw 'Stale capture manifest' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.kind -ne 'Unity Editor scene reconstruction; no XR device, live CAD session or passthrough') { throw 'Unexpected capture manifest provenance' }
if ($manifest.width -ne 1600 -or $manifest.height -ne 900) { throw 'Unexpected capture resolution' }
if ([DateTime]::Parse($manifest.capturedUtc).ToUniversalTime() -lt $captureStartedUtc.AddSeconds(-2)) { throw 'Stale capture manifest timestamp' }
if (($manifest.pages -join '|') -ne ($required -join '|') -or $manifest.sha256.Count -ne $required.Count) { throw 'Incomplete or reordered page manifest' }
for ($i = 0; $i -lt $required.Count; $i++) {
    $name = $required[$i]
    $path = Join-Path $proof $name
    if (!(Test-Path -LiteralPath $path)) { throw "Missing required page capture $path" }
    if ((Get-Item -LiteralPath $path).LastWriteTimeUtc -lt $captureStartedUtc.AddSeconds(-2)) {
        throw "Stale visual proof (not produced by this Unity run): $path"
    }
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $manifest.sha256[$i]) { throw "Capture hash mismatch: $path" }
    if ((Get-Item -LiteralPath $path).Length -lt 1024) { throw "Suspiciously small capture: $path" }
    Write-Output "Fresh Unity render ready for visual inspection: $path"
}
Write-Output 'All 13 required captures are current and matched to the manifest (Home + 12 secondary screens). These are reconstructed Editor renders with no XR session; manually inspect PNG graphics before APK build.'
if ($InstallToQuest) {
    throw 'Install deliberately gated: visually compare Home + workspace against original reference, then use scripts/build-quest-client.mjs and adb install -r.'
}
