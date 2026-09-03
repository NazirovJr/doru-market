import type { ReactElement } from 'react'
import type { TranslateFunction } from '@dorutj/i18n'
import type { CheckoutFormState, CheckoutFormValidation } from '../model/checkout-form.model'

/**
 * `address-picker-section.tsx` (DTJ-235, «Что сделать» §3) — выбор адреса доставки: сохранённый
 * ИЛИ инлайн-ввод (карта-пикер + «Ориентир» + сетка подъезд/этаж/квартира).
 *
 * **Карта-пикер — временная заглушка.** Дизайн-референт (`.dc.html:895-897`) рисует iframe
 * `map-view.html?mode=picker`. Реальный `MapLibre GL JS`-компонент (`MapView`) существует, но
 * живёт в `features/pharmacy-map/ui/map-view.tsx` (DTJ-198/199, EP-08) — горизонтальный импорт
 * `checkout → pharmacy-map` запрещён `.dependency-cruiser.cjs` (`fe-features-are-isolated`,
 * тот же приём, что `checkout-cart.api.ts` не импортирует `features/cart`). Собственный JSDoc
 * `map-view.tsx` уже называет `checkout` будущим потребителем ПОСЛЕ переноса компонента в
 * `packages/ui` (DTJ-200, ещё не сделан) — ДО этого тикет прямо разрешает «допустима временная
 * заглушка того же контракта (`mode=picker`), если общий компонент ещё не готов» (риски DTJ-235).
 * `MapPickerStub` ниже — РЕАЛЬНЫЙ подключённый код (не мёртвая заглушка): клик реально пишет
 * координаты в состояние формы через `onPick`, просто без визуализации карты — тот же уровень
 * фикстуры, что дизайн-референт (демо-точка — центр Душанбе, `DEFAULT_MAP_CENTER` в
 * `pages/map/map-page.tsx`).
 *
 * **`savedAddresses` — пустой список в реальном рантайме.** Нет `GET`-эндпоинта списка
 * `user_addresses` нигде в `apps/api` (проверено: единственный порт —
 * `UserAddressFacadePort.getById`, DTJ-229, только чтение ПО ИЗВЕСТНОМУ id, не листинг) —
 * `checkout-screen.tsx` передаёт сюда `[]`. Секция «сохранённый адрес» рендерится ТОЛЬКО когда
 * список непуст (написанный, но сегодня недостижимый в реальном UI — тот же класс ограничения,
 * что «код без подключения», правило 2 AGENTS.md) — проп и ветка рендера остаются протестированными изолированно
 * (`address-picker-section.spec.tsx`, мок с непустым списком), реальная интеграция — follow-up,
 * когда владелец `/profile` (SRS-UX-050 таблица экранов, `30-ux-screens-and-flows.md:365`)
 * заведёт эндпоинт листинга. См. отчёт сдачи, ДОПУЩЕНИЯ.
 */

const DEMO_MAP_PICK = { latitude: 38.5598, longitude: 68.787 } // Душанбе — тот же дефолт, что map-page.tsx
const COORDINATE_DISPLAY_FRACTION_DIGITS = 4

export interface SavedAddressOption {
  readonly id: string
  readonly label: string
}

interface MapPickerStubProps {
  readonly latitude: number | null
  readonly longitude: number | null
  readonly onPick: (latitude: number, longitude: number) => void
  readonly t: TranslateFunction
}

const MapPickerStub = ({ latitude, longitude, onPick, t }: MapPickerStubProps): ReactElement => (
  <div
    className="mb-3 flex flex-col gap-2 rounded-md border border-dashed border-line p-3"
    data-testid="checkout-address-map-picker"
  >
    <span className="text-xs font-medium text-ink-muted">{t('checkout.address.map_picker_label')}</span>
    <p className="text-xs text-ink-muted" data-testid="checkout-address-map-picker-status">
      {latitude === null || longitude === null
        ? t('checkout.address.map_picker_not_selected')
        : t('checkout.address.map_picker_selected', {
            latitude: latitude.toFixed(COORDINATE_DISPLAY_FRACTION_DIGITS),
            longitude: longitude.toFixed(COORDINATE_DISPLAY_FRACTION_DIGITS),
          })}
    </p>
    <button
      type="button"
      data-testid="checkout-address-map-picker-button"
      onClick={() => { onPick(DEMO_MAP_PICK.latitude, DEMO_MAP_PICK.longitude) }}
      className="inline-flex min-h-12 w-fit items-center justify-center rounded-md border border-line px-3 text-sm font-semibold text-ink"
    >
      {t('checkout.address.map_picker_button')}
    </button>
  </div>
)

