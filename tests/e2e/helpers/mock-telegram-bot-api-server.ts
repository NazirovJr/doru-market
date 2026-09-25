/**
 * `mockTelegramBotApiServer` (DTJ-417, тест-план п.1) — минимальный HTTP-сервер (голый
 * `node:http`, зависимостей не добавляет), эмулирующий `POST /bot<token>/sendMessage`
 * Telegram Bot API для CUJ-11 (DTJ-422). Поднимается ТОЛЬКО в тестовом окружении.
 *
 * `TELEGRAM_API_BASE_URL` (ENV, проставляется CI/`.env.test`, НЕ этим файлом — см. риски
 * тикета) должен указывать реальный `TelegramNotifyProvider` СЮДА в тестовом профиле, а не на
 * `https://api.telegram.org` — координация точного имени переменной с владельцем EP-16
 * (NotificationService) зафиксирована `SRS-NFR-053`.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export interface ReceivedTelegramCall {
  readonly path: string
  readonly body: unknown
  readonly receivedAt: Date
}

const HTTP_OK = 200
const HTTP_INTERNAL_SERVER_ERROR = 500
const HTTP_NOT_FOUND = 404

export class MockTelegramBotApiServer {
  private readonly server: Server
  private readonly receivedCalls: ReceivedTelegramCall[] = []
  private outageUntil: number | null = null

  constructor() {
    this.server = createServer((req, res) => {
      void this.handleRequest(req, res)
    })
  }

  /** Запускает сервер на СВОБОДНОМ порту (`port: 0`) и возвращает фактический URL. */
  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, resolve))
    const address = this.server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('MockTelegramBotApiServer: не удалось определить порт после start()')
    }
    return `http://127.0.0.1:${String(address.port)}`
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  /** Все вызовы `sendMessage`, накопленные с момента `start()`/последнего `reset()`. */
  getReceivedCalls(): readonly ReceivedTelegramCall[] {
    return this.receivedCalls
  }

  reset(): void {
    this.receivedCalls.length = 0
    this.outageUntil = null
  }

  /**
   * Следующие `durationMs` мс сервер отвечает `500` на ЛЮБой запрос (проверка circuit
   * breaker/фолбэк-канала CUJ-11, DTJ-422) — после истечения интервала снова `200`.
   */
  simulateOutage(durationMs: number): void {
    this.outageUntil = Date.now() + durationMs
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawBody = await readBody(req)
    const path = req.url ?? '/'

    if (this.outageUntil !== null && Date.now() < this.outageUntil) {
      res.writeHead(HTTP_INTERNAL_SERVER_ERROR, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, description: 'simulated outage' }))
      return
    }

    if (!/^\/bot[^/]+\/sendMessage$/.test(path)) {
      res.writeHead(HTTP_NOT_FOUND, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, description: 'not found' }))
      return
    }

    const body = parseJsonSafely(rawBody)
    this.receivedCalls.push({ path, body, receivedAt: new Date() })
    res.writeHead(HTTP_OK, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, result: { message_id: this.receivedCalls.length } }))
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

function parseJsonSafely(raw: string): unknown {
  if (raw.length === 0) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
