import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'

// Библиотечная сборка packages/ui (DTJ-400). Реальные точки входа (./tokens, ./components)
// подключаются последующими тикетами EP-18 вместе с исходным кодом.
export default defineConfig({
  plugins: [react(), dts({ rollupTypes: false })],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    },
  },
})
