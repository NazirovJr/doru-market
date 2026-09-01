/**
 * `OpenApiBuilder` (EP-01, DTJ-021, SRS-API-060/061/062) — единый источник
 * правды для OpenAPI 3.1 спецификации (`docs/api/openapi.json`).
 *
 * Использует `@asteasolutions/zod-to-openapi` (мост Zod→OpenAPI). Каждый
 * последующий контроллер регистрирует СВОИ Zod DTO через
 * `registry.registerPath(...)` в момент `bootstrap'а` модуля.
 *
 * **`buildOpenApiDocument()`** — собирает финальный документ. Возвращает
 * пустую спеку с метаданными проекта, если ни один путь не зарегистрирован
 * (для DTJ-021 это валидный граничный случай: ни одного эндпоинта ещё нет).
 */
import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'

export interface ProjectMetadata {
  title: string
  version: string
  description: string
  serverUrl: string
}

const PROJECT_METADATA: ProjectMetadata = {
  title: 'DoruTJ API',
  version: '0.1.0',
  description: 'DoruTJ — единый API для заказа и доставки лекарств в Таджикистане.',
  serverUrl: 'http://localhost:3000',
}

const registry = new OpenAPIRegistry()

/** Singleton-реестр путей/схем, доступный из любого модуля через `getRegistry()`. */
export function getRegistry(): OpenAPIRegistry {
  return registry
}

export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV3['generateDocument']> {
  const generator = new OpenApiGeneratorV3(registry.definitions)
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: PROJECT_METADATA.title,
      version: PROJECT_METADATA.version,
      description: PROJECT_METADATA.description,
    },
    servers: [{ url: PROJECT_METADATA.serverUrl, description: 'local' }],
  })
}
