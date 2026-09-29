// CUJ-1 — поиск, аналоги и путь покупки кликами (гость). Пропуск без стенда — как в smoke/web-opens.pw.spec.ts.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { SEED_ANALOG_CLUSTER, SEED_USERS } from '@dorutj/testing-kit'
import { runAxeCheck } from '../helpers/axe-check.js'
import { loginViaApi } from '../helpers/login-via-api.js'

const webUrl = process.env.E2E_WEB_URL
const apiBaseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

// Опечатка «е»→«и» под SEED_ANALOG_CLUSTER (innName='Парацетамол').
const TYPO_QUERY = 'парацитамол'

const ruDictionaryPath = fileURLToPath(new URL('../../../packages/i18n/src/dictionaries/ru.json', import.meta.url))
const ruDictionary = JSON.parse(readFileSync(ruDictionaryPath, 'utf8')) as Record<string, string>
const CANONICAL_NO_RESULTS_RU = ruDictionary['catalog.search.no_results']

interface SearchOffer {
  readonly pharmacyId: string
  readonly pharmacyName: string
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

// Главная → поиск → клик по результату с точным названием → карточка товара; без прямых URL.
async function openMedicineViaSearch(page: Page, tradeName: string): Promise<void> {
  await page.goto(webUrl!)
  await page.locator('[data-testid="search-bar-input"]').fill(tradeName)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/search\?text=/)
  await page.getByRole('button', { name: tradeName, exact: true }).click()
  await expect(page).toHaveURL(/\/medicines\//)
  await expect(page.getByRole('heading', { name: tradeName })).toBeVisible()
}

function offerRowOf(page: Page, pharmacyName: string): Locator {
  return page.locator('[data-testid="pharmacy-offer-row"]', { hasText: pharmacyName })
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

  test('CUJ-1: axe check on medicine page (analogs block)', async ({ page }) => {
    await openMedicineViaSearch(page, SEED_ANALOG_CLUSTER.referenceTradeName)
    await expect(page.locator('[data-testid="analogs-block"]')).toBeVisible()
    await expect(page.locator('[data-testid="analogs-disclaimer"]')).not.toBeEmpty()

    await runAxeCheck(page)
  })

  test('CUJ-1: analog banner shows savings for reference/generic pair, analog can be added to cart', async ({ page }) => {
    await openMedicineViaSearch(page, SEED_ANALOG_CLUSTER.referenceTradeName)

    await expect(page.locator('[data-testid="analogs-savings-banner"]')).toBeVisible()
    const analog = page.locator('[data-testid="analog-card"]').first()
    await analog.getByRole('button').click()
    await page.locator('[data-testid="header-cart-link"]').click()
    await expect(page).toHaveURL(/\/cart$/)
    await expect(page.locator('[data-testid="cart-item-row"]')).toHaveCount(1)
  })

  test('CUJ-1: гость проходит путь покупки кликами — поиск, карточка, «В корзину», иконка корзины, /cart', async ({ page, request }) => {
    const tradeName = SEED_ANALOG_CLUSTER.genericTradeNames[0]
    const generic = (await searchByText(request, tradeName)).find((item) => item.tradeName === tradeName)
    expect(generic?.cheapestOffer, 'дженерик обязан иметь оффер в сиде').toBeTruthy()
    const offer = generic!.cheapestOffer!

    await openMedicineViaSearch(page, tradeName)
    await offerRowOf(page, offer.pharmacyName).getByRole('button').click()
    await expect(page.locator('[data-testid="header-cart-count"]')).toHaveText('1')
    await page.locator('[data-testid="header-cart-link"]').click()

    await expect(page).toHaveURL(/\/cart$/)
    const cartItem = page.locator('[data-testid="cart-item-row"]')
    await expect(cartItem).toBeVisible()
    await expect(cartItem.locator('[data-testid="cart-item-medicine-name"]')).toHaveText(tradeName)
    await expect(cartItem.locator('[data-testid="cart-item-price"]')).toContainText((offer.priceDiram / 100).toFixed(2))

    await runAxeCheck(page)
  })

  test('CUJ-1: «В корзину» доступна прямо в результатах поиска', async ({ page }) => {
    await page.goto(webUrl!)
    await page.locator('[data-testid="search-bar-input"]').fill(SEED_ANALOG_CLUSTER.genericTradeNames[1])
    await page.keyboard.press('Enter')
    await page.locator('[data-testid="search-result-card"]').first().getByRole('button', { name: /.+/ }).last().click()
    await expect(page.locator('[data-testid="header-cart-count"]')).toHaveText('1')
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

test.describe('CUJ-1: геолокация в поиске (SRS-CAT-045)', () => {
  test.skip(webUrl === undefined, 'запускается только с E2E_WEB_URL=<адрес поднятого apps/web>')
  // Точка вне зоны любой аптеки сида: ни у одной позиции нет остатка рядом.
  test.use({ geolocation: { latitude: 0, longitude: 0 }, permissions: ['geolocation'] })

  test('CUJ-1: приглушённое отображение позиций без предложений рядом', async ({ page }) => {
    await page.goto(`${webUrl!}/search?text=${encodeURIComponent(SEED_ANALOG_CLUSTER.innName)}`)

    await expect(page.locator('[data-testid="nearby-status"]')).toHaveAttribute('data-status', 'granted')
    const dimmed = page.locator('[data-testid="search-result-card"].opacity-60')
    await expect(dimmed.first()).toBeVisible()
    await expect(dimmed.first().locator('[data-testid="medicine-card-no-stock"]')).toBeVisible()
  })
})

test.describe('CUJ-1: восстановление сессии после перезагрузки (DTJ-440)', () => {
  test.skip(webUrl === undefined, 'запускается только с E2E_WEB_URL=<адрес поднятого apps/web>')

  test('CUJ-1: вошедший пользователь после перезагрузки остаётся вошедшим, корзина его', async ({ page, request }) => {
    const tradeName = SEED_ANALOG_CLUSTER.genericTradeNames[0]
    const generic = (await searchByText(request, tradeName)).find((item) => item.tradeName === tradeName)
    expect(generic?.cheapestOffer, 'дженерик обязан иметь оффер в сиде').toBeTruthy()
    const session = await loginViaApi(SEED_USERS.customer1.phone)
    const added = await request.post(`${apiBaseUrl}/api/v1/cart/items`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
      data: { medicineId: generic!.medicineId, pharmacyId: generic!.cheapestOffer!.pharmacyId, quantity: 1 },
    })
    expect(added.ok(), 'POST /api/v1/cart/items от имени customer1').toBe(true)

    // Как после реального входа: access-токен в памяти, в localStorage — только refresh и user.
    await page.goto(webUrl!)
    await page.evaluate(
      ([key, value]) => {
        window.localStorage.setItem(key, value)
      },
      ['dorutj.auth', JSON.stringify({ state: { refreshToken: session.refreshToken, user: session.user }, version: 0 })] as const,
    )

    const itemRow = page.locator('[data-testid="cart-item-row"]', { hasText: tradeName }).first()
    await page.goto(`${webUrl!}/cart`)
    await expect(itemRow).toBeVisible()
    // Повторная перезагрузка: ротированный refresh-токен из первой обязан был сохраниться.
    await page.reload()
    await expect(itemRow).toBeVisible()
  })
})
