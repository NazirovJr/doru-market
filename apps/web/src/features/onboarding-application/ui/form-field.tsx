import type { ReactElement } from 'react'
import type { TranslateFunction } from '@dorutj/i18n'

/**
 * `form-field.tsx` (DTJ-076) — общие мелкие куски разметки формы (стиль инпута + локализованная
 * ошибка поля), вынесены из `pharmacy-application-form.tsx`, чтобы секции
 * (`legal-entity-section.tsx`/`pharmacy-details-section.tsx`) не дублировали классы Tailwind.
 */
export const inputClassName =
  'w-full min-h-12 rounded-md border border-line bg-surface p-3 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-primary'

export const FieldError = ({ shown, t }: { readonly shown: boolean; readonly t: TranslateFunction }): ReactElement | null =>
  shown ? (
    <p role="alert" className="mt-1 text-xs text-brand-danger">
      {t('onboarding.validation.required')}
    </p>
  ) : null
