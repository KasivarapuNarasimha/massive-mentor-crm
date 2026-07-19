param()
$logFile = "C:\Users\acer\massive-mentor\api-stable.log"
if (Test-Path $logFile) { Remove-Item $logFile -Force }
Write-Host "Launching API (no watch) ..."
$proc = Start-Process cmd -ArgumentList "/c", "cd /d `"C:\Users\acer\massive-mentor\apps\api`" && `"node_modules\.bin\tsx.CMD`" src\index.ts > `"$logFile`" 2>&1" -PassThru -WindowStyle Hidden
Write-Host "Launcher PID:" $proc.Id
Start-Sleep -Seconds 8
Write-Host "Initial port:" 
netstat -ano | findstr ":4000" | findstr LISTENING
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:4000/health" -TimeoutSec 3
  Write-Host "Initial HEALTH:" $r.StatusCode
} catch {
  Write-Host "Initial HEALTH fail"
}

Write-Host "=== 5 MIN STABILITY WATCH ==="
$success = 0
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 15
  $time = Get-Date -Format "HH:mm:ss"
  $listening = netstat -ano | findstr ":4000" | findstr LISTENING
  $l = if ($listening) { "LISTEN" } else { "NO" }
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:4000/health" -TimeoutSec 3
    if ($r.StatusCode -eq 200) {
      $h = "HEALTH200"
      $success++
    } else {
      $h = "HEALTH" + $r.StatusCode
    }
  } catch {
    $h = "HEALTH_FAIL"
  }
  $logLast = (Get-Content $logFile -Tail 1 -ErrorAction SilentlyContinue) -join " "
  Write-Host "[$time] $l | $h | $logLast"
}
Write-Host "=== END. Success count: $success / 20 ==="
netstat -ano | findstr ":4000" | findstr LISTENING
Get-Content $logFile -Tail 5
Write-Host "Done"