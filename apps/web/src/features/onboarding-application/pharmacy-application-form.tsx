/**
 * `PharmacyApplicationForm` (DTJ-076) — единая длинная форма заявки аптеки/сети.
 * Клиентская валидация ПЕРЕИСПОЛЬЗУЕТ zod-схемы из `@dorutj/contracts` —
 * единый источник истины на границе API.
 *
 * Поля соответствуют `SubmitChainApplicationRequestSchema` (юрлицо) +
 * `SubmitPharmacyApplicationRequestSchema` (точка). Условное
 * `isWhitelabelRequested=true` требует `legalAddress`.
 */
import { useCallback, useState, type ReactElement, type SyntheticEvent } from 'react'
import { useNavigate } from 'react-router'
import {
  SubmitChainApplicationRequestSchema,
  SubmitPharmacyApplicationRequestSchema,
  type SubmitChainApplicationRequest,
  type SubmitPharmacyApplicationRequest,
} from '@dorutj/contracts'
import type { ZodError } from 'zod'
import { httpRequest } from '@/shared/api/http-client'

interface FormState {
  legalEntityName: string
  tinInn: string
  directorFullName: string
  contactPhone: string
  legalAddress: string
  isWhitelabelRequested: boolean
  name: string
  addressText: string
  latitude: string
  longitude: string
  licenseNumber: string
  licenseExpiryDate: string
  pharmacistInChargeName: string
}

const INITIAL_STATE: FormState = {
  legalEntityName: '',
  tinInn: '',
  directorFullName: '',
  contactPhone: '',
  legalAddress: '',
  isWhitelabelRequested: false,
  name: '',
  addressText: '',
  latitude: '38.5598',
  longitude: '68.7870',
  licenseNumber: '',
  licenseExpiryDate: '',
  pharmacistInChargeName: '',
}

export const PharmacyApplicationForm = (): ReactElement => {
  const [state, setState] = useState<FormState>(INITIAL_STATE)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successId, setSuccessId] = useState<string | null>(null)
  const navigate = useNavigate()

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setState((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = useCallback(
    async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault()
      if (submitting) {
        return
      }
      setSubmitting(true)
      setError(null)
      try {
        const result = await submitApplication(state)
        if (result.kind === 'ok') {
          setSuccessId(result.pharmacyId)
        } else {
          setError(result.message)
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Неизвестная ошибка')
      } finally {
        setSubmitting(false)
      }
    },
    [state, submitting],
  )

  if (successId !== null) {
    return <SuccessPanel id={successId} onHome={() => { void navigate('/') }} />
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e)
      }}
      className="pharmacy-application-form"
      data-testid="pharmacy-application-form"
    >
      <h1>Подать заявку</h1>
      <WhitelabelField state={state} update={update} />
      <fieldset>
        <legend>Контакт</legend>
        <FieldInput
          label="Телефон*"
          type="tel"
          value={state.contactPhone}
          onChange={(v) => { update('contactPhone', v) }}
        />
      </fieldset>
      <fieldset>
        <legend>Точка</legend>
        <FieldInput label="Название*" value={state.name} onChange={(v) => { update('name', v) }} />
        <FieldInput label="Адрес*" value={state.addressText} onChange={(v) => { update('addressText', v) }} />
        <FieldInput
          label="Номер лицензии*"
          value={state.licenseNumber}
          onChange={(v) => { update('licenseNumber', v) }}
        />
        <FieldInput
          label="Срок лицензии*"
          type="date"
          value={state.licenseExpiryDate}
          onChange={(v) => { update('licenseExpiryDate', v) }}
        />
      </fieldset>
      {error !== null ? (
        <p role="alert" data-testid="pharmacy-application-error">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={submitting} data-testid="pharmacy-application-submit">
        {submitting ? 'Отправка...' : 'Отправить заявку'}
      </button>
    </form>
  )
}

const WhitelabelField = ({
  state,
  update,
}: {
  state: FormState
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void
}): ReactElement | null =>
  state.isWhitelabelRequested ? (
    <fieldset>
      <legend>Юридическое лицо</legend>
      <FieldInput
        label="Юр. адрес*"
        value={state.legalAddress}
        onChange={(v) => { update('legalAddress', v) }}
      />
    </fieldset>
  ) : null

const FieldInput = ({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'tel' | 'date'
}): ReactElement => (
  <label>
    {label}
    <input
      type={type}
      value={value}
      required
      onChange={(e) => { onChange(e.target.value) }}
    />
  </label>
)

const SuccessPanel = ({ id, onHome }: { id: string; onHome: () => void }): ReactElement => (
  <section className="pharmacy-application-success" data-testid="pharmacy-application-success">
    <h1>Заявка #{id} отправлена</h1>
    <p>Рассмотрение занимает до 2 рабочих дней. Ожидайте уведомления.</p>
    <button type="button" onClick={onHome}>
      На главную
    </button>
  </section>
)

type SubmitResult = { kind: 'ok'; pharmacyId: string } | { kind: 'error'; message: string }

async function submitApplication(state: FormState): Promise<SubmitResult> {
  const chainPayload: SubmitChainApplicationRequest = {
    legalEntityName: state.legalEntityName,
    tinInn: state.tinInn,
    directorFullName: state.directorFullName,
    contactPhone: state.contactPhone,
    legalAddress: state.legalAddress.length > 0 ? state.legalAddress : null,
    isWhitelabelRequested: state.isWhitelabelRequested,
  }
  const chainParsed = SubmitChainApplicationRequestSchema.safeParse(chainPayload)
  if (!chainParsed.success) {
    return { kind: 'error', message: formatZodError(chainParsed.error) }
  }
  const chainId = await postJson<{ id: string }>('/api/v1/pharmacy-chains', chainParsed.data)
  if (chainId.kind === 'error') {
    return chainId
  }
  const pharmacyPayload: SubmitPharmacyApplicationRequest = {
    chainId: chainId.value.id,
    name: state.name,
    addressText: state.addressText,
    latitude: Number.parseFloat(state.latitude),
    longitude: Number.parseFloat(state.longitude),
    phone: state.contactPhone,
    isOpen247: false,
    licenseNumber: state.licenseNumber,
    licenseExpiryDate: state.licenseExpiryDate,
    pharmacistInChargeName: state.pharmacistInChargeName,
  }
  const pharmacyParsed = SubmitPharmacyApplicationRequestSchema.safeParse(pharmacyPayload)
  if (!pharmacyParsed.success) {
    return { kind: 'error', message: formatZodError(pharmacyParsed.error) }
  }
  const pharmacyId = await postJson<{ id: string }>('/api/v1/pharmacy-accounts', pharmacyParsed.data)
  if (pharmacyId.kind === 'error') {
    return pharmacyId
  }
  const submit = await postJson<unknown>(
    `/api/v1/pharmacy-accounts/${pharmacyId.value.id}/submit`,
    {},
  )
  if (submit.kind === 'error') {
    return { kind: 'error', message: `Заявка создана, но submit провалился: ${submit.message}` }
  }
  return { kind: 'ok', pharmacyId: pharmacyId.value.id }
}

type ApiResult<T> = { kind: 'ok'; value: T } | { kind: 'error'; message: string }

async function postJson<T>(path: string, payload: unknown): Promise<ApiResult<T>> {
  const res = await httpRequest(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    return { kind: 'error', message: String(res.status) }
  }
  const body = (await res.json()) as { data: T }
  return { kind: 'ok', value: body.data }
}

function formatZodError(error: ZodError): string {
  return error.issues.map((it) => `${it.path.join('.')}: ${it.message}`).join('; ')
}
