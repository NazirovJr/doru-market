/**
 * `badge.spec.tsx` (DTJ-404, тест-план тикета).
 */
import { type ReactElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { Badge, type BadgeTone } from './badge'

afterEach(() => {
  cleanup()
})

/**
 * Никогда не вызывается в рантайме — существует только для `tsc --noEmit`: `children` обязателен
 * на уровне типов, `Badge` без текста не компилируется (тест-план: «TS или рантайм-проверка»).
 */
function _typeOnlyChildrenIsRequired(): ReactElement {
  // @ts-expect-error -- children (текст статуса) обязателен: статус не передаётся только цветом.
  return <Badge tone="success" />
}
// Ссылка на функцию (без вызова) — только чтобы `tsc --noEmit` не считал её "unused" (noUnusedLocals).
void _typeOnlyChildrenIsRequired

const TONES: readonly BadgeTone[] = ['success', 'danger', 'warning', 'neutral']

describe('Badge — текст обязателен (SRS-UX-019/034)', () => {
  it.each(TONES)('рендерит переданный текст для tone=%s (статус не передаётся только цветом)', (tone) => {
    render(<Badge tone={tone}>Оплачено</Badge>)
    expect(screen.getByText('Оплачено')).toBeInTheDocument()
  })

  it('дефолтный tone — neutral, если не передан', () => {
    render(<Badge>Новый</Badge>)
    expect(screen.getByText('Новый')).toBeInTheDocument()
  })

  it.each(TONES)('нулевые critical/serious нарушения доступности для tone=%s', async (tone) => {
    const { axeResults } = await renderWithA11yCheck(<Badge tone={tone}>Оплачено</Badge>)
    assertNoBlockingViolations(axeResults)
  })
})
