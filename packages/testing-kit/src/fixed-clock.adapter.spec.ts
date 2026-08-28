import { describe, expect, it } from 'vitest'
import { FixedClockAdapter } from './fixed-clock.adapter'
import { SequentialTestIdGenerator } from './sequential-test-id-generator'
import { FixedOtpGeneratorAdapter } from './fixed-otp-generator.adapter'

// SequentialTestIdGenerator и FixedOtpGeneratorAdapter не имеют отдельных *.spec.ts в
// files_owned этого тикета (DTJ-416) — тест-план явно допускает «тот же файл или отдельные
// *.spec.ts по решению разработчика», поэтому их тесты размещены здесь.

const DEFAULT_TEST_TIME = '2026-08-27T09:00:00.000Z'

describe('FixedClockAdapter', () => {
  it('returns configured default time when no initial time is given', () => {
    const clock = new FixedClockAdapter()

    expect(clock.now().toISOString()).toBe(DEFAULT_TEST_TIME)
  })

  it('returns the explicitly given initial time when one is provided', () => {
    const initial = new Date('2026-01-01T00:00:00.000Z')
    const clock = new FixedClockAdapter(initial)

    expect(clock.now().toISOString()).toBe(initial.toISOString())
  })

  it('advance moves internal clock forward by exact given minutes without real delay', () => {
    const clock = new FixedClockAdapter()
    const before = clock.now()
    const startedAt = Date.now()

    clock.advance(15)

    const elapsedRealMs = Date.now() - startedAt
    const diffMs = clock.now().getTime() - before.getTime()

    expect(diffMs).toBe(15 * 60_000)
    expect(elapsedRealMs).toBeLessThan(1000)
  })

  it('advance accumulates across multiple calls', () => {
    const clock = new FixedClockAdapter()

    clock.advance(10)
    clock.advance(5)

    expect(clock.now().toISOString()).toBe('2026-08-27T09:15:00.000Z')
  })

  it('reset restores clock to explicit timestamp', () => {
    const clock = new FixedClockAdapter()
    clock.advance(30)

    const target = new Date('2030-05-01T12:00:00.000Z')
    clock.reset(target)

    expect(clock.now().toISOString()).toBe(target.toISOString())
  })

  it('reset without argument restores clock to default timestamp', () => {
    const clock = new FixedClockAdapter()
    clock.advance(120)

    clock.reset()

    expect(clock.now().toISOString()).toBe(DEFAULT_TEST_TIME)
  })

  it('now() returns a new Date instance each call, not an internal mutable reference', () => {
    const clock = new FixedClockAdapter()
    const first = clock.now()
    first.setFullYear(1999)

    expect(clock.now().getFullYear()).not.toBe(1999)
  })
})

describe('SequentialTestIdGenerator', () => {
  it('returns predictable, zero-padded UUID-like strings starting from ...001', () => {
    const generator = new SequentialTestIdGenerator()

    expect(generator.next()).toBe('00000000-0000-0000-0000-000000000001')
  })

  it('two consecutive next() calls differ only in the last segment, both same length', () => {
    const generator = new SequentialTestIdGenerator()

    const first = generator.next()
    const second = generator.next()

    expect(second).toBe('00000000-0000-0000-0000-000000000002')
    expect(first.length).toBe(second.length)
    expect(first).not.toBe(second)
    expect(first.slice(0, first.length - 1)).toBe(second.slice(0, second.length - 1))
    expect(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(first)).toBe(true)
    expect(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(second)).toBe(true)
  })

  it('reset restores counter so the next id starts again from ...001', () => {
    const generator = new SequentialTestIdGenerator()
    generator.next()
    generator.next()

    generator.reset()

    expect(generator.next()).toBe('00000000-0000-0000-0000-000000000001')
  })
})

describe('FixedOtpGeneratorAdapter', () => {
  it('returns default login code when no options are given', () => {
    const otp = new FixedOtpGeneratorAdapter()

    expect(otp.generate('login')).toBe('483920')
  })

  it('returns default handover code when no options are given', () => {
    const otp = new FixedOtpGeneratorAdapter()

    expect(otp.generate('handover')).toBe('1234')
  })

  it('returns explicitly configured codes when options are provided', () => {
    const otp = new FixedOtpGeneratorAdapter({ loginCode: '111111', handoverCode: '9999' })

    expect(otp.generate('login')).toBe('111111')
    expect(otp.generate('handover')).toBe('9999')
  })

  it('generate() is deterministic across repeated calls for the same purpose', () => {
    const otp = new FixedOtpGeneratorAdapter()

    expect(otp.generate('login')).toBe(otp.generate('login'))
  })
})
