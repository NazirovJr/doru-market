// Сравнение интеграционных прогонов по имени теста: регрессия = падение, которого нет ни в одном эталоне.
// Упавший файл учитывается отдельно: при падении в beforeAll vitest помечает все его тесты как skipped.
// Использование: node cmp.js <тег-прогона> <тег-эталона> [<тег-эталона>...]
// Отчёты itest-<тег>.json ищутся в ITEST_BASELINE_DIR (по умолчанию ./itest-baselines).
const fs = require('fs')
const path = require('path')
const dir = process.env.ITEST_BASELINE_DIR || 'itest-baselines'
const [, , target, ...baselines] = process.argv
if (!target || baselines.length === 0) {
  console.error('usage: node cmp.js <target-tag> <baseline-tag> [<baseline-tag>...]')
  process.exit(2)
}
const load = (t) => {
  const r = JSON.parse(fs.readFileSync(path.join(dir, `itest-${t}.json`), 'utf8'))
  const s = new Set()
  for (const f of r.testResults) {
    const file = f.name.replace(/.*test[\/]integration[\/]/, '')
    if (f.status === 'failed') s.add(`${file} :: <file failed>`)
    for (const a of f.assertionResults) if (a.status === 'failed') s.add(`${file} :: ${a.fullName}`)
  }
  return s
}
const base = new Set(baselines.flatMap((b) => [...load(b)]))
const cur = load(target)
const fresh = [...cur].filter((x) => !base.has(x))
console.log(`${target}: failures ${cur.size}, new vs [${baselines.join(', ')}]: ${fresh.length}`)
for (const x of fresh) console.log('  ' + x.slice(0, 220))
