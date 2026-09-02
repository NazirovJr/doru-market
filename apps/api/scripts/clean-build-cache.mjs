#!/usr/bin/env node
/**
 * Дефект 2: `nest-cli.json` задаёт `deleteOutDir: true`, а `tsconfig.build.json`
 * (через `tsconfig.base.json`) — `incremental: true`. При наличии старого
 * `tsconfig.build.tsbuildinfo` `tsc` считает бо́льшую часть файлов
 * неизменившейся и переэмитит только дельту — `dist` стирается, но
 * пересобирается лишь частично, а сборка при этом завершается кодом 0.
 * Удаляем кеш перед каждой сборкой, чтобы `nest build` всегда был полным.
 */

import { rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const tsbuildinfo = join(scriptDir, '..', 'tsconfig.build.tsbuildinfo')

rmSync(tsbuildinfo, { force: true })
