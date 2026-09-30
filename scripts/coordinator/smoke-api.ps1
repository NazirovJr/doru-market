param(
  [string]$Worktree = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [int]$Port = 3999,
  [string]$DatabaseUrl = $(if ($env:SMOKE_DATABASE_URL) { $env:SMOKE_DATABASE_URL } else { 'postgres://test:test@localhost:5432/dorutj_test' }),
  [string]$RedisPassword = $(if ($env:REDIS_PASSWORD) { $env:REDIS_PASSWORD } else { 'dorutj_dev_redis_password' }),
  [string]$LogDir = (Join-Path ([IO.Path]::GetTempPath()) 'dorutj-coordinator')
)
# Live start of the built artefact (lesson of wave 4: green gates did not prove dist/main.js starts).
# Нужна сборка apps/api (pnpm build). Пароли по умолчанию — дев-значения из docker-compose.yml / postgres-init.
$ErrorActionPreference = 'Stop'
$api = Join-Path $Worktree 'apps\api'
$keys = node -e "const c=require('crypto');const k=c.generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});process.stdout.write(JSON.stringify(k))" | ConvertFrom-Json
Get-Content (Join-Path $api '.env.example') | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object {
  $k, $v = $_ -split '=', 2; Set-Item -Path "Env:$k" -Value $v
}
$env:NODE_ENV = 'development'
$env:PORT = "$Port"
$env:DATABASE_URL = $DatabaseUrl
$env:REDIS_URL = "redis://:$RedisPassword@localhost:6380/0"
$env:JWT_PRIVATE_KEY = $keys.privateKey
$env:JWT_PUBLIC_KEY = $keys.publicKey
New-Item -ItemType Directory -Force $LogDir | Out-Null
$log = Join-Path $LogDir 'smoke-api.log'
$proc = Start-Process node -ArgumentList 'dist/main.js' -WorkingDirectory $api -PassThru -NoNewWindow -RedirectStandardOutput $log -RedirectStandardError "$log.err"
try {
  $up = $false
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 1
    if ($proc.HasExited) { break }
    try { $h = Invoke-WebRequest "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 2; $up = $true; break } catch { }
  }
  if (-not $up) { "SMOKE: port listeners: " + ((Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | ForEach-Object { $_.LocalAddress }) -join ","); "SMOKE: FAIL — /health not reachable (exited=$($proc.HasExited))"; Get-Content "$log.err" -Tail 20; Get-Content $log -Tail 20; exit 1 }
  "SMOKE: /health $($h.StatusCode) $($h.Content)"
  $r = Invoke-WebRequest "http://127.0.0.1:$Port/ready" -UseBasicParsing -TimeoutSec 5 -SkipHttpErrorCheck
  "SMOKE: /ready $($r.StatusCode) $($r.Content)"
  $s = Invoke-WebRequest "http://127.0.0.1:$Port/api/v1/medicines/suggest?text=a" -UseBasicParsing -TimeoutSec 5 -SkipHttpErrorCheck
  "SMOKE: suggest $($s.StatusCode) X-RateLimit-Limit=$($s.Headers['X-RateLimit-Limit']) X-RateLimit-Remaining=$($s.Headers['X-RateLimit-Remaining'])"
  if ($h.StatusCode -ne 200 -or -not $s.Headers['X-RateLimit-Limit']) { exit 1 }
  exit 0
} finally {
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
}
