#!/usr/bin/env node
/**
 * Тот же дефект 2, что и в apps/api (см. apps/api/scripts/clean-build-cache.mjs):
 * `nest-cli.json` — `deleteOutDir: true`, `tsconfig.json` (через
 * `tsconfig.base.json`) — `incremental: true`. Старый `tsconfig.tsbuildinfo`
 * заставляет `tsc` переэмитить только изменившиеся файлы, хотя `dist` уже
 * стёрт — сборка зелёная, артефакт неполный. Удаляем кеш перед каждой сборкой.
 */

import { rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const tsbuildinfo = join(scriptDir, '..', 'tsconfig.tsbuildinfo')

rmSync(tsbuildinfo, { force: true })
