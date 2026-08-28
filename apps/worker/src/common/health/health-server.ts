import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { HealthService } from './health.service.js'

const HTTP_OK = 200
const HTTP_NOT_FOUND = 404
const HTTP_SERVICE_UNAVAILABLE = 503
const HEALTH_PATH = '/health'
const JSON_CONTENT_TYPE_HEADER = { 'Content-Type': 'application/json' }

/**
 * Минимальный `node:http`-сервер только для `GET /health` на служебном `WORKER_HEALTH_PORT`.
 * `apps/worker` намеренно не тянет `@nestjs/platform-fastify` — он не обслуживает HTTP-трафик
 * клиентов (SRS-NFR-037), поэтому полноценный HTTP-фреймворк здесь избыточен.
 */
export function createHealthServer(healthService: HealthService): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET' || req.url !== HEALTH_PATH) {
      res.writeHead(HTTP_NOT_FOUND).end()
      return
    }
    respondWithHealthStatus(healthService, res)
  })
}

function respondWithHealthStatus(healthService: HealthService, res: ServerResponse): void {
  healthService
    .checkRedisConnection()
    .then((isHealthy) => {
      const status = isHealthy ? HTTP_OK : HTTP_SERVICE_UNAVAILABLE
      res.writeHead(status, JSON_CONTENT_TYPE_HEADER)
      res.end(JSON.stringify({ status: isHealthy ? 'ok' : 'unavailable' }))
    })
    .catch(() => {
      res.writeHead(HTTP_SERVICE_UNAVAILABLE).end()
    })
}
