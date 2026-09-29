// Готовая формулировка запрета хардкода бренда для передачи владельцу корневого eslint.config.mjs.
// В CI не встроена: запуск вручную `node scripts/eslint-branding-rule-poc.mjs` доказывает, что правило работает.
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { ESLint } from 'eslint'

const BRAND_PATTERN = '/DoruTJ|Sifat|Oson/i'
const MESSAGE = 'Имя бренда берётся из i18n (brand.name) или tenant.brandName, а не из литерала.'

export const brandingHardcodeRule = {
  name: 'dorutj/no-hardcoded-brand',
  files: ['**/*.{ts,tsx,js,jsx,mjs}'],
  ignores: ['packages/i18n/**', '**/*.spec.{ts,tsx}', '**/*.test.{ts,tsx}', 'apps/api/src/db/seed/**'],
  rules: {
    'no-restricted-syntax': [
      'error',
      { selector: `Literal[value=${BRAND_PATTERN}]`, message: MESSAGE },
      { selector: `TemplateElement[value.raw=${BRAND_PATTERN}]`, message: MESSAGE },
    ],
  },
}

async function lintText(code, filePath) {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [brandingHardcodeRule], cwd: process.cwd() })
  const [result] = await eslint.lintText(code, { filePath })
  return (result?.messages ?? []).filter((message) => message.ruleId === 'no-restricted-syntax')
}

async function selfCheck() {
  const literal = 'export const title = "DoruTJ"\n'
  const template = 'export const title = `Welcome to ${x} Sifat`\n'
  const clean = 'export const title = t("brand.name")\n'

  const flagged = await lintText(literal, 'apps/web/src/pages/example.ts')
  assert.equal(flagged.length, 1, 'литерал "DoruTJ" вне разрешённых каталогов должен быть отклонён')
  assert.equal((await lintText(template, 'apps/web/src/pages/example.ts')).length, 1, 'шаблонная строка тоже')
  assert.equal((await lintText(clean, 'apps/web/src/pages/example.ts')).length, 0, 'i18n-ключ проходит')
  for (const allowed of ['packages/i18n/src/x.ts', 'apps/web/src/a.spec.ts', 'apps/api/src/db/seed/tenants/neutral.seed.ts']) {
    assert.equal((await lintText(literal, allowed)).length, 0, `${allowed} исключён из правила`)
  }
  console.log('eslint-branding-rule-poc: OK')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await selfCheck()
}
