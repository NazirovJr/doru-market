import { defineConfig } from 'drizzle-kit'

/**
 * Drizzle Kit config для `apps/api` (DTJ-091, EP-04). Схемы в
 * `apps/api/src/db/schema/`, миграции — в `apps/api/migrations/`. Управляется
 * командами `pnpm db:generate` / `pnpm db:migrate` (см. `apps/api/package.json`).
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://test:test@localhost:5432/dorutj',
  },
  verbose: true,
  strict: true,
})
