// Реальный UI-вход в apps/pharmacy (/login: phone-step → code-step). Не через localStorage
// refreshToken: apps/pharmacy не делает refresh на старте (accessToken живёт только в памяти).
// Ретрай на phone-step — сидовый номер один на файл, соседние тесты могут упереться в
// OTP_REQUEST_RATE_LIMITED ('phone_cooldown', ~10с) при быстром повторном запросе того же номера.
import { type Page, expect } from '@playwright/test'
import { getOtpFromMockSms } from './get-otp-from-mock-sms.js'

const COOLDOWN_RETRY_MS = 11_000
const MAX_ATTEMPTS = 3

async function submitPhoneStep(page: Page, nationalDigits: string): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await page.locator('[data-testid="phone-step"] input').fill(nationalDigits)
    await page.locator('[data-testid="phone-step"] button[type="submit"]').click()
    const codeStep = page.locator('[data-testid="code-step"]')
    const phoneError = page.locator('[data-testid="phone-step-error"]')
    await Promise.race([codeStep.waitFor({ state: 'visible' }), phoneError.waitFor({ state: 'visible' })])
    if (await codeStep.isVisible()) return
    if (attempt === MAX_ATTEMPTS) break
    await page.waitForTimeout(COOLDOWN_RETRY_MS)
  }
}

export async function loginPharmacyViaUi(page: Page, pharmacyUrl: string, phoneE164: string): Promise<void> {
  await page.goto(`${pharmacyUrl}/login`)
  await submitPhoneStep(page, phoneE164.replace('+992', ''))

  const codeStep = page.locator('[data-testid="code-step"]')
  await expect(codeStep).toBeVisible()
  const code = await getOtpFromMockSms(phoneE164)
  await codeStep.locator('input').first().click()
  await page.keyboard.type(code)

  await expect(page).not.toHaveURL(/\/login$/)
}
