// Имя файла — `*.pw.spec.ts`, не `*.e2e-spec.ts`: только так подхватывается testMatch конфига.
import { test, expect, type Page } from '@playwright/test'
import { SEED_USERS, SEED_CHAINS, E2E_FRESH_PHONE_PREFIX } from '@dorutj/testing-kit'
import { loginViaApi } from '../helpers/login-via-api.js'
import { getOtpFromMockSms } from '../helpers/get-otp-from-mock-sms.js'
import {
  uploadLicenseDocument,
  submitPharmacyApplication,
  submitPharmacyForReview,
  listPendingPharmacyVerifications,
  approvePharmacyApplication,
  createStaffAccount,
  ingestInventoryRow,
  pickUnstockedCatalogMedicine,
  searchMedicinesByText,
  getPharmacyMapPins,
} from '../helpers/cuj9-onboarding-api.js'

function freshPhone(suffix: string): string {
  return `${E2E_FRESH_PHONE_PREFIX}21${suffix}`
}

const DUSHANBE_LAT = 38.5598
const DUSHANBE_LON = 68.787
const FUTURE_LICENSE_EXPIRY = '2030-01-01'
const FUTURE_INVENTORY_EXPIRY = '2030-06-01'
const FULL_CHECKLIST: Readonly<Record<string, boolean>> = {
  inn_matches_documents: true,
  license_is_valid: true,
  address_matches_license: true,
  contact_phone_verified: true,
}
const HTTP_OK = 200
const HTTP_FORBIDDEN = 403
const OTP_LENGTH = 6

function uniqueName(label: string): string {
  return `E2E DTJ-421 ${label} ${String(Date.now())}`
}

