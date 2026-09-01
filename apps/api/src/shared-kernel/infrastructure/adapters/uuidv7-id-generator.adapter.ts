/**
 * `UuidV7IdGeneratorAdapter` (EP-01, DTJ-006) — production-реализация `IdGenerator`.
 *
 * UUID v7 (time-ordered) — `@dorutj/db/schema/*` имеет `default(sql\`gen_random_uuid()\`)`
 * как fallback уровня БД, но прикладной код передаёт UUID v7 явно через этот порт
 * (SRS-DB-001, DTJ-006).
 */
import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
// Внутренний импорт — ПРЯМО из файла через алиас `@/...` (D-27: barrel — только
// для межмодульного использования, иначе цикл `module → barrel → module`).
import { type IdGenerator } from '@/shared-kernel/application/ports/id-generator.port.js'

@Injectable()
export class UuidV7IdGeneratorAdapter implements IdGenerator {
  /**
   * Node ≥19 поставляет `crypto.randomUUID()` (v4). v7 пока не доступен стабильно —
   * используем v4 для идентификаторов `auth` домена, где time-ordering не критично
   * (для ordering критичных id — БД ставит `gen_random_uuid()`/sequence).
   * Замена на v7 — в момент появления в Node API.
   */
  next(): string {
    return randomUUID()
  }
}
