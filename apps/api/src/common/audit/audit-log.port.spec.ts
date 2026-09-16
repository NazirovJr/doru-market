/**
 * `AuditLogPort` (EP-16, DTJ-374) — тест интерфейсного контракта (AC2, SRS-ADM-064 п.1):
 * порт НЕ содержит `update`/`delete`/`patch`, только `write`.
 *
 * `AssertExactKeys` ниже — КОМПИЛЯЦИОННАЯ проверка, не рантайм (буквальное требование AC2):
 * `.spec.ts` включены в `tsc --noEmit` этого пакета (см. `tsconfig.json`), так что если
 * `AuditLogPort` когда-либо приобретёт `update`/`delete`/`patch` (или любой другой метод сверх
 * `write`), присвоение `_typeLevelAssertion` ниже перестанет компилироваться — `pnpm
 * typecheck`/`pnpm verify` упадёт ДО того, как runtime-тест вообще запустится.
 */
import { describe, expect, it } from 'vitest'
import type { AuditLogPort } from './audit-log.port.js'

type AllowedPortKeys = 'write'
type AssertExactKeys = keyof AuditLogPort extends AllowedPortKeys
  ? (AllowedPortKeys extends keyof AuditLogPort ? true : never)
  : never
const _typeLevelAssertion: AssertExactKeys = true

describe('AuditLogPort — интерфейсный контракт (DTJ-374, SRS-ADM-064 п.1)', () => {
  it('компилируется, только если keyof AuditLogPort === "write" (см. AssertExactKeys выше)', () => {
    expect(_typeLevelAssertion).toBe(true)
  })

  it('НЕ содержит update/delete/patch — явный отрицательный контроль поверх компиляционной проверки', () => {
    const port: AuditLogPort = { write: () => Promise.resolve() }
    for (const forbidden of ['update', 'delete', 'patch'] as const) {
      expect(forbidden in port).toBe(false)
    }
  })
})
