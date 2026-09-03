/**
 * Тест «фиксирует, что `tenantId` не опционален» (SRS-API-043, доработка по замечанию CTO):
 * «статический анализ не может проверить «есть ли `WHERE tenant_id=`» в SQL — эта гарантия
 * обеспечивается ОБЯЗАТЕЛЬНЫМ unit-тестом на каждый репозиторий («вызов без `tenantId` —
 * ошибка типов на этапе компиляции»)».
 *
 * Приём — тот же, что уже применён в этом модуле параллельным исполнителем
 * (`domain/order.entity.spec.ts` — «Инвариант типов: markPaidEscrow требует
 * ledgerHoldWillBeRecorded=true»): `@ts-expect-error` перед вызовом БЕЗ обязательного
 * параметра. Если кто-то в будущем случайно сделает `tenantId` опциональным — строка `@ts-
 * expect-error` перестанет подавлять реальную ошибку компиляции и САМА станет ошибкой
 * («Unused '@ts-expect-error' directive»), `tsc --noEmit`/`pnpm typecheck` покраснеет.
 *
 * Вызов — на РЕАЛЬНОМ экземпляре (`InMemoryCartRepository`, не `{} as CartRepository`):
 * `vitest`/esbuild не проверяют типы в рантайме, `@ts-expect-error` — чисто компиляторная
 * директива, поэтому метод в рантайме реально исполняется с недостающим аргументом
 * (`undefined`) — нужен настоящий, а не заглушечный объект, иначе тест падает с `TypeError:
 * ... is not a function`, а не проверяет то, что должен.
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { InMemoryCartRepository } from '@/modules/orders/testing/fixtures/in-memory-cart-repository.fixture.js'

describe('Тенант-изоляция: CartRepository требует tenantId первым параметром (SRS-API-043)', () => {
  it('findById — компилятор отклоняет вызов без tenantId', () => {
    const repo = new InMemoryCartRepository()
    // @ts-expect-error — tenantId обязателен первым параметром, не опционален (SRS-API-043).
    void repo.findById(randomUUID())
  })

  it('findItemsByCartId — компилятор отклоняет вызов без tenantId', () => {
    const repo = new InMemoryCartRepository()
    // @ts-expect-error — tenantId обязателен первым параметром, не опционален (SRS-API-043).
    void repo.findItemsByCartId(randomUUID())
  })

  it('upsertItem — компилятор отклоняет вызов без tenantId', () => {
    const repo = new InMemoryCartRepository()
    const input = { cartId: randomUUID(), medicineId: randomUUID(), pharmacyId: randomUUID(), quantityDelta: 1 }
    // `undefined` явно, не пропуск аргумента: пропуск сдвинул бы `input` в слот `tenantId` и
    // уронил бы этот тест TypeError'ом в рантайме esbuild/vitest (типы не проверяются) —
    // `undefined` тоже не проходит компиляцию (tenantId: string, не string | undefined),
    // но безопасен в рантайме.
    // @ts-expect-error — tenantId обязателен первым параметром, не опционален (SRS-API-043).
    void repo.upsertItem(undefined, input)
  })

  it('updateItemQuantity — компилятор отклоняет объект без поля tenantId', () => {
    const repo = new InMemoryCartRepository()
    // @ts-expect-error — tenantId обязателен полем входного объекта, не опционален (SRS-API-043).
    void repo.updateItemQuantity({ cartId: randomUUID(), cartItemId: randomUUID(), quantity: 1 })
  })

  it('deleteItem — компилятор отклоняет вызов без tenantId', () => {
    const repo = new InMemoryCartRepository()
    // @ts-expect-error — tenantId обязателен первым параметром, не опционален (SRS-API-043).
    void repo.deleteItem(randomUUID(), randomUUID())
  })

  it('санитарный кейс: полный вызов со всеми параметрами компилируется и исполняется без ошибок', async () => {
    const repo = new InMemoryCartRepository()
    await expect(repo.findById(randomUUID(), randomUUID())).resolves.toBeNull()
  })
})
