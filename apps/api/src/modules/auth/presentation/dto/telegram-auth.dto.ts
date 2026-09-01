/**
 * Zod-схема `telegram-auth.dto.ts` (EP-01, DTJ-027, SRS-API-031).
 *
 * Контракт: `{ initData: string }` — сырая строка из `window.Telegram.WebApp.initData`.
 *
 * ВАЖНО: `initData` — это ЗАКОДИРОВАННАЯ строка (Telegram сам URL-кодирует
 * пары внутри). Контроллер передаёт её в `TelegramInitDataVerifier.verify`
 * as-is, без двойного кодирования/декодирования.
 *
 * Валидация ЗДЕСЬ — только structural (непустая строка). Семантическая
 * проверка (подпись, auth_date) — в адаптере.
 */
import { z } from 'zod'

export const telegramAuthDtoSchema = z.object({
  initData: z.string().min(1, 'initData is required'),
})

export type TelegramAuthDto = z.infer<typeof telegramAuthDtoSchema>
