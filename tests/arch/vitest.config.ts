/**
 * Vitest config для `tests/arch` (EP-01+ / runtime-connectivity tests).
 *
 * Пул `vmThreads` выбран СОЗНАТЕЛЬНО: дефолт `forks` в Vitest 4 на Windows
 * использует `child_process.spawn` с `stdio: 'pipe'`, который в DSH sandbox
 * (Windows) падает с EPERM (-4048) — см. STATE-AND-RESUME-POINT.md §11.7
 * (фикстуры известной блокировки). `vmThreads` использует worker threads
 * вместо child_process, что обходит это ограничение.
 *
 * Тесты здесь — ЧИСТО-ФАЙЛОВЫЕ (читают `*.ts` регулярками), не трогают БД
 * или HTTP, поэтому изоляция между тестами не нужна — `isolate: false`
 * дополнительно ускоряет прогон.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'vmThreads',
    isolate: false,
    environment: 'node',
  },
})
