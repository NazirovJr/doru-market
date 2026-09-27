import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'

/**
 * Библиотечная сборка `packages/ui` (DTJ-400, дополнено DTJ-404).
 *
 * Три точки входа — по одной на каждый путь `exports` в `package.json` (D-27 barrel):
 * `.` → `dist/index.js`, `./tokens` → `dist/tokens/index.js`, `./components` →
 * `dist/components/index.js`. `vite-plugin-dts` генерирует `.d.ts` рядом с каждым `.js`,
 * сохраняя структуру каталогов исходников (`entryRoot: 'src'`).
 *
 * CSS дизайн-токенов (`src/tokens/*.css`, импортированные из `src/tokens/index.ts`) собирается
 * в единый `dist/tokens/index.css` — тот файл, который подключает `import '@dorutj/ui/tokens'`
 * в каждом приложении (см. JSDoc `src/tokens/index.ts`). `cssCodeSplit: true` — у Vite по одному
 * CSS-чанку на entry-point, который реально импортирует CSS (только `tokens/index`).
 */
export default defineConfig({
  // Соответствует tsconfig.json (`baseUrl: "./src"`, `paths: { "@/*": ["*"] }`, тот же алиас,
  // что и `vitest.config.ts`) — без него Rollup не резолвит `@/a11y/...` в исходниках компонентов.
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  plugins: [
    react(),
    dts({
      rollupTypes: false,
      entryRoot: 'src',
      // `.d.ts` — только для продуктового кода: тесты/фикстуры/Storybook-истории не входят
      // в публичный API пакета и не должны попадать в дистрибутив.
      exclude: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.stories.tsx', '**/__fixtures__/**'],
    }),
  ],
  build: {
    cssCodeSplit: true,
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        'tokens/index': resolve(__dirname, 'src/tokens/index.ts'),
        'components/index': resolve(__dirname, 'src/components/index.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      output: {
        // Rollup даёт CSS-чанкам хешированные имена на базе basename entry-чанка, который
        // случайно с ними совпал в графе модулей (не совпадает с `assetInfo.names`) — источник
        // истины для маршрутизации здесь надёжнее брать из `originalFileNames` (реальные пути
        // исходных `.css`-файлов): всё из `src/tokens/**` → `tokens/index.css` (единая точка
        // подключения токенов, см. JSDoc `src/tokens/index.ts`), всё из `src/components/**` →
        // `components/index.css` (keyframes, которые нельзя выразить через inline `style`,
        // см. JSDoc `internal/spinner.css`/`skeleton/skeleton.css`).
        assetFileNames: (assetInfo) => {
          if (assetInfo.type !== 'asset' || !(assetInfo.names?.[0]?.endsWith('.css') ?? false)) {
            return 'assets/[name]-[hash][extname]'
          }
          const sourcePaths = assetInfo.originalFileNames ?? []
          // Rollup не сохраняет `originalFileNames` для CSS shared-чанка, слитого из НЕСКОЛЬКИХ
          // компонентных `.css` (`internal/spinner.css` + `skeleton/skeleton.css`) — он отдаёт
          // пустой массив на финальном проходе. `src/tokens/index.ts` — единственный entry,
          // где путь надёжно виден (`sourcePaths` непуст и указывает на `src/tokens/`), поэтому
          // это единственный положительный признак: всё остальное CSS пакета — компонентные
          // keyframes (`components/index.css`, см. JSDoc `internal/spinner.css`).
          const isTokensCss = sourcePaths.some((path) => path.includes('src/tokens/'))
          return isTokensCss ? 'tokens/index.css' : 'components/index.css'
        },
      },
    },
  },
})
