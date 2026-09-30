param(
  [Parameter(Mandatory)][int]$TargetProcessId,
  [Parameter(Mandatory)][ValidateSet('Save', 'Open')][string]$Kind,
  [ValidateSet('Accept', 'Cancel')][string]$Action = 'Accept',
  [string]$FilePath = ''
)
$ErrorActionPreference = 'Stop'
# Only the disposable hosted runner may open/control native dialogs.
if ($env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true') {
  throw 'Native file dialog automation is restricted to GitHub Actions'
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$condition = [System.Windows.Automation.AndCondition]::new(
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $TargetProcessId),
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, '#32770')
)
$deadline = [DateTime]::UtcNow.AddSeconds(30)
$dialog = $null
while ($null -eq $dialog -and [DateTime]::UtcNow -lt $deadline) {
  $dialog = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
    # Desktop children are top-level windows; descendants may match the
    # dialog's embedded folder-view panel and omit its action controls.
    [System.Windows.Automation.TreeScope]::Children, $condition)
  if ($null -eq $dialog) { Start-Sleep -Milliseconds 100 }
}
if ($null -eq $dialog) {
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $TargetProcessId))
  $details = @(foreach ($window in $windows) {
    [pscustomobject]@{ name = $window.Current.Name; class = $window.Current.ClassName;
      type = $window.Current.ControlType.ProgrammaticName; handle = $window.Current.NativeWindowHandle }
  })
  throw "No top-level native file dialog for process ${TargetProcessId}: $($details | ConvertTo-Json -Compress)"
}
$title = $dialog.Current.Name
$expectedTitle = if ($Kind -eq 'Save') { '^Save( As)?$' } else { '^Open$' }
if ($title -notmatch $expectedTitle) { throw "Unexpected $Kind dialog title '$title'" }
if ($Action -eq 'Accept') {
  if (-not [IO.Path]::IsPathRooted($FilePath)) { throw 'An absolute test file path is required' }
  $edits = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit))
  $filename = $null
  foreach ($edit in $edits) {
    if ($edit.Current.AutomationId -in @('1001', '1148') -or $edit.Current.Name -eq 'File name:') {
      $filename = $edit; break
    }
  }
  if ($null -eq $filename) { throw "No File name edit in '$title'" }
  $value = $filename.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $value.SetValue($FilePath)
}
$buttonName = if ($Action -eq 'Cancel') { 'Cancel' } elseif ($Kind -eq 'Save') { 'Save' } else { 'Open' }
# UIA AutomationId is provider-defined; it is not the Win32 IDOK/IDCANCEL id.
$buttonCondition = [System.Windows.Automation.PropertyCondition]::new(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$buttonDeadline = [DateTime]::UtcNow.AddSeconds(10)
$button = $null
$buttonDetails = @()
do {
  $buttons = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
  $actionCandidates = @()
  $buttonDetails = @(foreach ($candidate in $buttons) {
    $current = $candidate.Current
    if ($current.Name.Replace('&', '') -eq $buttonName -and $current.IsEnabled) { $actionCandidates += $candidate }
    [pscustomobject]@{ name = $current.Name; id = $current.AutomationId; class = $current.ClassName;
      enabled = $current.IsEnabled; patterns = @($candidate.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName }) }
  })
  if ($actionCandidates.Count -gt 1) { throw "Ambiguous '$buttonName' buttons in '$title': $($buttonDetails | ConvertTo-Json -Compress)" }
  if ($actionCandidates.Count -eq 1) { $button = $actionCandidates[0] }
  if ($null -eq $button) { Start-Sleep -Milliseconds 100 }
} while ($null -eq $button -and [DateTime]::UtcNow -lt $buttonDeadline)
if ($null -eq $button) { throw "No enabled '$buttonName' button in '$title' (root handle $($dialog.Current.NativeWindowHandle), type $($dialog.Current.ControlType.ProgrammaticName)): $($buttonDetails | ConvertTo-Json -Compress)" }
$invoke = $null
if (-not $button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
  throw "Button '$buttonName' does not support InvokePattern: $($buttonDetails | ConvertTo-Json -Compress)"
}
$invoke.Invoke()
$closedDeadline = [DateTime]::UtcNow.AddSeconds(5)
do {
  $remaining = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
    [System.Windows.Automation.TreeScope]::Children, $condition)
  if ($null -ne $remaining) { Start-Sleep -Milliseconds 100 }
} while ($null -ne $remaining -and [DateTime]::UtcNow -lt $closedDeadline)
if ($null -ne $remaining) { throw "Native $Kind dialog did not close" }
[pscustomobject]@{ processId = $TargetProcessId; kind = $Kind; title = $title; action = $Action; filePath = $FilePath; rootScope = 'desktop.Children' } |
  ConvertTo-Json -Compress
