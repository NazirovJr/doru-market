param(
  [Parameter(Mandatory)][string]$Tag,
  # Проверяемый worktree; по умолчанию — репозиторий, в котором лежит скрипт.
  [string]$Worktree = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$BaselineDir = $(if ($env:ITEST_BASELINE_DIR) { $env:ITEST_BASELINE_DIR } else { Join-Path ([IO.Path]::GetTempPath()) 'dorutj-coordinator\itest-baselines' }),
  [string]$PostgresContainer = 'dorutj-postgres-1',
  [string]$RedisContainer = 'dorutj-redis-test',
  [string]$PostgresPassword = $(if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { 'dorutj_dev_only_password' }),
  [string]$RedisPassword = $(if ($env:REDIS_PASSWORD) { $env:REDIS_PASSWORD } else { 'dorutj_dev_redis_password' })
)
# Fresh dorutj_test -> migrate as migrator -> app_role for test -> full api integration suite with JSON report.
# Пароли по умолчанию — дев-значения из infra/docker/docker-compose.yml; запускать через heavy-run.ps1.
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $BaselineDir | Out-Null
$out = Join-Path $BaselineDir "itest-$Tag.json"
docker exec $PostgresContainer psql -q -U dorutj_migrator -d dorutj -c "DROP DATABASE IF EXISTS dorutj_test WITH (FORCE)" | Out-Null
docker exec $PostgresContainer psql -q -U dorutj_migrator -d dorutj -f /docker-entrypoint-initdb.d/01-test-database.sql | Out-Null
docker exec $RedisContainer redis-cli -a $RedisPassword -n 0 FLUSHDB 2>$null | Out-Null
Set-Location (Join-Path $Worktree 'apps\api')
$env:DATABASE_URL = "postgres://dorutj_migrator:$PostgresPassword@localhost:5432/dorutj_test"
npx tsx src/infrastructure/database/migrate.ts 2>&1 | Select-Object -Last 1
docker exec $PostgresContainer psql -q -U dorutj_migrator -d dorutj_test -c "GRANT app_role TO test" | Out-Null
Remove-Item Env:DATABASE_URL
$env:REDIS_URL = "redis://:$RedisPassword@localhost:6380"
$ErrorActionPreference = 'Continue'
npx vitest run --config vitest.integration.config.ts --reporter=json --outputFile=$out 2>&1 | Out-Null
$r = Get-Content $out -Raw | ConvertFrom-Json
"[$Tag] files failed=$($r.numFailedTestSuites) tests failed=$($r.numFailedTests) passed=$($r.numPassedTests) pending=$($r.numPendingTests)"
