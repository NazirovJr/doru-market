<#
.SYNOPSIS
  Демон гейта: выполняет scripts/qwen-gate.ps1 вне песочницы dsh по запросу из неё.

.DESCRIPTION
  В песочнице dsh (workspace-write) дочерние процессы не могут перехватывать вывод через
  именованные каналы, поэтому vitest и esbuild падают с `spawn EPERM`. Демон запускается человеком
  в обычном окне PowerShell и слушает папку node_modules/.cache/qwen-gate рабочей копии.
  qwen-gate.ps1, запущенный внутри dsh, кладёт туда запрос и ждёт результат.
  Демон выполняет ТОЛЬКО гейт — никаких произвольных команд; параметры проверяются по белому
  списку символов и передаются аргументами, а не текстом команды. Сюда же уходит -Commit: сам гейт
  коммитит лишь при GATE: PASS, в своей ветке и только файлы из -Allowed, а хуки husky работают,
  потому что демон живёт вне песочницы dsh.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qwen-gate-daemon.ps1
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qwen-gate-daemon.ps1 -Repo D:\job\doruTJ-qwen
#>
[CmdletBinding()]
param([string] $Repo = '')

# 'Continue': дочерние процессы пишут в stderr (git — предупреждения о переводах строк),
# при 'Stop' любая такая строка превращалась бы в отказ демона. Проверки бросают throw явно.
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if (-not $Repo) { $Repo = & git -C $PSScriptRoot rev-parse --show-toplevel }
$Repo = (Resolve-Path -LiteralPath $Repo).Path
Set-Location -LiteralPath $Repo
$gate = Join-Path $Repo 'scripts\qwen-gate.ps1'
if (-not (Test-Path -LiteralPath $gate)) { throw "нет $gate — демон запускается из рабочей копии с гейтом" }
$exchange = Join-Path $Repo 'node_modules\.cache\qwen-gate'
New-Item -ItemType Directory -Force -Path $exchange | Out-Null
$heartbeat = Join-Path $exchange 'daemon.heartbeat'
$safePattern = '^[A-Za-z0-9_./*-]+$'
# Сообщение коммита — свободный текст, но без кавычек, обратных апострофов, $ и управляющих
# символов: они ломают передачу аргументов в powershell -File.
function Test-CommitMessage([string] $message) {
  if ($message.Length -lt 10 -or $message.Length -gt 200) { return $false }
  if ($message -match '[\x00-\x1f]') { return $false }
  foreach ($bad in @('"', '`', '$')) { if ($message.Contains($bad)) { return $false } }
  return $true
}

function Invoke-GateRequest([System.IO.FileInfo] $requestFile) {
  $id = $requestFile.BaseName.Substring('request-'.Length)
  try {
    $body = Get-Content -LiteralPath $requestFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    Remove-Item -LiteralPath $requestFile.FullName -Force
    $gateArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $gate)
    if ($body.Base) {
      if ($body.Base -notmatch $safePattern) { throw "недопустимый Base: $($body.Base)" }
      $gateArgs += @('-Base', $body.Base)
    }
    $allowed = @($body.Allowed | Where-Object { $_ })
    foreach ($pattern in $allowed) {
      if ($pattern -notmatch $safePattern) { throw "недопустимый шаблон Allowed: $pattern" }
    }
    if ($allowed.Count -gt 0) { $gateArgs += @('-Allowed', ($allowed -join ',')) }
    if ($body.Full -eq $true) { $gateArgs += '-Full' }
    if ($body.Commit) {
      if (-not (Test-CommitMessage ([string]$body.Commit))) { throw 'недопустимое сообщение коммита' }
      $gateArgs += @('-Commit', $body.Commit)
    }
    "$(Get-Date -Format HH:mm:ss) запрос ${id}: $($gateArgs[5..($gateArgs.Count - 1)] -join ' ')"
    $env:QWEN_GATE_IN_DAEMON = '1'
    $output = & powershell @gateArgs 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
  }
  catch {
    $output = @("GATE: FAIL -> демон отклонил запрос: $($_.Exception.Message)")
    $code = 2
  }
  finally {
    Remove-Item Env:\QWEN_GATE_IN_DAEMON -ErrorAction SilentlyContinue
  }
  Set-Content -LiteralPath (Join-Path $exchange "result-$id.txt") -Value $output -Encoding UTF8
  # Файл с кодом выхода пишется последним — это маркер завершения для ожидающего гейта.
  Set-Content -LiteralPath (Join-Path $exchange "result-$id.exit") -Value $code
  "$(Get-Date -Format HH:mm:ss) запрос ${id}: exit $code"
}

"qwen-gate-daemon: $Repo"
"Жду запросы из dsh. Остановить — Ctrl+C."
while ($true) {
  Set-Content -LiteralPath $heartbeat -Value (Get-Date -Format o)
  foreach ($requestFile in @(Get-ChildItem -LiteralPath $exchange -Filter 'request-*.json' -File)) {
    Invoke-GateRequest $requestFile
  }
  Start-Sleep -Seconds 1
}
