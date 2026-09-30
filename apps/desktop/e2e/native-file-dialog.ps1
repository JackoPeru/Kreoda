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
    [System.Windows.Automation.TreeScope]::Descendants, $condition)
  if ($null -eq $dialog) { Start-Sleep -Milliseconds 100 }
}
if ($null -eq $dialog) { throw "No native file dialog for process $TargetProcessId" }
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
$buttonId = if ($Action -eq 'Cancel') { '2' } else { '1' }
$button = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.AndCondition]::new(
    [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $buttonId),
    [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))
if ($null -eq $button) { throw "No action button $buttonId in '$title'" }
$invoke = $null
if (-not $button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
  throw "Button '$($button.Current.Name)' ($buttonId, class '$($button.Current.ClassName)') does not support InvokePattern"
}
$invoke.Invoke()
$closedDeadline = [DateTime]::UtcNow.AddSeconds(5)
do {
  $remaining = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants, $condition)
  if ($null -ne $remaining) { Start-Sleep -Milliseconds 100 }
} while ($null -ne $remaining -and [DateTime]::UtcNow -lt $closedDeadline)
if ($null -ne $remaining) { throw "Native $Kind dialog did not close" }
[pscustomobject]@{ processId = $TargetProcessId; kind = $Kind; title = $title; action = $Action; filePath = $FilePath } |
  ConvertTo-Json -Compress
