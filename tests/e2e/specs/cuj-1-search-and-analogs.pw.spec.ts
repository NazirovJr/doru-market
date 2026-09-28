// CUJ-1 — поиск и аналоги (гость, DTJ-418). Пропуск без стенда — как в smoke/web-opens.pw.spec.ts.
// Расхождения с текстом тикета (детали — отчёт сдачи): нет кнопки «В корзину» на /search и
// /medicines/:id (добавляем через прямой POST /cart/items); из результатов поиска нет перехода
// на карточку товара (навигация по URL); GET /medicines/search не шлёт lat/lon (SRS-CAT-045
// недостижим через UI).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { SEED_ANALOG_CLUSTER } from '@dorutj/testing-kit'
import { runAxeCheck } from '../helpers/axe-check.js'

const webUrl = process.env.E2E_WEB_URL
const apiBaseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

// Опечатка «е»→«и» под SEED_ANALOG_CLUSTER (innName='Парацетамол') — в тексте тикета «цытрамон»/
// «Цитрамон», но этого препарата нет в кластере аналогов на этом стенде.
const TYPO_QUERY = 'парацитамол'

const ruDictionaryPath = fileURLToPath(new URL('../../../packages/i18n/src/dictionaries/ru.json', import.meta.url))
const ruDictionary = JSON.parse(readFileSync(ruDictionaryPath, 'utf8')) as Record<string, string>
const CANONICAL_NO_RESULTS_RU = ruDictionary['catalog.search.no_results']

interface SearchOffer {
  readonly pharmacyId: string
  readonly priceDiram: number
}
interface SearchItem {
  readonly medicineId: string
  readonly tradeName: string
  readonly innName: string
  readonly cheapestOffer: SearchOffer | null
}

async function searchByText(request: APIRequestContext, text: string): Promise<readonly SearchItem[]> {
  const response = await request.get(`${apiBaseUrl}/api/v1/medicines/search`, { params: { text } })
  expect(response.ok(), `GET /medicines/search?text=${text}`).toBe(true)
  const body = (await response.json()) as { data: readonly SearchItem[] }
  return body.data
}

async function switchToRuLocale(page: Page): Promise<void> {
  const pill = page.locator('[data-testid="language-switcher-placeholder"] button', { hasText: 'RU' })
  await pill.click()
  await expect(pill).toHaveAttribute('aria-pressed', 'true')
}

