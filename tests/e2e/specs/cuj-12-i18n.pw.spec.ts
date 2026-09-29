// CUJ-12: неавторизованный apps/web, главный экран + /pharmacy-application. Пропуск без стенда —
// как в smoke/web-opens.pw.spec.ts.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { captureVisibleTextSnapshot } from '../helpers/dom-text-snapshot.js'

const webUrl = process.env.E2E_WEB_URL
const EXPECTED_BRAND_NAME = 'DoruTJ'
// Легитимные исключения из «100% строк меняются»: коды локали (не переводимый текст) + бренд.
const LOCALE_INVARIANT_STRINGS: ReadonlySet<string> = new Set(['TJ', 'RU', 'EN', EXPECTED_BRAND_NAME])

// Файловая фикстура через URL, не `../../*`-импорт (C16, no-restricted-imports).
const partialFormFixtureUrl = fileURLToPath(new URL('../../fixtures/i18n/partial-application-form.json', import.meta.url))
const partialForm = JSON.parse(readFileSync(partialFormFixtureUrl, 'utf8')) as { phone: string; legalEntityName: string }

type LocaleCode = 'TJ' | 'RU' | 'EN'

async function switchLocale(page: Page, code: LocaleCode): Promise<void> {
  const pill = page.locator('[data-testid="language-switcher-placeholder"] button', { hasText: code })
  await pill.click()
  // Ждём коммит рендера — иначе снимок DOM снимается раньше, чем текст обновится.
  await expect(pill).toHaveAttribute('aria-pressed', 'true')
}

async function resetToFreshSession(page: Page): Promise<void> {
  await page.goto(webUrl!)
  await page.evaluate(() => { window.localStorage.clear() })
  await page.reload()
  // Ждём первую отрисовку (lazy-роут) до снимка DOM — иначе «before» снят раньше монтирования.
  await page.locator('[data-testid="search-bar-input"]').waitFor({ state: 'visible' })
}

test.describe('CUJ-12: i18n-инвариант (apps/web, SRS-NFR-076)', () => {
  test.skip(webUrl === undefined, 'запускается только с E2E_WEB_URL=<адрес поднятого apps/web>')

  test.beforeEach(async ({ page }) => {
    await resetToFreshSession(page)
  })

  test('дефолтная локаль при первой загрузке — tj (Charter §5)', async ({ page }) => {
    const activePill = page.locator('[data-testid="language-switcher-placeholder"] button[aria-pressed="true"]')
    await expect(activePill).toHaveText('TJ')
  })

  test('переключение tj->ru меняет 100% видимых строк, кроме brand.name (словарь-инвариант)', async ({ page }) => {
    const before = await captureVisibleTextSnapshot(page)
    await switchLocale(page, 'RU')
    const after = await captureVisibleTextSnapshot(page)

    const unchanged = [...before].filter((text) => after.has(text) && !LOCALE_INVARIANT_STRINGS.has(text))
    expect(unchanged, `строки не изменились tj->ru: ${JSON.stringify(unchanged)}`).toEqual([])
  })

  test('переключение ru->en меняет 100% видимых строк, кроме brand.name (словарь-инвариант)', async ({ page }) => {
    await switchLocale(page, 'RU')
    const before = await captureVisibleTextSnapshot(page)
    await switchLocale(page, 'EN')
    const after = await captureVisibleTextSnapshot(page)

    const unchanged = [...before].filter((text) => after.has(text) && !LOCALE_INVARIANT_STRINGS.has(text))
    expect(unchanged, `строки не изменились ru->en: ${JSON.stringify(unchanged)}`).toEqual([])
  })

  test('brand.name читается из словаря текущей локали на tj/ru/en (не хардкод-плейсхолдер)', async ({ page }) => {
    const brand = page.locator('[data-testid="brand-placeholder"]')
    for (const code of ['TJ', 'RU', 'EN'] as const) {
      await switchLocale(page, code)
      await expect(brand, `локаль ${code}`).toHaveText(EXPECTED_BRAND_NAME)
    }
  })

  test('возврат tj->ru->tj: карточка количества использует единую неизменяемую tj-форму', () => {
    test.skip(
      true,
      'нет ни одного экрана apps/web, рендерящего packages/i18n formatNumber/formatPluralized ' +
        '(quantity.package.*) — утилита DTJ-402 экспортирована, но не подключена ни в одном UI-компоненте ' +
        '(grep "formatNumber|formatPluralized" apps/ — 0 совпадений вне packages/i18n). См. НАЙДЕННЫЕ ЧУЖИЕ ' +
        'ПРОБЛЕМЫ отчёта DTJ-422.',
    )
  })

  test('форма /pharmacy-application: значения полей переживают переключение локали без отправки', async ({ page }) => {
    await page.goto(`${webUrl!}/pharmacy-application`)
    await page.getByLabel('Телефон*').fill(partialForm.phone)

    await switchLocale(page, 'TJ')

    await expect(page.getByLabel('Телефон*')).toHaveValue(partialForm.phone)
  })

  test('форма /pharmacy-application: метки полей переключаются на tj/ru/en', async ({ page }) => {
    await page.goto(`${webUrl!}/pharmacy-application`)
    const ruLabel = await page.locator('form[data-testid="pharmacy-application-form"] label').first().innerText()

    await switchLocale(page, 'TJ')
    const tjLabel = await page.locator('form[data-testid="pharmacy-application-form"] label').first().innerText()

    expect(tjLabel, 'метка не изменилась ru->tj — форма не подключена к i18n (см. БЛОКЕРЫ отчёта DTJ-422)').not.toBe(
      ruLabel,
    )
  })

  test('GET /api/v1/i18n/:locale отвечает непустым словарём для tj/ru/en', async ({ request, baseURL }) => {
    test.skip(baseURL === undefined, 'нужен E2E_BASE_URL')
    const probe = await request.get(`${baseURL!}/api/v1/i18n/tj`)
    test.skip(
      probe.status() === 404,
      'GET /api/v1/i18n/:locale не реализован — apps/web раздаёт словари статически из ' +
        'packages/i18n (см. JSDoc packages/i18n/src/use-t.ts: "ВРЕМЕННО... пока не появится ' +
        'серверная раздача GET /api/v1/i18n/:locale (SRS-API-058, зона EP-18)"). См. БЛОКЕРЫ отчёта DTJ-422.',
    )

    for (const locale of ['tj', 'ru', 'en'] as const) {
      const response = await request.get(`${baseURL!}/api/v1/i18n/${locale}`)
      expect(response.status(), `локаль ${locale}`).toBe(200)
      const body = (await response.json()) as { data?: Record<string, string> }
      expect(Object.keys(body.data ?? {}).length, `локаль ${locale} — непустой словарь`).toBeGreaterThan(0)
    }
  })
})
