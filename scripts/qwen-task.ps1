<#
.SYNOPSIS
  Готовит активное задание для гейта: периметр, критерии и ветку.

.DESCRIPTION
  Периметр и критерии раньше жили только в аргументах команды, а команду набирает модель — значит
  может и не набрать. На DTJ-372 она запустила гейт без -Allowed и -RequireFile и тем отключила обе
  проверки разом. Теперь координатор перед прогоном кладёт их в node_modules/.cache/qwen-gate/active.json,
  и гейт берёт их оттуда, когда аргументов нет; там же он проверяет, что работа идёт в нужной ветке.

  Всё читается из самого файла задания, руками ничего дублировать не нужно. Удачный коммит через
  гейт активное задание снимает сам.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qwen-task.ps1 -Task DTJ-372
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qwen-task.ps1 -Clear
#>
[CmdletBinding()]
param(
  [string] $Task = '',
  [switch] $Clear
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$root = & git -C $PSScriptRoot rev-parse --show-toplevel
if (-not $root) { throw 'не репозиторий' }
$exchange = Join-Path $root 'node_modules\.cache\qwen-gate'
New-Item -ItemType Directory -Force -Path $exchange | Out-Null
$activeFile = Join-Path $exchange 'active.json'

if ($Clear) {
  if (Test-Path -LiteralPath $activeFile) { Remove-Item -LiteralPath $activeFile -Force }
  'активное задание снято'
  return
}

if (-not $Task) {
  if (Test-Path -LiteralPath $activeFile) { Get-Content -LiteralPath $activeFile -Raw -Encoding UTF8 }
  else { 'активного задания нет' }
  return
}

$taskFile = Join-Path $root "reports\qwen3\tasks\$Task.md"
if (-not (Test-Path -LiteralPath $taskFile)) { throw "нет файла задания: $taskFile" }
$text = Get-Content -LiteralPath $taskFile -Raw -Encoding UTF8

# Под давлением контекста dsh режет результаты read длиннее 8192 символов: остаются первые 4096 и
# последние 1024 (tool-result-pruner в пресете executor). Путь и номера строк в выводе read съедают
# часть начала, поэтому запас — 3500 символов файла. На DTJ-372 команда гейта стояла глубже,
# и модель, дойдя до сдачи, выдумала свою.
$head = $text.Substring(0, [Math]::Min(3500, $text.Length))
if ($head.IndexOf('-File scripts/qwen-gate.ps1') -lt 0 -or $head.IndexOf('-Commit "') -lt 0) {
  throw 'команды проверки и сдачи должны стоять в первых 3500 символах задания, иначе dsh вырежет их при сжатии'
}

$allowedMatch = [regex]::Match($text, "-Allowed\s+(.+?)\s+-RequireFile")
if (-not $allowedMatch.Success) { throw "в задании не найден -Allowed ... -RequireFile" }
$allowed = @($allowedMatch.Groups[1].Value -split ',' | ForEach-Object { $_.Trim().Trim("'") } | Where-Object { $_ })

$requireMatch = [regex]::Match($text, "-RequireFile\s+([A-Za-z0-9_./-]+)")
if (-not $requireMatch.Success) { throw 'в задании не найден -RequireFile' }
$requireFile = $requireMatch.Groups[1].Value.Trim([char]96, [char]39, [char]34)

$branchMatch = [regex]::Match($text, "git checkout -b ([A-Za-z0-9_./-]+)\s+([A-Za-z0-9_./-]+)")
if (-not $branchMatch.Success) { throw 'в задании не найдена строка создания ветки' }
$branch = $branchMatch.Groups[1].Value.Trim([char]96, [char]39, [char]34)
$base = $branchMatch.Groups[2].Value.Trim([char]96, [char]39, [char]34)

if (-not (Test-Path -LiteralPath (Join-Path $root $requireFile))) {
  throw "файл критериев не найден: $requireFile"
}

# Сообщение коммита гейт печатает в готовой команде сдачи, когда проверка зелёная.
$commitMatch = [regex]::Match($text, '-Commit "([^"]+)"')
if (-not $commitMatch.Success) { throw 'в задании не найдена команда сдачи с -Commit "..."' }
$commit = $commitMatch.Groups[1].Value

$payload = [ordered]@{ task = $Task; branch = $branch; base = $base; requireFile = $requireFile; allowed = $allowed; commit = $commit }
Set-Content -LiteralPath $activeFile -Value ($payload | ConvertTo-Json -Depth 4) -Encoding UTF8

"активное задание: $Task"
"  ветка:     $branch (от $base)"
"  критериев: $((Get-Content -LiteralPath (Join-Path $root $requireFile) | Where-Object { $_.Trim() -and -not $_.StartsWith('#') }).Count)"
"  периметр:  $($allowed.Count) шаблонов"
"  коммит:    $commit"
