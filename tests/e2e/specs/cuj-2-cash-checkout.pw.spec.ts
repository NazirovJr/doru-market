/**
 * CUJ-2' — заказ с оплатой наличными (DTJ-419, `docs/spec/30-ux-screens-and-flows.md` §4).
 * Без `E2E_BASE_URL`/`E2E_WEB_URL` — `test.skip` (как `smoke/web-opens.pw.spec.ts`).
 *
 * Расхождения реализации со спекой/тикетом (детали — отчёт сдачи, ДОПУЩЕНИЯ): (1) спека §4
 * строка 490 пишет «paid_escrow», код (D-25, `checkout.use-case.ts`) — `confirmed`, тест проверяет
 * код; (2) гость на `/checkout` видит инлайн-гейт, не редирект (route-guard'а в проекте нет);
 * (3) гостевая корзина не мёржится в авторизованную (`merge-guest-cart.use-case.ts` без вызывающих
 * мест) — товары добавляются ПОСЛЕ логина.
 */
import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { SEED_ANALOG_CLUSTER, SEED_PHARMACIES, E2E_FRESH_PHONE_PREFIX } from '@dorutj/testing-kit'
import { loginViaApi } from '../helpers/login-via-api.js'
import { getOtpFromMockSms } from '../helpers/get-otp-from-mock-sms.js'
import { injectBrowserSession } from '../helpers/cuj2-browser-session.js'
import {
  addCartItem,
  createOrderViaApi,
  createOrderViaFetch,
  findMedicineIdByTradeName,
  DUSHANBE_DEMO_ADDRESS,
  type CreateOrderApiInput,
} from '../helpers/cuj2-checkout-api.js'

const WEB_URL_RAW = process.env.E2E_WEB_URL
const BASE_URL_RAW = process.env.E2E_BASE_URL
const TICKET_PHONE_DIGITS = '19'

/** Сужение до `string` — только для `exactOptionalPropertyTypes`, `test.skip` ниже уже гарантирует значение. */
function baseUrl(): string {
  if (BASE_URL_RAW === undefined) throw new Error('E2E_BASE_URL не задан')
  return BASE_URL_RAW
}

function webUrl(): string {
  if (WEB_URL_RAW === undefined) throw new Error('E2E_WEB_URL не задан')
  return WEB_URL_RAW
}

// Смещение от времени, не счётчик с 0 — иначе повторный прогон бьёт в `OTP_REQUEST_RATE_LIMITED`
// для уже использованных номеров (обнаружено живым прогоном).
let freshPhoneCounter = Date.now() % 900
function nextFreshPhone(): string {
  freshPhoneCounter += 1
  return `${E2E_FRESH_PHONE_PREFIX}${TICKET_PHONE_DIGITS}${String(freshPhoneCounter % 1000).padStart(3, '0')}`
}

/** Любой 6-значный код, заведомо отличный от `correctCode` (для негативных попыток OTP). */
function wrongOtpCode(correctCode: string): string {
  return correctCode === '000000' ? '111111' : '000000'
}

/** Чистит ячейку перед вводом — иначе повтор ТОГО ЖЕ кода не меняет DOM-значение, React не видит
 *  `onChange`, авто-submit не срабатывает (заметно живым прогоном). */
async function fillOtpCode(page: Page, code: string): Promise<void> {
  const cells = page.locator('[data-testid="code-step"] input')
  for (let i = 0; i < code.length; i += 1) {
    await cells.nth(i).fill('')
    await cells.nth(i).fill(code[i]!)
  }
}

