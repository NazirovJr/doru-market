// Расширяет ImportMetaEnv из vite/client (уже подключён глобально через
// tsconfig.json#compilerOptions.types): без этого import.meta.env.VITE_API_BASE_URL типизируется
// как `any` (индексная сигнатура vite/client) и env.ts падает на @typescript-eslint/no-unsafe-*.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
}
