param(
  [Parameter(Mandatory)][string]$Cmd,
  [int]$TimeoutMin = 8,
  # Замок должен лежать вне репозитория: он общий для всех worktree и агентов машины.
  [string]$LockRoot = $(if ($env:DORUTJ_LOCK_ROOT) { $env:DORUTJ_LOCK_ROOT } else { Join-Path ([IO.Path]::GetTempPath()) 'dorutj-coordinator' })
)
# Serialises heavy checks and shared-DB tests across parallel agents.
# Exit 99 = замок занят дольше TimeoutMin, повторить позже.
New-Item -ItemType Directory -Force $LockRoot | Out-Null
$lock = Join-Path $LockRoot 'heavy.lock'
$owner = Join-Path $lock 'owner'
$deadline = (Get-Date).AddMinutes($TimeoutMin)

function Test-LockStale {
  $age = (Get-Date) - (Get-Item $lock).CreationTime
  if ($age.TotalMinutes -gt 40) { return $true }
  # Holder killed by a tool timeout never runs `finally` — detect a dead owner PID instead of waiting 40 min.
  $ownerPid = (Get-Content $owner -ErrorAction SilentlyContinue | Select-Object -First 1) -as [int]
  return ($ownerPid -and -not (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue))
}

while ($true) {
  try { New-Item -ItemType Directory -Path $lock -ErrorAction Stop | Out-Null; break }
  catch {
    if (Test-LockStale) { Remove-Item $lock -Force -Recurse -ErrorAction SilentlyContinue; continue }
    if ((Get-Date) -gt $deadline) { Write-Output "HEAVY-RUN: timeout waiting for lock"; exit 99 }
    Write-Output ("HEAVY-RUN: waiting for lock held by {0}" -f ((Get-Content $owner -ErrorAction SilentlyContinue) -join ' | '))
    Start-Sleep -Seconds 30
  }
}
try {
  Set-Content $owner @("$PID", "$PWD | $Cmd")
  Write-Output "HEAVY-RUN: lock acquired in $PWD"
  # Порт 6379 может занимать Redis другого проекта — тесты DoruTJ ходят только в свой на 6380.
  if (-not $env:REDIS_URL) {
    $redisPassword = if ($env:REDIS_PASSWORD) { $env:REDIS_PASSWORD } else { 'dorutj_dev_redis_password' } # дефолт docker-compose.yml
    $env:REDIS_URL = "redis://:$redisPassword@localhost:6380/0"
  }
  Invoke-Expression $Cmd
  $code = $LASTEXITCODE
} finally { Remove-Item $lock -Force -Recurse -ErrorAction SilentlyContinue }
Write-Output "HEAVY-RUN: exit $code"
exit $code
