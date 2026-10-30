# Answer Maskora's native "Open PDF" dialog during a smoke or probe run.
#
#   powershell -ExecutionPolicy Bypass -File scripts/dialog.ps1 -Path <file>   choose a file
#   powershell -ExecutionPolicy Bypass -File scripts/dialog.ps1 -Cancel        dismiss the dialog
#
# Waits for the dialog window, focuses it, then types like a person would, and
# confirms the dialog closed. Typed keys can be lost if focus moves while the
# dialog is still opening, so an answer that leaves the dialog open is retried.
# Only the smoke and probe scripts call this; the app never automates its dialog.
param(
  [string]$Path,
  [switch]$Cancel,
  [int]$TimeoutSeconds = 20,
  [int]$Attempts = 3
)

$shell = New-Object -ComObject WScript.Shell
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while (-not $shell.AppActivate("Open PDF")) {
  if ((Get-Date) -gt $deadline) { Write-Error "dialog 'Open PDF' did not appear"; exit 1 }
  Start-Sleep -Milliseconds 200
}

for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
  Start-Sleep -Milliseconds (400 * $attempt)
  if (-not $shell.AppActivate("Open PDF")) { exit 0 }   # already closed
  if ($Cancel) {
    $shell.SendKeys("{ESC}")
  } else {
    $shell.SendKeys("%n")   # focus the File name box
    Start-Sleep -Milliseconds 200
    $shell.SendKeys("^a")
    $shell.SendKeys($Path)
    Start-Sleep -Milliseconds 200
    $shell.SendKeys("{ENTER}")
  }
  Start-Sleep -Milliseconds 800
  if (-not $shell.AppActivate("Open PDF")) { exit 0 }   # the dialog closed: answered
}
Write-Error "dialog 'Open PDF' was still open after $Attempts attempts"
exit 1
