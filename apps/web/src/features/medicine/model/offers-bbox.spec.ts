import { describe, expect, it } from 'vitest'
import { buildOffersBbox } from './offers-bbox'

describe('buildOffersBbox', () => {
  it('без геолокации — рамка вокруг центра Душанбе', () => {
    expect(buildOffersBbox(null)).toEqual({ lonMin: 68.587, latMin: 38.4098, lonMax: 68.987, latMax: 38.7098 })
  })

  it('с геолокацией — рамка вокруг пользователя без артефактов float', () => {
    expect(buildOffersBbox({ lat: 40.284, lon: 69.62 })).toEqual({
      lonMin: 69.42,
      latMin: 40.134,
      lonMax: 69.82,
      latMax: 40.434,
    })
  })
})
