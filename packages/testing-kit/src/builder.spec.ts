import { describe, expect, it } from 'vitest'
import { createBuilder } from './builder'

interface TestFixture {
  status: string
  amount: number
}

describe('createBuilder', () => {
  it('build() with no overrides returns exact defaults', () => {
    const defaults: TestFixture = { status: 'pending', amount: 100 }
    const factory = createBuilder(defaults)

    expect(factory.create().build()).toEqual({ status: 'pending', amount: 100 })
  })

  it('build() with partial overrides merges shallowly, keeping other defaults intact', () => {
    const factory = createBuilder<TestFixture>({ status: 'pending', amount: 100 })

    const result = factory.create({ status: 'paid' }).build()

    expect(result).toEqual({ status: 'paid', amount: 100 })
  })

  it('does not mutate the original defaults object across multiple create() calls', () => {
    const defaults: TestFixture = { status: 'pending', amount: 100 }
    const factory = createBuilder(defaults)

    factory.create({ status: 'paid' }).build()
    factory.create({ amount: 250 }).build()

    expect(defaults).toEqual({ status: 'pending', amount: 100 })
  })

  it('each create() call is independent — overrides from one do not leak into another', () => {
    const factory = createBuilder<TestFixture>({ status: 'pending', amount: 100 })

    const first = factory.create({ status: 'paid' })
    const second = factory.create({ amount: 500 })

    expect(first.build()).toEqual({ status: 'paid', amount: 100 })
    expect(second.build()).toEqual({ status: 'pending', amount: 500 })
  })

  it('build() can be called multiple times returning equal, independent objects', () => {
    const factory = createBuilder<TestFixture>({ status: 'pending', amount: 100 })
    const builder = factory.create({ status: 'paid' })

    const first = builder.build()
    const second = builder.build()

    expect(first).toEqual(second)
    expect(first).not.toBe(second)
  })
})