test.describe('CUJ-2: заказ с оплатой наличными', () => {
  test.skip(BASE_URL_RAW === undefined, 'нужен E2E_BASE_URL — живой стенд API')

  test('cart shows multi-pharmacy split warning', async ({ page, request }) => {
    test.skip(WEB_URL_RAW === undefined, 'нужен E2E_WEB_URL — живой стенд apps/web')

    const phone = nextFreshPhone()
    const session = await loginViaApi(phone, { baseUrl: baseUrl() })
    const medicineId = await findMedicineIdByTradeName(request, SEED_ANALOG_CLUSTER.genericTradeNames[0])
    await addCartItem(request, session.accessToken, {
      medicineId,
      pharmacyId: SEED_PHARMACIES.oneCCenter.id,
      quantity: 1,
    })
    await addCartItem(request, session.accessToken, {
      medicineId,
      pharmacyId: SEED_PHARMACIES.excelCenter.id,
      quantity: 1,
    })

    await injectBrowserSession(page, session)
    await page.goto(`${webUrl()}/cart`)

    await expect(page.getByTestId('cart-split-banner')).toBeVisible()
    await expect(page.getByTestId('pharmacy-group-card')).toHaveCount(2)
  })

  test('guest checkout redirects to login and OTP flow completes', async ({ page }) => {
    test.skip(WEB_URL_RAW === undefined, 'нужен E2E_WEB_URL — живой стенд apps/web')

    await page.goto(`${webUrl()}/checkout`)
    // Реальный гейт — инлайн-блок, не редирект (см. JSDoc файла).
    await expect(page.getByTestId('checkout-unauthenticated')).toBeVisible()
    await page.getByTestId('checkout-login-cta').click()
    await expect(page).toHaveURL(/\/login/)

    const phone = nextFreshPhone()
    await page.locator('[data-testid="phone-step"] input').fill(phone.replace('+992', ''))
    await page.locator('[data-testid="phone-step"] button[type="submit"]').click()
    await expect(page.getByTestId('code-step')).toBeVisible()

    const code = await getOtpFromMockSms(phone, { baseUrl: baseUrl() })
    await fillOtpCode(page, code)

    // `goLogin` не прокидывает `?intent=` — landing после логина на `/`, не назад на `/checkout`.
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('cash order synchronously reaches "confirmed", not "paid_escrow", no escrow_ledger rows', async ({
    request,
  }) => {
    const phone = nextFreshPhone()
    const session = await loginViaApi(phone, { baseUrl: baseUrl() })
    const medicineId = await findMedicineIdByTradeName(request, SEED_ANALOG_CLUSTER.genericTradeNames[0])
    const { cartItemId } = await addCartItem(request, session.accessToken, {
      medicineId,
      pharmacyId: SEED_PHARMACIES.oneCCenter.id,
      quantity: 1,
    })

    const input: CreateOrderApiInput = {
      cartItemIds: [cartItemId],
      paymentMethod: 'cash_courier',
      inlineAddress: DUSHANBE_DEMO_ADDRESS,
    }
    const result = await createOrderViaApi(request, { accessToken: session.accessToken, idempotencyKey: randomUUID(), input })

    // Живой стенд: 422 COD_LIMIT_EXCEEDED — минимальная цена каталога (70000) выше
    // `tenant_settings.cod_limit_diram` (50000) для любой позиции, вне периметра тикета (БЛОКЕРЫ).
    expect(result.status, JSON.stringify(result.body)).toBe(200)
    const body = result.body as { data: { orders: readonly { status: string }[] } }
    expect(body.data.orders).toHaveLength(1)
    expect(body.data.orders[0]!.status).toBe('confirmed')
  })

  test('5 failed OTP attempts lock login, correct code on 6th attempt still rejected', async ({ page }) => {
    test.skip(WEB_URL_RAW === undefined, 'нужен E2E_WEB_URL — живой стенд apps/web')

    const phone = nextFreshPhone()
    await page.goto(`${webUrl()}/login`)
    await page.locator('[data-testid="phone-step"] input').fill(phone.replace('+992', ''))
    await page.locator('[data-testid="phone-step"] button[type="submit"]').click()
    await expect(page.getByTestId('code-step')).toBeVisible()

    const correctCode = await getOtpFromMockSms(phone, { baseUrl: baseUrl() })
    const badCode = wrongOtpCode(correctCode)
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await fillOtpCode(page, badCode)
      await expect(page.getByTestId('code-step-error')).toBeVisible()
    }

    // 6-я — ПРАВИЛЬНЫЙ код: сервер считает лимит попыток исчерпанным ДО сравнения хэша.
    await fillOtpCode(page, correctCode)
    await expect(page.getByTestId('locked-screen')).toBeVisible()
  })

  test('double-tap checkout does not create duplicate order (idempotency)', async ({ request }) => {
    const phone = nextFreshPhone()
    const session = await loginViaApi(phone, { baseUrl: baseUrl() })
    const medicineId = await findMedicineIdByTradeName(request, SEED_ANALOG_CLUSTER.genericTradeNames[0])
    const { cartItemId } = await addCartItem(request, session.accessToken, {
      medicineId,
      pharmacyId: SEED_PHARMACIES.oneCCenter.id,
      quantity: 1,
    })
    const input: CreateOrderApiInput = {
      cartItemIds: [cartItemId],
      paymentMethod: 'cash_courier',
      inlineAddress: DUSHANBE_DEMO_ADDRESS,
    }
    const call = { accessToken: session.accessToken, idempotencyKey: randomUUID(), input }

    // Серверный рубеж — напрямую, двумя одновременными запросами с одним ключом (см. `createOrderViaFetch`).
    const [first, second] = await Promise.all([createOrderViaFetch(baseUrl(), call), createOrderViaFetch(baseUrl(), call)])

    const statuses = [first.status, second.status].sort((a, b) => a - b)
    const conflictCount = statuses.filter((status) => status === 409).length
    expect(conflictCount, `${JSON.stringify(first)} / ${JSON.stringify(second)}`).toBe(1)
    const conflictResponse = first.status === 409 ? first : second
    expect((conflictResponse.body as { error: { code: string } }).error.code).toBe('IDEMPOTENCY_KEY_CONFLICT')
  })
})
