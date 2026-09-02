/**
 * `MedicineSuggestQuerySchema` (DTJ-190, EP-06, R1) — query-контракт
 * `GET /api/v1/medicines/suggest?q=<text>&limit=10` (`SRS-CAT-027`).
 *
 * **Почему схема живёт здесь, а не в `packages/contracts/src/search.ts`.** `search.ts`
 * (DTJ-180) объявляет `SearchQuerySchema`/`SearchResultPageSchema`/`SuggestItemSchema`, но НЕ
 * query-схему для `/suggest` — файл вне `files_owned` DTJ-190 (зона тикета — только
 * `presentation/`). Схема здесь — тонкая, специфичная для этого HTTP-эндпоинта (не переиспользуется
 * ничем другим), поэтому локальное определение не дублирует существующий контракт (Ж12) —
 * просто заполняет пробел, оставленный DTJ-180.
 *
 * `q` НЕ имеет минимальной длины и НЕ отклоняется как ошибка при пустой строке —
 * `SRS-CAT-030` явно определяет пустой `q` как валидный вход (серверный trending-фолбэк),
 * не `400`.
 */
import { z } from 'zod'

/** SRS-CAT-027: `?limit=10` — дефолт автодополнения (отдельный от общего `limit=20`, SRS-API-004). */
const SUGGEST_DEFAULT_LIMIT = 10
/**
 * Явный потолок клиентского `limit` — в SRS не задан числом (только «финальный LIMIT 10» как
 * внутренний шаг SQL-алгоритма, `SRS-CAT-029`, НЕ подтверждённый как клиентский параметр).
 * ASSUMPTION: тот же потолок, что жёсткий cap списковых эндпоинтов (`MAX_LIMIT`,
 * `packages/contracts/src/pagination.ts`) — единообразно с остальным API, без изобретения
 * нового числа без опоры на SRS.
 */
const SUGGEST_MAX_LIMIT = 100

export const MedicineSuggestQuerySchema = z.object({
  q: z.string().optional().default(''),
  limit: z.coerce.number().int().positive().max(SUGGEST_MAX_LIMIT).optional().default(SUGGEST_DEFAULT_LIMIT),
})

export type MedicineSuggestQueryDto = z.infer<typeof MedicineSuggestQuerySchema>
