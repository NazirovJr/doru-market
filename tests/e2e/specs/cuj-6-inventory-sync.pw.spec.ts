// CUJ-6' — 1С/Excel-синхронизация остатков (DTJ-418). Пропуск без стенда — как в
// smoke/web-opens.pw.spec.ts. Расхождения с текстом тикета (детали — отчёт сдачи): реальный
// маршрут /inventory, не /admin/inventory; ни один сидовый pharmacy_admin не привязан к одной
// аптеке (pharmacyId=null → 400 на upload); батчи Excel-импорта обрабатываются воркером,
// которого нет в apps/worker.
import { test, expect, type Page } from '@playwright/test'
import { SEED_USERS } from '@dorutj/testing-kit'
import { runAxeCheck } from '../helpers/axe-check.js'
import { loginPharmacyViaUi } from '../helpers/cuj6-login-pharmacy-ui.js'

const pharmacyUrl = process.env.E2E_PHARMACY_URL
const PHARMACY_ADMIN_PHONE = SEED_USERS.pharmacyAdminExcel.phone

async function openBulkEditTab(page: Page): Promise<void> {
  await loginPharmacyViaUi(page, pharmacyUrl!, PHARMACY_ADMIN_PHONE)
  // Шапка: [order-queue, inventory, sync-history, returns] — вторая вкладка.
  await page.locator('[role="tab"]').nth(1).click()
  await expect(page.locator('[data-testid="inventory-page"]')).toBeVisible()
  // InventoryPage: своя пара вкладок (point_edit, bulk_edit) — вторая.
  await page.locator('[data-testid="inventory-page"] [role="tab"]').nth(1).click()
  await expect(page.locator('[data-testid="excel-import-dropzone"]')).toBeVisible()
}

test.describe("CUJ-6': 1С/Excel-синхронизация остатков (SRS-INV-012/013/014, pharmacy_admin)", () => {
  test.skip(pharmacyUrl === undefined, 'запускается только с E2E_PHARMACY_URL=<адрес поднятого apps/pharmacy>')

  test('CUJ-6: excel import template download works', async ({ page }) => {
    await openBulkEditTab(page)

    const downloadPromise = page.waitForEvent('download')
    await page.locator('[data-testid="excel-import-download-template"]').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('doru-tj-inventory-template.xlsx')
    expect(await download.path(), 'скачанный файл должен реально сохраниться на диск').not.toBeNull()

    await runAxeCheck(page)
  })

  test('CUJ-6: valid import makes item searchable and cache-invalidated', async ({ page }) => {
    await openBulkEditTab(page)

    await page.locator('[data-testid="dorutj-file-dropzone-input"]').setInputFiles('../fixtures/inventory/valid-import-template.xlsx')
    await page.locator('input[name="excel-import-mode"][value="append_update"]').check()
    await page.locator('[data-testid="excel-import-upload-button"]').click()

    // pharmacyAdminExcel.pharmacyId=null → 400 на POST /inventory-excel-import (см. JSDoc файла).
    await expect(page.locator('[data-testid="excel-import-accepted-summary"]')).toBeVisible()

    test.skip(true, 'pharmacyId=null у сидового pharmacy_admin + нет воркера inventory.sync_batch.queued — см. JSDoc файла')
  })

  test('CUJ-6: partial success import reports exact failing row', async ({ page }) => {
    await openBulkEditTab(page)

    await page.locator('[data-testid="dorutj-file-dropzone-input"]').setInputFiles('../fixtures/inventory/import-with-ambiguous-date.xlsx')
    await page.locator('input[name="excel-import-mode"][value="append_update"]').check()
    await page.locator('[data-testid="excel-import-upload-button"]').click()

    await expect(page.locator('[data-testid="excel-import-accepted-summary"]')).toBeVisible()

    // Ошибки парсера сохраняются синхронно (без воркера), rowIndex=1 — 2-я строка данных, ISO-дата.
    test.skip(true, 'pharmacyId=null у сидового pharmacy_admin — построчный отчёт недостижим без успешной загрузки')
  })

  test('CUJ-6: stale inventory item shows staleness badge past SLA', () => {
    test.skip(
      true,
      'FixedClockAdapter не привязан к E2E (SystemClockAdapter в DI), SQL-правка pharmacy_inventory ' +
        'запрещена (второй источник данных), а без воркера импортированная позиция не попадает в pharmacy_inventory',
    )
  })
})
