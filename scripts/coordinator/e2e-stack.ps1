param(
  # Env-файл стенда (вне репозитория, в git не коммитится): БД dorutj_e2e, ключи, порты API/worker.
  [string]$EnvFile = $env:E2E_ENV_FILE,
  # Worktree со стендом: отдельный, вне каталога, который чистит автоочистка worktree.
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$LogsDir = (Join-Path ([IO.Path]::GetTempPath()) 'dorutj-coordinator\e2e-logs'),
  # Должен совпадать с PORT в env-файле; используется только для VITE_API_BASE_URL фронтов.
  [int]$ApiPort = 3300,
  [int]$WebPort = 5373,
  [int]$PharmacyPort = 5374,
  [int]$AdminPort = 5375
)
# E2E-стенд: API + worker (dist/main.js) и три фронта под vite. Нужна предварительная сборка (pnpm build).
# Запуск в фоне; остановка — завершить этот процесс (дочерние гасятся в finally).
$ErrorActionPreference = 'Stop'
if (-not $EnvFile -or -not (Test-Path $EnvFile)) { throw "Env-файл стенда не найден: задай -EnvFile или E2E_ENV_FILE" }
New-Item -ItemType Directory -Force $LogsDir | Out-Null
$env:VITE_API_BASE_URL = "http://localhost:$ApiPort"
$procs = @()
$procs += Start-Process node -ArgumentList "--env-file=$EnvFile", 'dist/main.js' -WorkingDirectory "$Root\apps\api" -RedirectStandardOutput "$LogsDir\api.log" -RedirectStandardError "$LogsDir\api.err.log" -PassThru -NoNewWindow
$procs += Start-Process node -ArgumentList "--env-file=$EnvFile", 'dist/main.js' -WorkingDirectory "$Root\apps\worker" -RedirectStandardOutput "$LogsDir\worker.log" -RedirectStandardError "$LogsDir\worker.err.log" -PassThru -NoNewWindow
foreach ($app in @(@('web', $WebPort), @('pharmacy', $PharmacyPort), @('admin', $AdminPort))) {
  $procs += Start-Process pnpm.cmd -ArgumentList '--filter', "@dorutj/$($app[0])", 'exec', 'vite', '--port', "$($app[1])", '--strictPort' -WorkingDirectory $Root -RedirectStandardOutput "$LogsDir\$($app[0]).log" -RedirectStandardError "$LogsDir\$($app[0]).err.log" -PassThru -NoNewWindow
}
try {
  Wait-Process -Id ($procs | ForEach-Object Id)
} finally {
  foreach ($p in $procs) { taskkill /PID $p.Id /T /F 2>$null | Out-Null }
}