export interface AddressPickerSectionProps {
  readonly state: CheckoutFormState
  readonly validation: CheckoutFormValidation
  readonly savedAddresses: readonly SavedAddressOption[]
  readonly onSelectSavedAddress: (addressId: string) => void
  readonly onSwitchToInlineAddress: () => void
  readonly onAddressTextChange: (value: string) => void
  readonly onCoordinatesPick: (latitude: number, longitude: number) => void
  readonly onLandmarkChange: (value: string) => void
  readonly onEntranceChange: (value: string) => void
  readonly onFloorChange: (value: string) => void
  readonly onApartmentChange: (value: string) => void
  readonly t: TranslateFunction
}

const FIELD_INPUT_CLASS =
  'w-full rounded-md border border-line bg-surface p-3 text-sm text-ink placeholder:text-ink-muted'

export const AddressPickerSection = ({
  state,
  validation,
  savedAddresses,
  onSelectSavedAddress,
  onSwitchToInlineAddress,
  onAddressTextChange,
  onCoordinatesPick,
  onLandmarkChange,
  onEntranceChange,
  onFloorChange,
  onApartmentChange,
  t,
}: AddressPickerSectionProps): ReactElement => (
  <section data-testid="checkout-address-picker-section">
    <h2 className="mb-2 text-sm font-semibold text-ink">{t('checkout.address.title')}</h2>

    {savedAddresses.length === 0 ? null : (
      <div className="mb-3 flex flex-col gap-2" data-testid="checkout-address-saved-list">
        {savedAddresses.map((option) => (
          <button
            key={option.id}
            type="button"
            data-testid={`checkout-address-saved-option-${option.id}`}
            onClick={() => { onSelectSavedAddress(option.id) }}
            className={`min-h-12 rounded-md border p-3 text-left text-sm ${
              state.addressMode === 'saved' && state.savedAddressId === option.id
                ? 'border-brand-primary'
                : 'border-line'
            }`}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          data-testid="checkout-address-use-inline"
          onClick={onSwitchToInlineAddress}
          className="min-h-12 text-left text-sm font-semibold text-brand-primary"
        >
          {t('checkout.address.use_inline_toggle')}
        </button>
      </div>
    )}

    {state.addressMode === 'inline' ? (
      <div data-testid="checkout-address-inline-form">
        <label className="mb-1 block text-sm font-semibold text-ink" htmlFor="checkout-address-text">
          {t('checkout.address.text_label')}
        </label>
        <input
          id="checkout-address-text"
          data-testid="checkout-address-text-input"
          value={state.inlineAddress.addressText}
          onChange={(event) => { onAddressTextChange(event.target.value) }}
          placeholder={t('checkout.address.text_placeholder')}
          aria-invalid={validation.addressText !== undefined}
          className={`${FIELD_INPUT_CLASS} ${validation.addressText === undefined ? 'mb-3' : 'mb-1'}`}
        />
        {validation.addressText === undefined ? null : (
          <p role="alert" data-testid="checkout-address-text-error" className="mb-3 text-xs text-brand-danger">
            {t('checkout.address.error_text_required')}
          </p>
        )}

        <MapPickerStub
          latitude={state.inlineAddress.latitude}
          longitude={state.inlineAddress.longitude}
          onPick={onCoordinatesPick}
          t={t}
        />
        {validation.coordinates === undefined ? null : (
          <p role="alert" data-testid="checkout-address-coordinates-error" className="mb-3 -mt-2 text-xs text-brand-danger">
            {t('checkout.address.error_coordinates_required')}
          </p>
        )}

        <label className="mb-1 block text-sm font-semibold text-ink" htmlFor="checkout-address-landmark">
          {t('checkout.address.landmark_label')}
        </label>
        <input
          id="checkout-address-landmark"
          data-testid="checkout-address-landmark-input"
          value={state.landmark}
          onChange={(event) => { onLandmarkChange(event.target.value) }}
          placeholder={t('checkout.address.landmark_placeholder')}
          className={`${FIELD_INPUT_CLASS} mb-3`}
        />

        <div className="grid grid-cols-3 gap-2" data-testid="checkout-address-grid">
          <input
            data-testid="checkout-address-entrance-input"
            value={state.entrance}
            onChange={(event) => { onEntranceChange(event.target.value) }}
            placeholder={t('checkout.address.entrance_placeholder')}
            className={FIELD_INPUT_CLASS}
          />
          <input
            data-testid="checkout-address-floor-input"
            value={state.floor}
            onChange={(event) => { onFloorChange(event.target.value) }}
            placeholder={t('checkout.address.floor_placeholder')}
            className={FIELD_INPUT_CLASS}
          />
          <input
            data-testid="checkout-address-apartment-input"
            value={state.apartment}
            onChange={(event) => { onApartmentChange(event.target.value) }}
            placeholder={t('checkout.address.apartment_placeholder')}
            className={FIELD_INPUT_CLASS}
          />
        </div>
      </div>
    ) : null}
  </section>
)
