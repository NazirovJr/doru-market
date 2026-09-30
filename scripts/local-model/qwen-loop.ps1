<#
.SYNOPSIS
  Цикл свежих сессий на одно задание: раунд за раундом, пока на ветке не появится коммит.

.DESCRIPTION
  Приём известен как Ralph loop: одна неизменная цель отдаётся каждый раз НОВОЙ сессии, память —
  рабочая копия и git, а не история диалога. Это лечит две вещи разом. Первая: контекст не растёт,
  а по замерам (ANALYSIS §4.8) после 60-70% окна качество падает нелинейно. Вторая: условие
  остановки проверяет скрипт, а не модель, — ей больше не о чем врать.

  Каждый раунд — `dsh --profile headless`: свежий агент, одна задача, без сервера и без
  подтверждений (профиль ~/.dsh/profiles/headless, песочница остаётся workspace-write).
  Успех — появившийся на ветке коммит, который сделал гейт, и только на полностью зелёном прогоне.

  Перед первым раундом скрипт сам ставит активное задание (scripts/qwen-task.ps1) и создаёт ветку:
  оба шага модель уже теряла, а механика их не забывает.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qwen-loop.ps1 -Task DTJ-372
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qwen-loop.ps1 -Task DTJ-372 -MaxRounds 6
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $Task,
  [int] $MaxRounds = 10,
  [string] $Harness = 'D:\job\deepseek-harness'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$root = & git -C $PSScriptRoot rev-parse --show-toplevel
if (-not $root) { throw 'не репозиторий' }
Set-Location -LiteralPath $root

$bin = Join-Path $Harness 'apps\cli\lib\bin.js'
if (-not (Test-Path -LiteralPath $bin)) { throw "нет сборки dsh: $bin" }

# Рабочая копия обязана быть чистой: раунды опираются на git как на память, и чужие правки
# в ней неотличимы от сделанных моделью.
$dirty = @(& git status --porcelain)
if ($dirty.Count -gt 0) {
  'В рабочей копии есть несохранённые изменения — цикл не запускается:'
  $dirty | ForEach-Object { "  $_" }
  exit 2
}

# Гейт внутри песочницы не может запустить vitest — его выполняет демон (ANALYSIS §4.6).
$heartbeat = Join-Path $root 'node_modules\.cache\qwen-gate\daemon.heartbeat'
$daemonAlive = (Test-Path -LiteralPath $heartbeat) -and
  (((Get-Date) - (Get-Item -LiteralPath $heartbeat).LastWriteTime).TotalSeconds -lt 15)
if (-not $daemonAlive) { 'Не запущен scripts/qwen-gate-daemon.ps1 — без него гейт не пройдёт.'; exit 2 }

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\qwen-task.ps1') -Task $Task
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$active = Get-Content -LiteralPath (Join-Path $root 'node_modules\.cache\qwen-gate\active.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$branch = [string]$active.branch
$base = [string]$active.base

# Ветку создаёт скрипт: модель теряла этот шаг дважды, а проверка ветки в гейте без неё
# краснела бы на каждом раунде.
$exists = @(& git branch --list $branch).Count -gt 0
if ($exists) { & git checkout --quiet $branch } else { & git checkout --quiet -b $branch $base }
if ($LASTEXITCODE -ne 0) { "не удалось перейти в ветку $branch"; exit 2 }

$taskText = "Выполни задание из файла reports/qwen3/tasks/$Task.md: прочитай его инструментом read целиком. " +
  "Часть работы могла быть сделана в предыдущем заходе: сначала посмотри git status и уже существующие файлы, " +
  "продолжай с того места, где остановлено. Не пиши текст перед вызовом инструмента: сразу вызывай инструмент."

$logDir = Join-Path $root 'node_modules\.cache\qwen-gate'
$started = Get-Date
"цикл: $Task, ветка $branch, до $MaxRounds раундов"
''

for ($round = 1; $round -le $MaxRounds; $round++) {
  $done = @(& git log --oneline "$base..$branch")
  if ($done.Count -gt 0) {
    ''
    "ГОТОВО за $($round - 1) раунд(ов), $([int]((Get-Date) - $started).TotalMinutes) мин"
    $done | ForEach-Object { "  $_" }
    exit 0
  }

  $roundStart = Get-Date
  $log = Join-Path $logDir "loop-$Task-round-$round.log"
  $out = & node $bin --profile headless $taskText 2>&1 | ForEach-Object { "$_" }
  $code = $LASTEXITCODE
  Set-Content -LiteralPath $log -Value $out -Encoding UTF8
  $mins = [int]((Get-Date) - $roundStart).TotalMinutes
  "раунд $round`: exit $code, $mins мин, лог $([System.IO.Path]::GetFileName($log))"
}

''
"ПРЕДЕЛ РАУНДОВ ($MaxRounds), коммита на ветке нет. Логи раундов — в node_modules\.cache\qwen-gate\"
exit 1