// accessToken не персистится в localStorage (только refreshToken/user) — сессию нельзя
// подложить в обход формы, только реальный UI OTP-вход.
async function loginAdminUiOtp(page: Page, adminUrl: string, phone: string): Promise<void> {
  await page.goto(`${adminUrl}/login`)
  const nationalDigits = phone.replace('+992', '')
  await page.locator('[data-testid="phone-step"] input[type="tel"]').fill(nationalDigits)
  await page.locator('[data-testid="phone-step"] button[type="submit"]').click()
  await expect(page.locator('[data-testid="code-step"]')).toBeVisible()
  const code = await getOtpFromMockSms(phone)
  const cells = page.locator('[data-testid="code-step"] input')
  for (let i = 0; i < OTP_LENGTH; i += 1) {
    await cells.nth(i).fill(code[i] ?? '')
  }
  await expect(page).toHaveURL(/\/admin\//)
}

test.describe('CUJ-9: модерация и онбординг аптеки (DTJ-421, SRS-NFR-073)', () => {
  const apiBaseUrl = process.env.E2E_BASE_URL
  test.skip(apiBaseUrl === undefined, 'запускается только с E2E_BASE_URL=<адрес поднятого apps/api>')

  test('pending pharmacy application shows document preview and checklist', async ({ page }) => {
    const adminUrlRaw = process.env.E2E_ADMIN_URL
    test.skip(adminUrlRaw === undefined, 'запускается только с E2E_ADMIN_URL=<адрес поднятого apps/admin>')
    const adminUrl = adminUrlRaw!

    const licenseUrl = await uploadLicenseDocument()
    const application = await submitPharmacyApplication({
      chainId: SEED_CHAINS.oneC.id,
      name: uniqueName('Test Pharmacy A'),
      addressText: 'г. Душанбе, ул. Тестовая, 1',
      latitude: DUSHANBE_LAT,
      longitude: DUSHANBE_LON,
      phone: freshPhone('001'),
      licenseNumber: `E2E-421-A-${String(Date.now())}`,
      licenseExpiryDate: FUTURE_LICENSE_EXPIRY,
      pharmacistInChargeName: 'Тестов Тест Тестович',
      licenseScanUrl: licenseUrl,
    })
    await submitPharmacyForReview(application.id)

    await loginAdminUiOtp(page, adminUrl, SEED_USERS.superAdmin1.phone)

    await page.goto(`${adminUrl}/admin/onboarding-queue`)
    await expect(page.getByRole('link', { name: new RegExp(application.id) })).toBeVisible()

    await page.getByRole('link', { name: new RegExp(application.id) }).click()
    await expect(page).toHaveURL(new RegExp(`/admin/onboarding-queue/pharmacy-accounts/${application.id}`))

    // Первый fieldset — чек-лист; второй — «Действия» (несёт ещё один, не относящийся, чекбокс).
    const checklistFieldset = page.locator('[data-testid="onboarding-application-detail"] fieldset').first()
    await expect(checklistFieldset).toBeVisible()
    await expect(checklistFieldset.getByRole('checkbox')).toHaveCount(Object.keys(FULL_CHECKLIST).length)

    // Ожидаемо красное: см. отчёт сдачи — ни один GET не отдаёт licenseScanUrl фронту.
    await expect(page.locator('[data-testid="onboarding-document-preview"]')).toBeVisible()
  })

  test('approving application: pending_review queue updates, medicine flips invisible→visible in search/map (single test, DoD invariant)', async () => {
    const medicine = await pickUnstockedCatalogMedicine()

    const application = await submitPharmacyApplication({
      chainId: SEED_CHAINS.oneC.id,
      name: uniqueName('Test Pharmacy B'),
      addressText: 'г. Душанбе, ул. Тестовая, 2',
      latitude: DUSHANBE_LAT,
      longitude: DUSHANBE_LON,
      phone: freshPhone('002'),
      licenseNumber: `E2E-421-B-${String(Date.now())}`,
      licenseExpiryDate: FUTURE_LICENSE_EXPIRY,
      pharmacistInChargeName: 'Вторая Тест Точка',
    })
    await submitPharmacyForReview(application.id)

    const admin = await loginViaApi(SEED_USERS.superAdmin2.phone)

    const queueBefore = await listPendingPharmacyVerifications(admin.accessToken, 'pending_review')
    expect(queueBefore.some((item) => item.id === application.id)).toBe(true)

    // pharmacy_admin (не pharmacist) — единственная роль, допущенная к inventory-manual-entry.
    const staffPhone = freshPhone('003')
    const staff = await createStaffAccount(admin.accessToken, {
      phone: staffPhone,
      fullName: 'Новая Точка Admin',
      role: 'pharmacy_admin',
      pharmacyId: application.id,
      chainId: SEED_CHAINS.oneC.id,
    })
    expect(staff.role).toBe('pharmacy_admin')

    const staffSession = await loginViaApi(staffPhone)
    const ingestResult = await ingestInventoryRow(staffSession.accessToken, {
      medicineId: medicine.medicineId,
      priceTjs: 42,
      quantity: 7,
      expiryDate: FUTURE_INVENTORY_EXPIRY,
    })
    expect(ingestResult.acceptedRows).toBe(1)

    const searchBefore = await searchMedicinesByText(medicine.tradeName)
    const foundBefore = searchBefore.find((item) => item.medicineId === medicine.medicineId)
    expect(foundBefore?.cheapestOffer?.pharmacyId).not.toBe(application.id)

    const mapBefore = await getPharmacyMapPins({ lat: DUSHANBE_LAT, lon: DUSHANBE_LON, medicineId: medicine.medicineId })
    expect(mapBefore.some((pin) => pin.pharmacyId === application.id)).toBe(false)

    const approveResponse = await approvePharmacyApplication({ token: admin.accessToken, pharmacyId: application.id, checklist: FULL_CHECKLIST })
    expect(approveResponse.status).toBe(HTTP_OK)

    const queueAfter = await listPendingPharmacyVerifications(admin.accessToken, 'pending_review')
    expect(queueAfter.some((item) => item.id === application.id)).toBe(false)

    // Ожидаемо красное: approve() оставляет status='approved', activate()→'active' никем не вызывается.
    const searchAfter = await searchMedicinesByText(medicine.tradeName)
    const foundAfter = searchAfter.find((item) => item.medicineId === medicine.medicineId)
    expect(foundAfter?.cheapestOffer?.pharmacyId).toBe(application.id)

    const mapAfter = await getPharmacyMapPins({ lat: DUSHANBE_LAT, lon: DUSHANBE_LON, medicineId: medicine.medicineId })
    expect(mapAfter.some((pin) => pin.pharmacyId === application.id)).toBe(true)
  })

  test('non-super_admin approve attempt returns 403 INSUFFICIENT_ROLE', async () => {
    const application = await submitPharmacyApplication({
      chainId: SEED_CHAINS.oneC.id,
      name: uniqueName('Test Pharmacy C RBAC'),
      addressText: 'г. Душанбе, ул. Тестовая, 3',
      latitude: DUSHANBE_LAT,
      longitude: DUSHANBE_LON,
      phone: freshPhone('004'),
      licenseNumber: `E2E-421-C-${String(Date.now())}`,
      licenseExpiryDate: FUTURE_LICENSE_EXPIRY,
      pharmacistInChargeName: 'Третья Тест Точка',
    })
    // Без submitForReview — RolesGuard отклоняет по роли ДО чтения статуса заявки.

    const pharmacyAdmin = await loginViaApi(SEED_USERS.pharmacyAdminOneC.phone)
    const response = await approvePharmacyApplication({ token: pharmacyAdmin.accessToken, pharmacyId: application.id, checklist: FULL_CHECKLIST })

    expect(response.status).toBe(HTTP_FORBIDDEN)
    expect(response.body.error?.code).toBe('INSUFFICIENT_ROLE')
  })
})
