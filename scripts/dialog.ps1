# Answer one of Maskora's native file dialogs during a smoke or probe run.
#
#   powershell -ExecutionPolicy Bypass -File scripts/dialog.ps1 -Path <file>                choose a file in "Open PDF"
#   powershell -ExecutionPolicy Bypass -File scripts/dialog.ps1 -Cancel                     dismiss the dialog
#   powershell -ExecutionPolicy Bypass -File scripts/dialog.ps1 -Title "Save project" -Path <file> [-Replace yes|no]
#
# Waits for the dialog window titled -Title, focuses it, then enters the path
# as a person would (pasting it), and confirms the dialog closed. Typed keys can be lost if
# focus moves while the dialog is still opening, so an answer that leaves the
# dialog open is retried. A save dialog asked to write over an existing file
# shows "Confirm Save As": -Replace yes confirms it; -Replace no declines,
# after which the save dialog is dismissed, so the save reads as cancelled.
# Only the smoke and probe scripts call this; the app never automates its dialog.
param(
  [string]$Title = "Open PDF",
  [string]$Path,
  [switch]$Cancel,
  [ValidateSet("", "yes", "no")][string]$Replace = "",
  [int]$TimeoutSeconds = 20,
  [int]$Attempts = 5
)

$shell = New-Object -ComObject WScript.Shell
$script:confirmed = $false
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while (-not $shell.AppActivate($Title)) {
  if ((Get-Date) -gt $deadline) { Write-Error "dialog '$Title' did not appear"; exit 1 }
  Start-Sleep -Milliseconds 200
}

function Answer-Confirmation {
  # The replace prompt appears a moment after the file name is accepted.
  for ($i = 0; $i -lt 25; $i++) {
    if ($shell.AppActivate("Confirm Save As")) {
      Start-Sleep -Milliseconds 300
      if ($Replace -eq "yes") { $shell.SendKeys("%y") } else { $shell.SendKeys("%n") }
      Start-Sleep -Milliseconds 600
      if ($Replace -eq "no" -and $shell.AppActivate($Title)) {
        Start-Sleep -Milliseconds 300
        $shell.SendKeys("{ESC}")
      }
      return $true
    }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
  Start-Sleep -Milliseconds (400 * $attempt)
  if (-not $shell.AppActivate($Title)) { exit 0 }   # already closed
  if ($Cancel) {
    $shell.SendKeys("{ESC}")
  } else {
    $shell.SendKeys("%n")   # focus the File name box
    Start-Sleep -Milliseconds 200
    $shell.SendKeys("^a")
    # Pasted, not typed: typed characters can be dropped while the dialog settles.
    Set-Clipboard -Value $Path
    $shell.SendKeys("^v")
    # Let the name box's autocomplete settle, or it takes the Enter meant for the dialog.
    Start-Sleep -Milliseconds 500
    $shell.SendKeys("{ENTER}")
    if ($Replace -ne "" -and (Answer-Confirmation)) { $script:confirmed = $true }
  }
  Start-Sleep -Milliseconds 800
  if (-not $shell.AppActivate($Title)) { exit 0 }   # the dialog closed: answered
}
if ($Replace -ne "" -and -not $script:confirmed) { Write-Error "no replace confirmation appeared for '$Path'"; exit 1 }
Write-Error "dialog '$Title' was still open after $Attempts attempts"
exit 1
