import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { AnalogsBlock } from './analogs-block'
import type { AnalogsDataDto } from '../api/use-analogs-query'

/**
 * `analogs-block.spec.tsx` (DTJ-104, `TC-CAT-013..016`).
 *
 * Сеть мокается напрямую через `fetch` (тот же приём, что `pages/map/map-page.spec.tsx` —
 * страницы/блоки этого приложения тестируются как интеграция со `shared/api/http-client`, не
 * через `vi.mock` хука).
 */

const MEDICINE_ID = '11111111-1111-1111-1111-111111111111'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderBlock(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <AnalogsBlock medicineId={MEDICINE_ID} />
      </LocaleProvider>
    </QueryClientProvider>,
  )
}

const rxOffer = {
  pharmacyId: '33333333-3333-3333-3333-333333333333',
  priceDiram: 1800,
  distanceMeters: null,
  isStale: false,
  lastSyncedAt: null,
}

function buildData(overrides: Partial<AnalogsDataDto> = {}): AnalogsDataDto {
  return {
    referenceMedicineId: MEDICINE_ID,
    items: [],
    savingsDiram: null,
    titleKey: 'catalog.analogs.title_neutral',
    disclaimer: 'Это не медицинская рекомендация. Проконсультируйтесь с фармацевтом.',
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('AnalogsBlock (DTJ-104)', () => {
  it('1. TC-CAT-013: savingsDiram=6500 — плашка экономии рендерится с ТОЧНЫМ форматированием (без округления, дефолтная локаль tj)', async () => {
    // Ожидание — ЗАПЯТАЯ ("65,00"), не точка буквального примера AC тикета ("Сэкономьте 65.00
    // сомони"): под дефолтной локалью 'tj' (→ реальный BCP-47 'tg') И Node, И реальный Chromium
    // (проверено вручную Browser-инструментом на живом /medicines/:id при сдаче DTJ-104) дают
    // запятую — см. JSDoc `model/format-savings.ts` и раздел DISPUTED отчёта сдачи. Числовая суть
    // TC-CAT-013 («точное форматирование, без округления») соблюдена — это и проверяется здесь.
    const data = buildData({
      titleKey: 'catalog.analogs.title_savings',
      savingsDiram: 6500,
      items: [{ medicineId: 'a1', tradeName: 'Аналог', manufacturerName: 'Завод', cheapestOffer: rxOffer, isPrescriptionRequired: false }],
    })
    stubFetch(() => Promise.resolve(jsonResponse({ data })))

    renderBlock()

    await waitFor(() => {
      expect(screen.getByTestId('analogs-savings-banner')).toHaveTextContent('65,00 сомонӣ сарфа кунед')
    })
  })

  it('2. TC-CAT-014: titleKey=title_neutral (savings отсутствует) — SavingsBanner НЕ рендерится, нейтральный заголовок и список аналогов присутствуют', async () => {
    const data = buildData({
      titleKey: 'catalog.analogs.title_neutral',
      savingsDiram: null,
      items: [{ medicineId: 'a1', tradeName: 'Аналог', manufacturerName: 'Завод', cheapestOffer: rxOffer, isPrescriptionRequired: false }],
    })
    stubFetch(() => Promise.resolve(jsonResponse({ data })))

    renderBlock()

    await waitFor(() => {
      expect(screen.getByTestId('analogs-block-neutral-title')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('analogs-savings-banner')).not.toBeInTheDocument()
    expect(screen.getByTestId('analogs-block-list')).toBeInTheDocument()
    expect(screen.getAllByTestId('analog-card')).toHaveLength(1)
  })

  it('3a. TC-CAT-015: дисклеймер в DOM когда плашка экономии ЕСТЬ', async () => {
    const data = buildData({
      titleKey: 'catalog.analogs.title_savings',
      savingsDiram: 6500,
      disclaimer: 'ДИСКЛЕЙМЕР-А',
      items: [{ medicineId: 'a1', tradeName: 'X', manufacturerName: 'Y', cheapestOffer: rxOffer, isPrescriptionRequired: false }],
    })
    stubFetch(() => Promise.resolve(jsonResponse({ data })))

    renderBlock()

    await waitFor(() => {
      expect(screen.getByTestId('analogs-disclaimer')).toHaveTextContent('ДИСКЛЕЙМЕР-А')
    })
    expect(screen.getByTestId('analogs-savings-banner')).toBeInTheDocument()
  })

  it('3b. TC-CAT-015: дисклеймер в DOM когда плашки экономии НЕТ (нейтральный заголовок)', async () => {
    const data = buildData({
      titleKey: 'catalog.analogs.title_neutral',
      savingsDiram: null,
      disclaimer: 'ДИСКЛЕЙМЕР-Б',
      items: [{ medicineId: 'a1', tradeName: 'X', manufacturerName: 'Y', cheapestOffer: rxOffer, isPrescriptionRequired: false }],
    })
    stubFetch(() => Promise.resolve(jsonResponse({ data })))

    renderBlock()

    await waitFor(() => {
      expect(screen.getByTestId('analogs-disclaimer')).toHaveTextContent('ДИСКЛЕЙМЕР-Б')
    })
    expect(screen.queryByTestId('analogs-savings-banner')).not.toBeInTheDocument()
  })

  it('3c. TC-CAT-015 (расширено указанием CTO): дисклеймер в DOM даже при ПУСТОМ items — блок не скрывается целиком', async () => {
    const data = buildData({ titleKey: 'catalog.analogs.title_neutral', savingsDiram: null, disclaimer: 'ДИСКЛЕЙМЕР-В', items: [] })
    stubFetch(() => Promise.resolve(jsonResponse({ data })))

    renderBlock()

    await waitFor(() => {
      expect(screen.getByTestId('analogs-disclaimer')).toHaveTextContent('ДИСКЛЕЙМЕР-В')
    })
    expect(screen.getByTestId('analogs-block')).toBeInTheDocument()
    expect(screen.queryByTestId('analogs-block-list')).not.toBeInTheDocument()
  })

  it('4. TC-CAT-016: смешанный список (Rx + OTC) — Rx-бейдж только у Rx-карточки', async () => {
    const data = buildData({
      titleKey: 'catalog.analogs.title_neutral',
      savingsDiram: null,
      items: [
        { medicineId: 'otc-1', tradeName: 'OTC-товар', manufacturerName: 'Завод А', cheapestOffer: rxOffer, isPrescriptionRequired: false },
        { medicineId: 'rx-1', tradeName: 'Rx-товар', manufacturerName: 'Завод Б', cheapestOffer: rxOffer, isPrescriptionRequired: true },
      ],
    })
    stubFetch(() => Promise.resolve(jsonResponse({ data })))

    renderBlock()

    await waitFor(() => {
      expect(screen.getAllByTestId('analog-card')).toHaveLength(2)
    })
    const badges = screen.getAllByTestId('analog-card-rx-badge')
    expect(badges).toHaveLength(1)
    const cards = screen.getAllByTestId('analog-card')
    const rxCard = cards.find((card) => card.getAttribute('data-medicine-id') === 'rx-1')
    const otcCard = cards.find((card) => card.getAttribute('data-medicine-id') === 'otc-1')
    expect(rxCard?.querySelector('[data-testid="analog-card-rx-badge"]')).not.toBeNull()
    expect(otcCard?.querySelector('[data-testid="analog-card-rx-badge"]')).toBeNull()
  })

  it('5. загрузка — рендерится скелетон (форма карточки), не блок и не белый экран', () => {
    stubFetch(() => new Promise<Response>(() => undefined))

    renderBlock()

    expect(screen.getByTestId('analogs-block-skeleton')).toBeInTheDocument()
    expect(screen.getAllByTestId('analog-card-skeleton')).toHaveLength(3)
    expect(screen.queryByTestId('analogs-block')).not.toBeInTheDocument()
  })

  it('6. сетевая ошибка — блок скрывается целиком (деградация без блокировки карточки товара)', async () => {
    stubFetch(() => Promise.reject(new TypeError('network down')))
    const { container } = renderBlock()

    await waitFor(() => {
      expect(screen.queryByTestId('analogs-block-skeleton')).not.toBeInTheDocument()
    })
    expect(screen.queryByTestId('analogs-block')).not.toBeInTheDocument()
    expect(screen.queryByTestId('analogs-disclaimer')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('7. 404 (медикамент не найден) — блок скрывается целиком, не бросает наружу', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND' } }, 404)))
    renderBlock()

    await waitFor(() => {
      expect(screen.queryByTestId('analogs-block-skeleton')).not.toBeInTheDocument()
    })
    expect(screen.queryByTestId('analogs-block')).not.toBeInTheDocument()
  })
})
