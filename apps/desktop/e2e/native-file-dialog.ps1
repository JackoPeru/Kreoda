param(
  [Parameter(Mandatory)][ValidateRange(1, 2147483647)][int]$TargetProcessId,
  [Parameter(Mandatory)][ValidateSet('Save', 'Open')][string]$Kind,
  [ValidateSet('Accept', 'Cancel')][string]$Action = 'Accept',
  [string]$FilePath = ''
)
$ErrorActionPreference = 'Stop'
if ($env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true') {
  throw 'Native file dialog automation is restricted to GitHub Actions'
}
# UIA re-parents the common dialog and exposes only part of its controls on
# the hosted runner. Use native HWNDs and real control IDs, scoped to its PID.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public sealed class PickerWindow {
  public IntPtr Handle;
  public string Title;
  public string Class;
  public int Id;
  public bool Visible;
  public bool Enabled;
}
public static class NativePicker {
  private delegate bool EnumProc(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll", SetLastError=true)] private static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", SetLastError=true)] private static extern IntPtr SendControl(IntPtr window, uint message, UIntPtr wparam, IntPtr lparam, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", CharSet=CharSet.Unicode, SetLastError=true)] private static extern IntPtr SendText(IntPtr window, uint message, UIntPtr wparam, string text, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", CharSet=CharSet.Unicode, SetLastError=true)] private static extern IntPtr ReadText(IntPtr window, uint message, UIntPtr wparam, StringBuilder text, uint flags, uint timeout, out UIntPtr result);
  private static PickerWindow Read(IntPtr window) {
    var title = new StringBuilder(2048);
    var name = new StringBuilder(256);
    GetWindowText(window, title, title.Capacity);
    GetClassName(window, name, name.Capacity);
    return new PickerWindow { Handle=window, Title=title.ToString(), Class=name.ToString(),
      Id=GetDlgCtrlID(window), Visible=IsWindowVisible(window), Enabled=IsWindowEnabled(window) };
  }
  public static PickerWindow[] Windows(int pid) {
    var windows = new List<PickerWindow>();
    if (!EnumWindows((window, parameter) => {
      uint owner; GetWindowThreadProcessId(window, out owner);
      if (owner == (uint)pid) windows.Add(Read(window));
      return true;
    }, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
    return windows.ToArray();
  }
  public static PickerWindow[] Controls(IntPtr parent, int pid) {
    var controls = new List<PickerWindow>();
    EnumChildWindows(parent, (window, parameter) => {
      uint owner; GetWindowThreadProcessId(window, out owner);
      if (owner == (uint)pid) controls.Add(Read(window));
      return true;
    }, IntPtr.Zero);
    return controls.ToArray();
  }
  public static void SetFileName(IntPtr edit, string path) {
    UIntPtr result;
    if (SendText(edit, 0x000C, UIntPtr.Zero, path, 0x0002, 5000, out result) == IntPtr.Zero || result == UIntPtr.Zero)
      throw new Win32Exception(Marshal.GetLastWin32Error(), "File-name WM_SETTEXT failed");
  }
  public static string Text(IntPtr control) {
    var text = new StringBuilder(2048);
    UIntPtr result;
    // GetWindowText cannot read another process's control text.
    if (ReadText(control, 0x000D, new UIntPtr((uint)text.Capacity), text, 0x0002, 1000, out result) == IntPtr.Zero)
      throw new Win32Exception(Marshal.GetLastWin32Error(), "Control WM_GETTEXT failed");
    return text.ToString();
  }
  public static void Click(IntPtr button) {
    UIntPtr result;
    if (SendControl(button, 0x00F5, UIntPtr.Zero, IntPtr.Zero, 0x0002, 5000, out result) == IntPtr.Zero)
      throw new Win32Exception(Marshal.GetLastWin32Error(), "Button BM_CLICK failed");
  }
}
'@
function Describe-Windows($windows) {
  @($windows | ForEach-Object {
    [pscustomobject]@{ handle=$_.Handle.ToInt64(); title=$_.Title; class=$_.Class;
      id=$_.Id; visible=$_.Visible; enabled=$_.Enabled }
  }) | ConvertTo-Json -Compress
}
$expectedTitle = if ($Kind -eq 'Save') { '^Save( As)?$' } else { '^Open$' }
$deadline = [DateTime]::UtcNow.AddSeconds(30)
$dialog = $null
do {
  $windows = [NativePicker]::Windows($TargetProcessId)
  $dialogs = @($windows | Where-Object { $_.Visible -and $_.Class -eq '#32770' -and $_.Title -match $expectedTitle })
  if ($dialogs.Count -gt 1) { throw "Ambiguous native $Kind dialog: $(Describe-Windows $dialogs)" }
  if ($dialogs.Count -eq 1) { $dialog = $dialogs[0] }
  if ($null -eq $dialog) { Start-Sleep -Milliseconds 100 }
} while ($null -eq $dialog -and [DateTime]::UtcNow -lt $deadline)
if ($null -eq $dialog) { throw "No native $Kind dialog for process ${TargetProcessId}: $(Describe-Windows $windows)" }
$controls = [NativePicker]::Controls($dialog.Handle, $TargetProcessId)
if ($Action -eq 'Accept') {
  if (-not [IO.Path]::IsPathRooted($FilePath)) { throw 'An absolute test file path is required' }
  $edits = @($controls | Where-Object { $_.Visible -and $_.Enabled -and $_.Class -eq 'Edit' -and $_.Id -in @(1001, 1148, 1152) })
  if ($edits.Count -ne 1) { throw "Expected one native File name edit: $(Describe-Windows $controls)" }
  [NativePicker]::SetFileName($edits[0].Handle, $FilePath)
  $enteredFilePath = [NativePicker]::Text($edits[0].Handle)
  if ($enteredFilePath -ne $FilePath) { throw "Native filename text '$enteredFilePath' does not match '$FilePath'" }
}
$buttonId = if ($Action -eq 'Cancel') { 2 } else { 1 }
$buttonName = if ($Action -eq 'Cancel') { 'Cancel' } elseif ($Kind -eq 'Save') { 'Save' } else { 'Open' }
$buttons = @($controls | Where-Object { $_.Visible -and $_.Enabled -and $_.Class -eq 'Button' -and $_.Id -eq $buttonId })
if ($buttons.Count -ne 1) { throw "Expected one native '$buttonName' button ($buttonId): $(Describe-Windows $controls)" }
$caption = [NativePicker]::Text($buttons[0].Handle)
if ($caption.Replace('&', '') -ne $buttonName) { throw "Native button $buttonId caption '$caption' does not match '$buttonName'" }
[NativePicker]::Click($buttons[0].Handle)
$closedDeadline = [DateTime]::UtcNow.AddSeconds(5)
while ([NativePicker]::IsWindow($dialog.Handle) -and [DateTime]::UtcNow -lt $closedDeadline) { Start-Sleep -Milliseconds 100 }
if ([NativePicker]::IsWindow($dialog.Handle)) { throw "Native $Kind dialog did not close" }
[pscustomobject]@{ processId=$TargetProcessId; kind=$Kind; title=$dialog.Title; action=$Action;
  filePath=$FilePath; enteredFilePath=$enteredFilePath; rootScope='Win32.EnumWindows'; rootHandle=$dialog.Handle.ToInt64(); buttonId=$buttonId } | ConvertTo-Json -Compress
