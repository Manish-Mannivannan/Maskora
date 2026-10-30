# Answer Maskora's native "Open PDF" dialog during a smoke run.
#
#   powershell -File scripts/dialog.ps1 -Path <file>     choose a file
#   powershell -File scripts/dialog.ps1 -Cancel          dismiss the dialog
#
# Waits for the dialog window, focuses it, then types like a person would.
# Only the smoke script calls this; the app itself never automates its dialog.
param(
  [string]$Path,
  [switch]$Cancel,
  [int]$TimeoutSeconds = 20
)

$shell = New-Object -ComObject WScript.Shell
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while (-not $shell.AppActivate("Open PDF")) {
  if ((Get-Date) -gt $deadline) { Write-Error "dialog 'Open PDF' did not appear"; exit 1 }
  Start-Sleep -Milliseconds 200
}
Start-Sleep -Milliseconds 400
if ($Cancel) {
  $shell.SendKeys("{ESC}")
} else {
  $shell.SendKeys("%n")   # focus the File name box
  Start-Sleep -Milliseconds 150
  $shell.SendKeys($Path)
  Start-Sleep -Milliseconds 150
  $shell.SendKeys("{ENTER}")
}
exit 0
