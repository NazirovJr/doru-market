import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'

// Библиотечная сборка packages/ui.
// Точек входа две — ровно те, что объявлены в `exports` package.json. Подпуть `./tokens` собирался
// бы иначе только на бумаге: до DTJ-430 конфиг знал единственный вход `src/index.ts`, поэтому
// `dist/tokens/index.js` не появлялся, и `import '@dorutj/ui/tokens'` падал у потребителя на
// «could not be resolved» — при формально корректной записи в `exports`.
export default defineConfig({
  plugins: [react(), dts({ rollupTypes: false })],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        'tokens/index': resolve(__dirname, 'src/tokens/index.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    },
  },
})
