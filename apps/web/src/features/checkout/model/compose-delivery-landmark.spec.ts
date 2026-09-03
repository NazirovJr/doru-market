import { describe, expect, it, vi } from 'vitest'
import type { TranslateFunction } from '@dorutj/i18n'
import { composeDeliveryLandmark } from './compose-delivery-landmark'

const t: TranslateFunction = vi.fn((key: string) => {
  const labels: Record<string, string> = {
    'checkout.address.entrance_placeholder': 'Подъезд',
    'checkout.address.floor_placeholder': 'Этаж',
    'checkout.address.apartment_placeholder': 'Квартира',
  }
  return labels[key] ?? key
})

describe('composeDeliveryLandmark', () => {
  it('returns null when every field is empty', () => {
    expect(composeDeliveryLandmark({ landmark: '', entrance: '', floor: '', apartment: '' }, t)).toBeNull()
  })

  it('returns the landmark alone when entrance/floor/apartment are empty', () => {
    expect(composeDeliveryLandmark({ landmark: 'у мечети', entrance: '', floor: '', apartment: '' }, t)).toBe(
      'у мечети',
    )
  })

  it('combines landmark + entrance/floor/apartment as labeled, semicolon-separated parts', () => {
    expect(
      composeDeliveryLandmark({ landmark: 'у мечети', entrance: '2', floor: '5', apartment: '34' }, t),
    ).toBe('у мечети; Подъезд: 2; Этаж: 5; Квартира: 34')
  })

  it('omits an empty individual field (e.g. no apartment) but keeps the rest', () => {
    expect(composeDeliveryLandmark({ landmark: '', entrance: '2', floor: '5', apartment: '' }, t)).toBe(
      'Подъезд: 2; Этаж: 5',
    )
  })

  it('trims whitespace-only fields as empty', () => {
    expect(composeDeliveryLandmark({ landmark: '   ', entrance: '  ', floor: '', apartment: '' }, t)).toBeNull()
  })
})
