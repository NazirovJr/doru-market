/**
 * Unit-тесты хелперов `cash-commission-aggregation.util.ts` (DTJ-251) — TZ-арифметика
 * Asia/Dushanbe (фиксированный UTC+5, см. JSDoc файла) и детерминированный ключ
 * идемпотентности. Ожидаемые значения выведены вручную (Dushanbe = UTC+5, без DST) и
 * независимо перепроверены прогоном реализации — не «похоже на правильное».
 */
import { describe, expect, it } from 'vitest'
import { addDays, deterministicEventId, startOfDushanbeDay, startOfDushanbeWeek, toDushanbeYYMMDD } from './cash-commission-aggregation.util.js'

describe('toDushanbeYYMMDD (DTJ-251)', () => {
  it('инстант в пределах Dushanbe-суток (12:00 UTC = 17:00 Dushanbe, тот же календарный день)', () => {
    expect(toDushanbeYYMMDD(new Date('2026-01-15T12:00:00Z'))).toBe('260115')
  })

  it('инстант, пересекающий полночь Dushanbe (20:00 UTC предыдущих суток = 01:00 Dushanbe следующего дня)', () => {
    expect(toDushanbeYYMMDD(new Date('2026-01-14T20:00:00Z'))).toBe('260115')
  })
})

describe('startOfDushanbeDay (DTJ-251)', () => {
  it('произвольный инстант дня → полночь Dushanbe ТОГО ЖЕ календарного дня (UTC на 5ч раньше)', () => {
    expect(startOfDushanbeDay(new Date('2026-01-15T12:00:00Z'))).toEqual(new Date('2026-01-14T19:00:00.000Z'))
  })

  it('инстант ТОЧНО равен границе полуночи Dushanbe → возвращает себя же (идемпотентно на границе)', () => {
    const boundary = new Date('2026-01-14T19:00:00.000Z')
    expect(startOfDushanbeDay(boundary)).toEqual(boundary)
  })

  it('на 1мс РАНЬШЕ границы полуночи → предыдущие сутки Dushanbe (граница переходит корректно)', () => {
    expect(startOfDushanbeDay(new Date('2026-01-14T18:59:59.999Z'))).toEqual(new Date('2026-01-13T19:00:00.000Z'))
  })
})

describe('startOfDushanbeWeek (DTJ-251, ISO-неделя Пн..Вс)', () => {
  // 2026-01-05 (UTC) — реальный понедельник (проверено Date.UTC(2026,0,5).getUTCDay()===1).
  const MONDAY_START = new Date('2026-01-04T19:00:00.000Z') // понедельник 00:00 Dushanbe = Date.UTC(2026,0,5) - 5ч

  it('среда той же недели → возвращает понедельник 00:00 Dushanbe', () => {
    expect(startOfDushanbeWeek(new Date('2026-01-07T10:00:00Z'))).toEqual(MONDAY_START)
  })

  it('воскресенье (ПОСЛЕДНИЙ день ТОЙ ЖЕ недели) → ТОТ ЖЕ понедельник, не следующий', () => {
    expect(startOfDushanbeWeek(new Date('2026-01-11T05:00:00Z'))).toEqual(MONDAY_START)
  })

  it('инстант ТОЧНО равен границе начала недели → возвращает себя же', () => {
    expect(startOfDushanbeWeek(MONDAY_START)).toEqual(MONDAY_START)
  })

  it('на 1мс РАНЬШЕ границы начала недели → ПРЕДЫДУЩАЯ неделя (граница переходит корректно)', () => {
    expect(startOfDushanbeWeek(new Date('2026-01-04T18:59:59.999Z'))).toEqual(new Date('2025-12-28T19:00:00.000Z'))
  })

  it('сам понедельник, любое время суток Dushanbe → возвращает начало ЭТОГО дня', () => {
    expect(startOfDushanbeWeek(new Date('2026-01-05T00:30:00Z'))).toEqual(MONDAY_START)
  })
})

describe('addDays (DTJ-251)', () => {
  it('положительное смещение — период_end = period_start + 7 дней (AC1/DoD тикета)', () => {
    expect(addDays(new Date('2026-01-05T19:00:00Z'), 7)).toEqual(new Date('2026-01-12T19:00:00.000Z'))
  })

  it('отрицательное смещение — since = today - 1 (диапазон [вчера,сегодня) ежедневной агрегации)', () => {
    expect(addDays(new Date('2026-01-05T19:00:00Z'), -1)).toEqual(new Date('2026-01-04T19:00:00.000Z'))
  })
})

describe('deterministicEventId (DTJ-251, идемпотентность AC2)', () => {
  it('одинаковые части → одинаковый ID (детерминированность — основа идемпотентности повторного прогона)', () => {
    expect(deterministicEventId('cash-commission-aggregation', 'chain-1', '260904')).toBe(
      deterministicEventId('cash-commission-aggregation', 'chain-1', '260904'),
    )
  })

  it('разные части (другая сеть) → разный ID', () => {
    expect(deterministicEventId('cash-commission-aggregation', 'chain-1', '260904')).not.toBe(
      deterministicEventId('cash-commission-aggregation', 'chain-2', '260904'),
    )
  })

  it('разные части (другая дата) → разный ID', () => {
    expect(deterministicEventId('cash-commission-aggregation', 'chain-1', '260904')).not.toBe(
      deterministicEventId('cash-commission-aggregation', 'chain-1', '260905'),
    )
  })

  it('форма — валидный UUID-паттерн (8-4-4-4-12 hex), совместимый с колонкой processed_events.event_id uuid', () => {
    expect(deterministicEventId('a', 'b', 'c')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})
