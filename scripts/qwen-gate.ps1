<#
.SYNOPSIS
  Гейт для исполнителя-модели (qwen3 и др.): одна команда, короткий вывод, один код выхода.

.DESCRIPTION
  Сам находит изменённые файлы (ветка относительно -Base + рабочая копия + неотслеживаемые)
  и прогоняет только то, что их касается:
    - сборка packages/contracts, если он изменён (vitest в apps/* берёт contracts из dist/);
    - tsc --noEmit --incremental false для затронутых пакетов (устаревший .tsbuildinfo не врёт);
    - eslint --max-warnings=0 по изменённым .ts/.tsx;
    - vitest по изменённым *.spec.ts и спекам-соседям изменённых файлов, без порогов покрытия
      (точечный прогон с порогами падает всегда и заливает вывод таблицей покрытия).
  -Full добавляет arch:check, test:arch, полный vitest и build затронутых пакетов.
  -Require 'путь::текст' проверяет, что критерий задания действительно написан: в файле есть такой
  текст. Пропущенный критерий красит гейт, а значит и коммита не будет. -RequireFile <файл> берёт
  те же строки из файла (по одной на строку, # — комментарий): так команда в задании остаётся
  короткой, а список критериев живёт рядом с заданием.
  Если аргументы не переданы, периметр, критерии и базу гейт берёт из активного задания
  (node_modules/.cache/qwen-gate/active.json, пишет scripts/qwen-task.ps1) и там же проверяет, что
  работа идёт в нужной ветке. Удачный коммит активное задание снимает.
  -Commit <сообщение> включает -Full и, ТОЛЬКО при GATE: PASS, коммитит изменённые файлы в текущую
  ветку. Красный гейт — коммита нет; ветка development/main/master — коммита нет; без -Allowed
  коммит запрещён (иначе в коммит уедет что угодно из рабочей копии).
  Интеграционные спеки (нужны Postgres/Redis) не запускает — их гоняет координатор.
  Внутри dsh (DSH_SHELL=1) при живом scripts/qwen-gate-daemon.ps1 гейт выполняет демон: в песочнице
  dsh vitest и esbuild не запускаются (spawn EPERM).
  Последняя строка вывода: `GATE: PASS` или `GATE: FAIL -> <шаги>`.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qwen-gate.ps1
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qwen-gate.ps1 -Full -Allowed 'apps/api/src/modules/orders/*'
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qwen-gate.ps1 -Allowed 'apps/api/src/modules/orders/*' -Commit 'feat(orders): DTJ-307a — ...'
#>
[CmdletBinding()]
param(
  [string] $Base = 'development',
  [string[]] $Allowed = @(),
  [switch] $Full,
  [string[]] $Require = @(),
  [string] $RequireFile = '',
  [string] $Commit = ''
)

$ErrorActionPreference = 'Continue'
if ($Commit) { $Full = $true }
# `powershell -File ... -Allowed 'a','b'` передаёт массив одной строкой через запятую.
$Allowed = @($Allowed | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().Trim("'").Trim('"') } | Where-Object { $_ })
$Require = @($Require | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().Trim("'").Trim('"') } | Where-Object { $_ })
# Корень — репозиторий, в котором лежит сам скрипт, а не текущая папка (демон может стартовать откуда угодно).
$root = & git -C $PSScriptRoot rev-parse --show-toplevel 2>$null
if (-not $root) { 'GATE: FAIL -> not a git repository'; exit 2 }
Set-Location -LiteralPath $root

# Внутри песочницы dsh гейт не может запустить vitest — отдаём запрос демону, если он запущен.
$exchange = Join-Path $root 'node_modules\.cache\qwen-gate'
$heartbeat = Join-Path $exchange 'daemon.heartbeat'
# Активное задание (пишет координатор через scripts/qwen-task.ps1). Периметр и критерии берутся
# отсюда, если их не передали аргументами: команду набирает модель, а значит может и не набрать —
# на DTJ-372 она запустила гейт без -Allowed и -RequireFile и тем отключила обе проверки.
$activeFile = Join-Path $exchange 'active.json'
$active = $null
if (Test-Path -LiteralPath $activeFile) {
  try { $active = Get-Content -LiteralPath $activeFile -Raw -Encoding UTF8 | ConvertFrom-Json }
  catch { 'GATE: FAIL -> не читается active.json активного задания'; exit 2 }
}
if ($active) {
  if ($Allowed.Count -eq 0 -and $active.allowed) { $Allowed = @($active.allowed) }
  if (-not $RequireFile -and $active.requireFile) { $RequireFile = [string]$active.requireFile }
  if (-not $PSBoundParameters.ContainsKey('Base') -and $active.base) { $Base = [string]$active.base }
}

$heartbeatFresh = (Test-Path -LiteralPath $heartbeat) -and
  (((Get-Date) - (Get-Item -LiteralPath $heartbeat).LastWriteTime).TotalSeconds -lt 15)
if ($env:DSH_SHELL -and -not $env:QWEN_GATE_IN_DAEMON -and $heartbeatFresh) {
  $id = (New-Guid).Guid -replace '-', ''
  $request = @{ Base = $Base; Allowed = @($Allowed); Full = [bool]$Full; Require = @($Require); RequireFile = $RequireFile; Commit = $Commit } | ConvertTo-Json -Compress
  Set-Content -LiteralPath (Join-Path $exchange "request-$id.tmp") -Value $request -Encoding UTF8
  Rename-Item -LiteralPath (Join-Path $exchange "request-$id.tmp") -NewName "request-$id.json"
  $exitFile = Join-Path $exchange "result-$id.exit"
  $resultFile = Join-Path $exchange "result-$id.txt"
  # Лимит команды в dsh — 600 с при timeoutMs: 600000; отвечаем раньше, чем dsh убьёт вызов.
  $deadline = (Get-Date).AddSeconds(570)
  while (-not (Test-Path -LiteralPath $exitFile)) {
    if ((Get-Date) -gt $deadline) { 'GATE: FAIL -> демон гейта не ответил за 9,5 минуты — запусти гейт ещё раз'; exit 1 }
    Start-Sleep -Seconds 2
  }
  Get-Content -LiteralPath $resultFile -Encoding UTF8
  $code = [int]((Get-Content -LiteralPath $exitFile -Raw).Trim())
  Remove-Item -LiteralPath $exitFile, $resultFile -Force
  exit $code
}

if ($RequireFile) {
  if (-not (Test-Path -LiteralPath $RequireFile -PathType Leaf)) {
    "GATE: FAIL -> нет файла критериев: $RequireFile"
    exit 2
  }
  $Require += @(Get-Content -LiteralPath $RequireFile -Encoding UTF8 |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ -and -not $_.StartsWith('#') })
}

if ($Commit -and $Allowed.Count -eq 0) {
  'GATE: FAIL -> -Commit без -Allowed запрещён: коммитить можно только файлы из периметра задания'
  exit 2
}

$packageByPrefix = [ordered]@{
  'packages/contracts/' = '@dorutj/contracts'
  'apps/api/'           = '@dorutj/api'
  'apps/worker/'        = '@dorutj/worker'
}
$failed = New-Object System.Collections.Generic.List[string]

function Invoke-Step {
  param(
    [string] $Name,
    [string[]] $Arguments,
    [ValidateSet('First', 'Last')] [string] $Keep = 'First',
    [int] $Lines = 40
  )
  # "$_" превращает stderr-записи PowerShell 5.1 в чистые строки без NativeCommandError-шума.
  $output = & pnpm @Arguments 2>&1 | ForEach-Object { "$_" }
  $code = $LASTEXITCODE
  if ($code -eq 0) { "[OK]   $Name"; return }
  $failed.Add($Name)
  "[FAIL] $Name (exit $code)"
  if ($env:DSH_SHELL -and ($output -match 'spawn EPERM')) {
    '       ЭТО НЕ ОШИБКА КОДА: песочница dsh не даёт vitest/esbuild запускать дочерние процессы.'
    '       Нужен демон гейта (scripts/qwen-gate-daemon.ps1) — это СТОП, сдай отчёт со статусом BLOCKED.'
    return
  }
  $noise = @('System.Management.Automation.RemoteException', 'undefined')
  $meaningful = @($output | Where-Object { ($_ -match '\S') -and ($noise -notcontains $_.Trim()) })
  if ($Keep -eq 'First') { $meaningful = @($meaningful | Select-Object -First $Lines) }
  else { $meaningful = @($meaningful | Select-Object -Last $Lines) }
  $meaningful | ForEach-Object { "       $_" }
}

function Get-PackagePrefix([string] $path) {
  foreach ($prefix in $packageByPrefix.Keys) {
    if ($path.StartsWith($prefix)) { return $prefix }
  }
  return $null
}

# --- изменённые файлы ---------------------------------------------------------------------
$changed = @()
& git rev-parse --verify --quiet $Base 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { $changed += & git diff --name-only "$Base...HEAD" }
$changed += & git diff --name-only HEAD
$changed += & git ls-files --others --exclude-standard
$changed = @($changed | Where-Object { $_ } | ForEach-Object { $_ -replace '\\', '/' } | Sort-Object -Unique |
    Where-Object { $_ -ne 'scripts/qwen-gate.ps1' })

"Изменённые файлы ($($changed.Count)):"
$changed | ForEach-Object { "  $_" }
if ($changed.Count -eq 0) { 'GATE: FAIL -> нет изменений (гейт нечего проверять)'; exit 1 }

if ($active -and $active.branch) {
  $currentBranch = "$(& git rev-parse --abbrev-ref HEAD)".Trim()
  if ($currentBranch -ne [string]$active.branch) {
    $failed.Add('branch')
    "[FAIL] branch: сейчас '$currentBranch', а задание делается в ветке '$($active.branch)'"
    "       Создай её от development и перенеси работу туда: git checkout -b $($active.branch) development"
  }
  else { '[OK]   branch' }
}

if ($Allowed.Count -gt 0) {
  $outside = @($changed | Where-Object {
      $file = $_
      -not ($Allowed | Where-Object { $file -like $_ })
    })
  if ($outside.Count -gt 0) {
    $failed.Add('scope')
    '[FAIL] scope: файлы вне разрешённого списка задания:'
    $outside | ForEach-Object { "       $_" }
  }
  else { '[OK]   scope' }
}

if ($Require.Count -gt 0) {
  $missing = New-Object System.Collections.Generic.List[string]
  foreach ($entry in $Require) {
    $parts = $entry -split '::', 2
    if ($parts.Count -ne 2) { $missing.Add("$entry -> неверный формат, нужно путь::текст"); continue }
    $file = $parts[0].Trim()
    $needle = $parts[1].Trim()
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { $missing.Add("$file -> файла нет"); continue }
    $content = Get-Content -LiteralPath $file -Raw -Encoding UTF8
    if ((-not $content) -or ($content.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -lt 0)) {
      $missing.Add("$file -> нет: $needle")
    }
  }
  if ($missing.Count -gt 0) {
    $failed.Add('require')
    '[FAIL] require: критерии задания не выполнены (раздел 5):'
    $missing | ForEach-Object { "       $_" }
  }
  else { "[OK]   require ($($Require.Count))" }
}

$touched = @($packageByPrefix.Keys | Where-Object {
    $prefix = $_
    @($changed | Where-Object { $_.StartsWith($prefix) }).Count -gt 0
  })

# --- contracts: сначала сборка, иначе тесты apps/* видят старый dist/ ---------------------
if ($touched -contains 'packages/contracts/') {
  Invoke-Step -Name 'build @dorutj/contracts' -Arguments @('--filter', '@dorutj/contracts', 'build') -Lines 30
}

# --- tsc ------------------------------------------------------------------------------------
foreach ($prefix in $touched) {
  $name = $packageByPrefix[$prefix]
  Invoke-Step -Name "tsc $name" -Keep First -Lines 30 -Arguments @(
    '--filter', $name, 'exec', 'tsc', '--noEmit', '-p', 'tsconfig.json', '--incremental', 'false')
}

# --- eslint по изменённым .ts/.tsx ---------------------------------------------------------
$lintFiles = @($changed | Where-Object {
    ($_ -match '\.(ts|tsx)$') -and (Test-Path -LiteralPath $_) -and ($_ -notmatch '(^|/)(dist|node_modules|coverage)/')
  })
if ($lintFiles.Count -gt 0) {
  Invoke-Step -Name "eslint ($($lintFiles.Count) файлов)" -Keep First -Lines 40 -Arguments (
    @('exec', 'eslint', '--max-warnings=0') + $lintFiles)
}

# --- vitest точечно -----------------------------------------------------------------------
$specsByPrefix = @{}
$skippedIntegration = @()
foreach ($file in $changed) {
  $prefix = Get-PackagePrefix $file
  if (-not $prefix -or $file -notmatch '\.tsx?$') { continue }
  $spec = if ($file -match '\.spec\.tsx?$') { $file } else { $file -replace '\.(tsx?)$', '.spec.$1' }
  if (-not (Test-Path -LiteralPath $spec)) { continue }
  if ($spec -match '(/test/integration/|\.integration\.spec\.)') { $skippedIntegration += $spec; continue }
  if (-not $specsByPrefix.ContainsKey($prefix)) { $specsByPrefix[$prefix] = New-Object System.Collections.Generic.List[string] }
  $relative = $spec.Substring($prefix.Length)
  if (-not $specsByPrefix[$prefix].Contains($relative)) { $specsByPrefix[$prefix].Add($relative) }
}
foreach ($prefix in $specsByPrefix.Keys) {
  $name = $packageByPrefix[$prefix]
  $specs = @($specsByPrefix[$prefix])
  $vitestArgs = @('--filter', $name, 'exec', 'vitest', 'run', '--coverage.enabled=false', '--reporter=dot')
  Invoke-Step -Name "vitest $name ($($specs.Count) спеков)" -Keep Last -Lines 60 -Arguments ($vitestArgs + $specs)
}
if ($skippedIntegration.Count -gt 0) {
  '[SKIP] интеграционные спеки (нужны Postgres/Redis, гоняет координатор):'
  $skippedIntegration | Sort-Object -Unique | ForEach-Object { "       $_" }
}

# --- полный режим -------------------------------------------------------------------------
if ($Full) {
  Invoke-Step -Name 'arch:check' -Keep Last -Lines 25 -Arguments @('arch:check')
  Invoke-Step -Name 'test:arch' -Keep Last -Lines 25 -Arguments @('test:arch')
  foreach ($prefix in $touched) {
    $name = $packageByPrefix[$prefix]
    $fullArgs = @('--filter', $name, 'exec', 'vitest', 'run', '--reporter=dot')
    Invoke-Step -Name "vitest $name (весь пакет, с порогами покрытия)" -Keep Last -Lines 40 -Arguments $fullArgs
    Invoke-Step -Name "build $name" -Keep Last -Lines 25 -Arguments @('--filter', $name, 'build')
  }
}

if ($failed.Count -gt 0) {
  "GATE: FAIL -> $($failed -join ', ')"
  if ($Commit) { 'КОММИТ НЕ СДЕЛАН: гейт красный. Почини ошибки выше и запусти ту же команду снова.' }
  exit 1
}

if ($Commit) {
  $branch = "$(& git rev-parse --abbrev-ref HEAD)".Trim()
  if ($branch -in @('development', 'main', 'master', 'HEAD')) {
    "GATE: FAIL -> коммит в '$branch' запрещён: работай в своей ветке"
    exit 2
  }
  & git add -A -- $changed
  if ($LASTEXITCODE -ne 0) { 'GATE: FAIL -> git add не прошёл'; exit 2 }
  # Повторный прогон после удачного коммита ничего не коммитит, но и не ошибка: печатаем тот же
  # `КОММИТ:` и выходим зелёными, иначе модель приняла бы «нечего коммитить» за поломку.
  & git diff --cached --quiet
  $nothingToCommit = ($LASTEXITCODE -eq 0)
  if (-not $nothingToCommit) {
    $commitOutput = & git commit -m $Commit 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) {
      'GATE: FAIL -> коммит не прошёл:'
      $commitOutput | Select-Object -Last 15 | ForEach-Object { "       $_" }
      exit 1
    }
  }
  # Задание сдано — активное задание снимается, иначе проверка ветки мешала бы приёмке.
  if ((-not $nothingToCommit) -and (Test-Path -LiteralPath $activeFile)) {
    Remove-Item -LiteralPath $activeFile -Force -ErrorAction SilentlyContinue
  }
  'КОММИТ:'
  "       $(& git log --oneline -1)"
  if ($nothingToCommit) { '       (повторный прогон: всё уже в этом коммите, новых изменений нет)' }
  & git show --stat --format='' HEAD | Where-Object { $_ -match '\S' } | ForEach-Object { "       $_" }
}

'GATE: PASS'
exit 0
