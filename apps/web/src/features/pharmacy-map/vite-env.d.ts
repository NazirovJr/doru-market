// Расширяет ImportMetaEnv для VITE_TILESERVER_URL (DTJ-198, SRS-CAT-053): без объявления здесь
// свойство типизировалось бы как `any` (индексная сигнатура vite/client) и падало бы на
// @typescript-eslint/no-unsafe-* в map-view.tsx — тот же приём, что и в
// apps/web/src/shared/config/vite-env.d.ts для VITE_API_BASE_URL.
//
// Отдельный файл в features/pharmacy-map, а не правка shared/config/vite-env.d.ts: тот файл
// принадлежит DTJ-003 и не входит в files_owned этого тикета (AGENTS.md §7). Опционален (`?`) —
// в отличие от VITE_API_BASE_URL, отсутствие self-hosted tileserver (EP-19, вне scope) не должно
// ронять сборку — критерий приёмки 5 требует фолбэк, не падение.
interface ImportMetaEnv {
  readonly VITE_TILESERVER_URL?: string
}
