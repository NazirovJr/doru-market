/**
 * `OpenApiModule` (EP-01, DTJ-021) — серверная раздача OpenAPI-документации
 * в dev/test/staging (за `ENABLE_API_DOCS=true` в production).
 *
 * Маршруты:
 *   - `GET /api/docs/json` — сырой JSON (валидный OpenAPI 3.1).
 *   - `GET /api/docs` — Swagger UI (статический HTML, ссылающийся на JSON).
 *
 * **SRS-API-061:** оба маршрута возвращают `404` (НЕ `403`, чтобы не
 * раскрывать факт существования) в production без явного ENV-флага
 * `ENABLE_API_DOCS=true`.
 */
import {
  Controller,
  Get,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Module,
  UseGuards,
} from '@nestjs/common'
import { type FastifyReply } from 'fastify'
import { buildOpenApiDocument } from './openapi.builder.js'

@Injectable()
class ApiDocsAccessGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    const isProduction = process.env.NODE_ENV === 'production'
    const enabled = process.env.ENABLE_API_DOCS === 'true'
    if (isProduction && !enabled) {
      throw new NotFoundException('API docs disabled in production without ENABLE_API_DOCS')
    }
    return true
  }
}

@Controller({ path: 'docs' })
@UseGuards(ApiDocsAccessGuard)
class ApiDocsController {
  @Get('json')
  getJson(_req: unknown, reply: FastifyReply): void {
    const doc = buildOpenApiDocument()
    reply.header('content-type', 'application/json; charset=utf-8')
    reply.send(JSON.stringify(doc, null, 2))
  }

  @Get()
  getUi(_req: unknown, reply: FastifyReply): void {
    const html = renderSwaggerHtml()
    reply.header('content-type', 'text/html; charset=utf-8')
    reply.send(html)
  }
}

function renderSwaggerHtml(): string {
  // Минимальный standalone HTML, ссылающийся на /api/docs/json. Полноценный
  // Swagger UI — зона EP-19 (CDN unpkg), здесь — минимальный reference UI.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>DoruTJ API — Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({ url: '/api/docs/json', dom_id: '#swagger-ui' });
      };
    </script>
  </body>
</html>`
}

// Re-export вложенной guard-функции для unit-тестов.
export { ApiDocsAccessGuard }

@Module({
  controllers: [ApiDocsController],
})
export class OpenApiModule {}
