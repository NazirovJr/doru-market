/**
 * `offline-banner.spec.tsx` (DTJ-406, критерий приёмки 1, тест-план тикета).
 */
import { cleanup, render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { afterEach, describe, expect, it } from 'vitest'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { OfflineBanner } from './offline-banner'

afterEach(() => {
  cleanup()
})

const { t } = useT('ru')

describe('OfflineBanner — видимость (AC1)', () => {
  it('не рендерится, когда isOnline=true', () => {
    render(<OfflineBanner t={t} isOnline />)
    expect(screen.queryByTestId('dorutj-offline-banner')).not.toBeInTheDocument()
  })

  it('рендерится с ЕДИНСТВЕННЫМ фиксированным текстом ux.error.network_offline, когда isOnline=false', () => {
    render(<OfflineBanner t={t} isOnline={false} />)
    expect(screen.getByText(t('ux.error.network_offline'))).toBeInTheDocument()
  })
})

describe('OfflineBanner — НЕТ элемента закрытия ни при каком состоянии пропсов (критерий приёмки 1)', () => {
  it.each([{ compact: false }, { compact: true }])(
    'compact=%o — DOM не содержит button/[role=button]/[aria-label*=закр] (структурная проверка на ОТСУТСТВИЕ)',
    ({ compact }) => {
      const { container } = render(<OfflineBanner t={t} isOnline={false} compact={compact} />)
      expect(container.querySelectorAll('button')).toHaveLength(0)
      expect(container.querySelectorAll('[role="button"]')).toHaveLength(0)
      expect(container.querySelector('[aria-label]')).toBeNull()
    },
  )
})

describe('OfflineBanner — доступность', () => {
  it('role=status, aria-live=polite', () => {
    render(<OfflineBanner t={t} isOnline={false} />)
    const banner = screen.getByTestId('dorutj-offline-banner')
    expect(banner).toHaveAttribute('role', 'status')
    expect(banner).toHaveAttribute('aria-live', 'polite')
  })

  it('нулевые critical/serious нарушения доступности', async () => {
    const { axeResults } = await renderWithA11yCheck(<OfflineBanner t={t} isOnline={false} />)
    assertNoBlockingViolations(axeResults)
  })
})
