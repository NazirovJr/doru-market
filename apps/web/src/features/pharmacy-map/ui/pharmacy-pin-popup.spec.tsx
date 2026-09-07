import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { PharmacyPinPopup } from './pharmacy-pin-popup'
import type { MapPin } from '../model/map-pin'

/**
 * `pharmacy-pin-popup.spec.tsx` (DTJ-198, тест-план: «попап без XSS на спецсимволах в имени»).
 * Строки словаря НЕ проверяются дословно (локаль по умолчанию — `tj`, ломкая связь с текстом
 * перевода) — структурные `data-testid` вместо этого.
 */

const basePin: MapPin = {
  pharmacyId: '11111111-1111-1111-1111-111111111111',
  name: 'Аптека Salomat',
  lat: 38.5598,
  lon: 68.787,
  isOpenNow: true,
  is24x7: false,
  offer: null,
}

function renderPopup(pin: MapPin): ReturnType<typeof render> {
  return render(
    <LocaleProvider>
      <PharmacyPinPopup pin={pin} />
    </LocaleProvider>,
  )
}

describe('PharmacyPinPopup (DTJ-198, критерий приёмки 4)', () => {
  it('1. offer=null — показывает имя и часы работы, без блока цены/остатка', () => {
    renderPopup(basePin)
    expect(screen.getByText('Аптека Salomat')).toBeInTheDocument()
    expect(screen.getByTestId('pharmacy-pin-popup-hours')).toBeInTheDocument()
    expect(screen.queryByTestId('pharmacy-pin-popup-price')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pharmacy-pin-popup-stale')).not.toBeInTheDocument()
  })

  it('2. offer с остатком (isStale=false) — цена/остаток видны, пометки устаревания нет', () => {
    const pin: MapPin = {
      ...basePin,
      offer: { priceDiram: 12550, stockQuantity: 7, lastSyncedAt: '2026-08-30T10:00:00Z', isStale: false },
    }
    renderPopup(pin)
    // DTJ-431: PriceTag/formatMoney (@dorutj/ui) маппит locale 'tj' → BCP-47 'tg' → запятая, не
    // точка прежнего локального formatSomoni() (см. JSDoc `@dorutj/i18n/format-money.ts`).
    expect(screen.getByTestId('pharmacy-pin-popup-price')).toHaveTextContent('125,50')
    expect(screen.getByTestId('pharmacy-pin-popup-stock')).toHaveTextContent('7')
    expect(screen.queryByTestId('pharmacy-pin-popup-stale')).not.toBeInTheDocument()
  })

  it('3. offer.isStale=true — видимая пометка устаревания присутствует', () => {
    const pin: MapPin = {
      ...basePin,
      offer: { priceDiram: 500, stockQuantity: 1, lastSyncedAt: '2026-08-30T10:00:00Z', isStale: true },
    }
    renderPopup(pin)
    expect(screen.getByTestId('pharmacy-pin-popup-stale')).toBeInTheDocument()
  })

  it('4. имя аптеки со спецсимволами (`<script>`) рендерится как текст, НЕ исполняется — защита от XSS', () => {
    const maliciousName = '<script>window.__xssFired = true</script>Аптека "Ромиш"'
    renderPopup({ ...basePin, name: maliciousName })

    // React рендерит children как текстовый DOM-узел: тег виден буквально в разметке как текст,
    // а не создаёт настоящий <script>-элемент — window.__xssFired никогда не будет выставлен.
    expect(screen.getByText(maliciousName)).toBeInTheDocument()
    expect(document.querySelector('script')).not.toBeInTheDocument()
    expect((window as { __xssFired?: boolean }).__xssFired).toBeUndefined()
  })

  it('5. offer=null — клик/наличие offer не подмешивает соседние поля (изоляция веток рендера)', () => {
    renderPopup({ ...basePin, is24x7: true })
    expect(screen.getByTestId('pharmacy-pin-popup-hours')).toBeInTheDocument()
    expect(screen.queryByTestId('pharmacy-pin-popup-price')).not.toBeInTheDocument()
  })

  it('6. isOpenNow=false, is24x7=false — ветка «сейчас закрыто» рендерится', () => {
    renderPopup({ ...basePin, isOpenNow: false, is24x7: false })
    expect(screen.getByTestId('pharmacy-pin-popup-hours')).toBeInTheDocument()
  })
})
