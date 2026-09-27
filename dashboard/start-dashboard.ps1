param(
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$projectRoot = "C:\Users\leehansung\naver-auto"
$serverFile = Join-Path $projectRoot "dashboard\server.js"
$dashboardUrl = "http://localhost:3000/"
$stateDir = "C:\Users\leehansung\.naver-auto"
$stdoutLog = Join-Path $stateDir "dashboard.log"
$stderrLog = Join-Path $stateDir "dashboard-error.log"

function Test-DashboardReady {
  try {
    $response = Invoke-WebRequest -Uri $dashboardUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-DashboardReady)) {
  $deepSeekKey = [Environment]::GetEnvironmentVariable("DEEPSEEK_API_KEY", "User")
  if ($deepSeekKey) { $env:DEEPSEEK_API_KEY = $deepSeekKey }

  $nodeCandidates = @(
    "C:\Users\leehansung\AppData\Local\hermes\node\node.exe",
    "C:\Users\leehansung\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  )
  $nodeExe = $nodeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $nodeExe) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { $nodeExe = $nodeCommand.Source }
  }
  if (-not $nodeExe) { throw "Node.js를 찾지 못했습니다." }

  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  Start-Process -FilePath $nodeExe `
    -ArgumentList @($serverFile) `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog

  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    if (Test-DashboardReady) {
      $ready = $true
      break
    }
  }
  if (-not $ready) { throw "대시보드 서버가 시작되지 않았습니다. 로그: $stderrLog" }
}

if (-not $NoOpen) {
  $chromeExe = "C:\Program Files\Google\Chrome\Application\chrome.exe"
  if (Test-Path -LiteralPath $chromeExe) {
    Start-Process -FilePath $chromeExe -ArgumentList @("--new-window", $dashboardUrl)
  } else {
    Start-Process $dashboardUrl
  }
}
