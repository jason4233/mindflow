param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('inspect', 'minimize')]
  [string] $Action,

  [Parameter(Mandatory = $true)]
  [int] $TargetProcessId
)

$nativeMethods = @'
using System;
using System.Runtime.InteropServices;

public static class MindFlowWindowState
{
    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
}
'@

Add-Type -TypeDefinition $nativeMethods

$process = Get-Process -Id $TargetProcessId -ErrorAction Stop
$process.Refresh()
$handle = $process.MainWindowHandle
if ($handle -eq [IntPtr]::Zero) {
  $allProcesses = @(Get-CimInstance Win32_Process)
  $processIds = New-Object System.Collections.Generic.List[int]
  $processIds.Add($TargetProcessId)
  for ($index = 0; $index -lt $processIds.Count; $index += 1) {
    $parentId = $processIds[$index]
    foreach ($child in @($allProcesses | Where-Object { $_.ParentProcessId -eq $parentId })) {
      if (-not $processIds.Contains([int] $child.ProcessId)) {
        $processIds.Add([int] $child.ProcessId)
      }
    }
  }
  $details = foreach ($processId in $processIds) {
    try {
      $candidate = Get-Process -Id $processId -ErrorAction Stop
      $candidate.Refresh()
      [ordered]@{
        processId = $candidate.Id
        name = $candidate.ProcessName
        handle = $candidate.MainWindowHandle.ToInt64()
        title = $candidate.MainWindowTitle
      }
    } catch {
      [ordered]@{ processId = $processId; exited = $true }
    }
  }
  throw "PID $TargetProcessId has no main window handle; tree=$($details | ConvertTo-Json -Compress)"
}

if ($Action -eq 'minimize') {
  $null = [MindFlowWindowState]::ShowWindowAsync($handle, 6)
  Start-Sleep -Milliseconds 100
}

$process.Refresh()
$handle = $process.MainWindowHandle

[ordered]@{
  processId = $process.Id
  handle = $handle.ToInt64()
  title = $process.MainWindowTitle
  responding = $process.Responding
  minimized = [MindFlowWindowState]::IsIconic($handle)
  visible = [MindFlowWindowState]::IsWindowVisible($handle)
  foreground = ([MindFlowWindowState]::GetForegroundWindow() -eq $handle)
} | ConvertTo-Json -Compress