test.describe('CUJ-1: поиск и аналоги (SRS-CAT-024/027/030/038/045/077, гость)', () => {
  test.skip(webUrl === undefined, 'запускается только с E2E_WEB_URL=<адрес поднятого apps/web>')

  test('CUJ-1: search typo correction shows expected medicine suggestion', async ({ page }) => {
    await page.goto(webUrl!)
    const input = page.locator('[data-testid="search-bar-input"]')
    await input.fill(TYPO_QUERY)
    const dropdown = page.locator('[data-testid="suggest-dropdown-list"]')
    await expect(dropdown).toBeVisible()
    const options = page.locator('[data-testid="suggest-dropdown-option"]')
    const matching = options.filter({ hasText: SEED_ANALOG_CLUSTER.innName })
    await expect(matching.first()).toBeVisible()

    await matching.first().click()
    await expect(page).toHaveURL(/\/search\?text=/)
    await expect(page.locator('[data-testid="search-results-list"]')).toBeVisible()
    await expect(page.locator('[data-testid="search-result-card"]').first()).toBeVisible()

    await runAxeCheck(page)
  })

  test('CUJ-1: приглушённое отображение позиций без предложений рядом (SRS-CAT-045)', async ({ request }) => {
    const farAway = await request.get(`${apiBaseUrl}/api/v1/medicines/search`, {
      params: { text: SEED_ANALOG_CLUSTER.innName, lat: '0', lon: '0', radiusMeters: '1000' },
    })
    expect(farAway.ok()).toBe(true)
    const items = ((await farAway.json()) as { data: readonly SearchItem[] }).data
    expect(items.some((item) => item.cheapestOffer === null), 'бэкенд отдаёт cheapestOffer:null для удалённой точки').toBe(true)

    test.skip(true, 'apps/web/src/features/search/api/search-results.api.ts не передаёт lat/lon — ветка cheapestOffer:null недостижима через реальный UI')
  })

  test('CUJ-1: axe check on medicine page (analogs block, neutral state)', async ({ page, request }) => {
    const items = await searchByText(request, SEED_ANALOG_CLUSTER.referenceTradeName)
    const reference = items.find((item) => item.tradeName === SEED_ANALOG_CLUSTER.referenceTradeName)
    expect(reference, `referenceTradeName "${SEED_ANALOG_CLUSTER.referenceTradeName}" не найден в каталоге стенда`).toBeDefined()

    await page.goto(`${webUrl!}/medicines/${reference!.medicineId}`)
    await expect(page.locator('[data-testid="analogs-block"]')).toBeVisible()
    await expect(page.locator('[data-testid="analogs-disclaimer"]')).not.toBeEmpty()

    await runAxeCheck(page)
  })

  test('CUJ-1: analog banner shows correct savings for reference/generic pair', async ({ page, request }) => {
    const items = await searchByText(request, SEED_ANALOG_CLUSTER.referenceTradeName)
    const reference = items.find((item) => item.tradeName === SEED_ANALOG_CLUSTER.referenceTradeName)
    expect(reference, `referenceTradeName "${SEED_ANALOG_CLUSTER.referenceTradeName}" не найден в каталоге стенда`).toBeDefined()

    // NullAnalogOfferLookupAdapter (catalog.module.ts:139, TODO(DTJ-101→DTJ-160)) — items всегда [].
    // Известный дефект, координатор заводит DTJ-439 (подтверждено сообщением координатора).
    test.skip(true, 'DTJ-439: ANALOG_OFFER_LOOKUP_PORT = NullAnalogOfferLookupAdapter — SavingsBanner недостижим на этом стенде')

    await page.goto(`${webUrl!}/medicines/${reference!.medicineId}`)
    await expect(page.locator('[data-testid="analogs-savings-banner"]')).toBeVisible()
  })

  test('CUJ-1: adding generic to cart creates soft reservation visible in /cart', async ({ page, request }) => {
    const items = await searchByText(request, SEED_ANALOG_CLUSTER.genericTradeNames[0])
    const generic = items.find((item) => item.tradeName === SEED_ANALOG_CLUSTER.genericTradeNames[0])
    expect(generic, `generic "${SEED_ANALOG_CLUSTER.genericTradeNames[0]}" не найден в каталоге стенда`).toBeDefined()
    expect(generic!.cheapestOffer, 'дженерик обязан иметь оффер в сиде').not.toBeNull()
    const offer = generic!.cheapestOffer!

    const addResponse = await request.post(`${apiBaseUrl}/api/v1/cart/items`, {
      data: { medicineId: generic!.medicineId, pharmacyId: offer.pharmacyId, quantity: 1 },
    })
    expect(addResponse.ok(), 'POST /api/v1/cart/items (AddCartItemUseCase, SRS-ORD-005)').toBe(true)
    const sessionToken = addResponse.headers()['x-cart-session-token']
    expect(sessionToken, 'сервер обязан выдать X-Cart-Session-Token гостю').toBeTruthy()

    // Гостевой токен корзины — тот же localStorage-ключ, что cart-session-store.ts.
    await page.goto(webUrl!)
    await page.evaluate((token) => {
      localStorage.setItem('dorutj.cart-session', JSON.stringify({ state: { sessionToken: token }, version: 0 }))
    }, sessionToken)
    await page.goto(`${webUrl!}/cart`)

    const cartItem = page.locator('[data-testid="cart-item-row"]')
    await expect(cartItem).toBeVisible()
    await expect(cartItem.locator('[data-testid="cart-item-medicine-name"]')).toHaveText(generic!.tradeName)
    const expectedSomoni = (offer.priceDiram / 100).toFixed(2)
    await expect(cartItem.locator('[data-testid="cart-item-price"]')).toContainText(expectedSomoni)

    await runAxeCheck(page)
  })

  test('CUJ-1: search with no results shows canonical empty state, not generic error', async ({ page }) => {
    await page.goto(webUrl!)
    await switchToRuLocale(page)
    await page.goto(`${webUrl!}/search?text=zzzznonexistentmedicine9999`)

    const empty = page.locator('[data-testid="search-results-empty"]')
    await expect(empty).toBeVisible()
    await expect(empty).toHaveText(CANONICAL_NO_RESULTS_RU!)
    await expect(page.locator('[data-testid="search-results-error"]')).toHaveCount(0)

    await runAxeCheck(page)
  })
})
