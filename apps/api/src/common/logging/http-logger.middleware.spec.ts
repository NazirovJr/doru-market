import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { HttpLoggerMiddleware } from '@/common/logging/http-logger.middleware'
import type { AppConfigService } from '@/config/app-config.service'

function fakeConfig(): AppConfigService {
  return { logLevel: 'info' } as unknown as AppConfigService
}

interface AccessLogLine {
  readonly msg?: string
  readonly method?: string
  readonly path?: string
  readonly statusCode?: number
  readonly durationMs?: number
  readonly req?: unknown
  readonly res?: unknown
}

/**
 * `pino-http` строит СВОЙ внутренний логгер из опций (см. комментарий в
 * `http-logger.middleware.ts`) и по умолчанию пишет в `process.stdout` — конструктор
 * мидлвари не даёт способа подменить поток напрямую, поэтому перехватываем
 * `process.stdout.write` на время теста, а не подсовываем свой stream.
 */
describe('HttpLoggerMiddleware', () => {
  let server: Server | undefined

  afterEach(async () => {
    if (server !== undefined) {
      await new Promise<void>((resolve) => {
        server?.close(() => {
          resolve()
        })
      })
    }
  })

  it('пишет плоскую access-запись 1:1 по SRS-NFR-038 (method/path/statusCode/durationMs)', async () => {
    const originalWrite = process.stdout.write.bind(process.stdout)
    const written: string[] = []
    process.stdout.write = (chunk: string) => {
      written.push(chunk)
      return true
    }

    const middleware = new HttpLoggerMiddleware(fakeConfig())

    server = createServer((req, res) => {
      middleware.use(req, res, () => {
        res.writeHead(200)
        res.end('ok')
      })
    })

    try {
      await new Promise<void>((resolve) => server?.listen(0, resolve))
      const address: AddressInfo | string | null = server.address()
      if (typeof address !== 'object' || address === null) {
        throw new Error('expected server.address() to return AddressInfo')
      }
      const port = address.port

      await new Promise<void>((resolve, reject) => {
        const req = httpRequest({ host: '127.0.0.1', port, path: '/health', method: 'GET' }, (res) => {
          res.resume()
          res.on('end', resolve)
        })
        req.on('error', reject)
        req.end()
      })
    } finally {
      process.stdout.write = originalWrite
    }

    const parsed = written.filter(Boolean).map((line) => JSON.parse(line) as AccessLogLine)
    const accessLine = parsed.find((line) => line.msg === 'request completed')

    expect(accessLine?.method).toBe('GET')
    expect(accessLine?.path).toBe('/health')
    expect(accessLine?.statusCode).toBe(200)
    expect(typeof accessLine?.durationMs).toBe('number')
    expect(accessLine?.req).toBeUndefined()
    expect(accessLine?.res).toBeUndefined()
  })
})
