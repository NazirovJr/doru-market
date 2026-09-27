// DTJ-367: рядом с "Мои аптеки" (features/pharmacies-crud), но не импортирует её — горизонтальные импорты между фичами запрещены.
import { useEffect, useState, type ChangeEvent, type ReactElement } from 'react'
import { Button, Input, Select, Switch, type SelectOption } from '@dorutj/ui'
import { useT } from '@dorutj/i18n'
import type { PharmacyScheduleAndZoneDto } from '@dorutj/contracts'
import { useLocale } from '@/shared/config/locale-provider'
import {
  useOwnPharmacyOptions,
  usePharmacySchedule,
  useUpdateDeliveryZone,
  useUpdatePharmacySchedule,
} from '../api/use-pharmacy-schedule'

const TIME_HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/u
const MAX_DELIVERY_RADIUS_KM = 50

export const PharmacySchedulePage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const optionsQuery = useOwnPharmacyOptions()
  const [pharmacyId, setPharmacyId] = useState<string | null>(null)

  useEffect(() => {
    if (optionsQuery.data?.length === 1 && pharmacyId === null) {
      setPharmacyId(optionsQuery.data[0]?.id ?? null)
    }
  }, [optionsQuery.data, pharmacyId])

  return (
    <section data-testid="pharmacy-schedule-page">
      <h1>{t('admin.pharmacy_schedule.title')}</h1>
      {optionsQuery.isLoading ? <p role="status">{t('admin.pharmacy_schedule.loading')}</p> : null}
      {optionsQuery.error !== null ? <p role="alert">{t('admin.pharmacy_schedule.error')}</p> : null}
      {optionsQuery.data?.length === 0 ? <p>{t('admin.pharmacy_schedule.empty')}</p> : null}
      {optionsQuery.data !== undefined && optionsQuery.data.length > 1 ? (
        <Select
          label={t('admin.pharmacy_schedule.select_pharmacy.label')}
          placeholder={t('admin.pharmacy_schedule.select_pharmacy.placeholder')}
          value={pharmacyId}
          onChange={setPharmacyId}
          options={optionsQuery.data.map((p): SelectOption => ({ value: p.id, label: p.name }))}
        />
      ) : null}
      {pharmacyId !== null ? <PharmacyScheduleForm pharmacyId={pharmacyId} /> : null}
    </section>
  )
}

const PharmacyScheduleForm = ({ pharmacyId }: { readonly pharmacyId: string }): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const query = usePharmacySchedule(pharmacyId)

  if (query.isLoading) return <p role="status">{t('admin.pharmacy_schedule.loading')}</p>
  if (query.error !== null) return <p role="alert">{t('admin.pharmacy_schedule.error')}</p>
  if (query.data === undefined) return <></>

  return (
    <>
      <ScheduleSection pharmacyId={pharmacyId} current={query.data} />
      <DeliveryZoneSection pharmacyId={pharmacyId} current={query.data} />
    </>
  )
}

interface SectionProps {
  readonly pharmacyId: string
  readonly current: PharmacyScheduleAndZoneDto
}

const ScheduleSection = ({ pharmacyId, current }: SectionProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const mutation = useUpdatePharmacySchedule()
  const [isOpen247, setIsOpen247] = useState(current.isOpen247)
  const [openingTime, setOpeningTime] = useState(current.openingTime ?? '')
  const [closingTime, setClosingTime] = useState(current.closingTime ?? '')
  const timeInvalid = !isOpen247 && (!TIME_HH_MM_PATTERN.test(openingTime) || !TIME_HH_MM_PATTERN.test(closingTime))

  function handleSave(): void {
    if (timeInvalid) return
    mutation.mutate({
      pharmacyId,
      body: { isOpen247, openingTime: isOpen247 ? null : openingTime, closingTime: isOpen247 ? null : closingTime },
    })
  }

  return (
    <section data-testid="pharmacy-schedule-hours-section">
      <h2>{t('admin.pharmacy_schedule.section.hours')}</h2>
      <Switch label={t('admin.pharmacy_schedule.field.is_24_7')} checked={isOpen247} onChange={setIsOpen247} />
      {!isOpen247 ? (
        <>
          <Input
            type="time"
            label={t('admin.pharmacy_schedule.field.opening_time')}
            value={openingTime}
            onChange={(e: ChangeEvent<HTMLInputElement>) => { setOpeningTime(e.target.value) }}
          />
          <Input
            type="time"
            label={t('admin.pharmacy_schedule.field.closing_time')}
            value={closingTime}
            onChange={(e: ChangeEvent<HTMLInputElement>) => { setClosingTime(e.target.value) }}
          />
        </>
      ) : null}
      <Button type="button" onClick={handleSave} disabled={timeInvalid} loading={mutation.isPending}>
        {t('admin.pharmacy_schedule.action.save_schedule')}
      </Button>
      {mutation.isSuccess ? <p role="status">{t('admin.pharmacy_schedule.save_schedule.success')}</p> : null}
      {mutation.isError ? <p role="alert">{mutation.error.message}</p> : null}
    </section>
  )
}

const DeliveryZoneSection = ({ pharmacyId, current }: SectionProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const mutation = useUpdateDeliveryZone()
  const [radiusKm, setRadiusKm] = useState(String(current.maxDeliveryRadiusKm))
  const radiusValue = Number(radiusKm)
  const radiusInvalid = !Number.isFinite(radiusValue) || radiusValue <= 0 || radiusValue > MAX_DELIVERY_RADIUS_KM

  function handleSave(): void {
    if (radiusInvalid) return
    mutation.mutate({ pharmacyId, body: { maxDeliveryRadiusKm: radiusValue } })
  }

  return (
    <section data-testid="pharmacy-delivery-zone-section">
      <h2>{t('admin.pharmacy_schedule.section.delivery_zone')}</h2>
      <Input
        type="number"
        label={t('admin.pharmacy_schedule.field.max_delivery_radius_km')}
        value={radiusKm}
        onChange={(e: ChangeEvent<HTMLInputElement>) => { setRadiusKm(e.target.value) }}
        {...(radiusInvalid && { error: t('admin.pharmacy_schedule.field.max_delivery_radius_km.hint') })}
      />
      <p>{t('admin.pharmacy_schedule.field.max_delivery_radius_km.hint')}</p>
      <Button type="button" onClick={handleSave} disabled={radiusInvalid} loading={mutation.isPending}>
        {t('admin.pharmacy_schedule.action.save_delivery_zone')}
      </Button>
      {mutation.isSuccess ? <p role="status">{t('admin.pharmacy_schedule.save_delivery_zone.success')}</p> : null}
      {mutation.isError ? <p role="alert">{mutation.error.message}</p> : null}
    </section>
  )
}
