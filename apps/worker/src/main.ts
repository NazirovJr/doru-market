import 'reflect-metadata'
import { Logger, type INestApplicationContext } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { Redis } from 'ioredis'
import type { Server } from 'node:http'
import { AppModule } from './app.module.js'
import { createHealthServer } from './common/health/health-server.js'
import { HealthService } from './common/health/health.service.js'
import { validateWorkerEnv } from './config/env.schema.js'
import { REDIS_CONNECTION } from './config/redis-connection.provider.js'

const logger = new Logger('WorkerBootstrap')

/**
 * `apps/worker` — не HTTP-сервис (SRS-NFR-037): контекст NestJS без платформы + отдельный
 * минимальный `node:http`-сервер только для `GET /health`. ENV валидируется ДО
 * `NestFactory.createApplicationContext`, чтобы AC4 (невалидный `REDIS_URL` → выход до
 * подключения к очереди) не зависело от порядка инициализации провайдеров Nest.
 */
async function bootstrap(): Promise<void> {
  const env = validateWorkerEnv(process.env)

  const app = await NestFactory.createApplicationContext(AppModule)
  const healthServer = createHealthServer(app.get(HealthService))
  await new Promise<void>((resolve) => healthServer.listen(env.WORKER_HEALTH_PORT, resolve))
  logger.log(`apps/worker: health-порт слушает на ${String(env.WORKER_HEALTH_PORT)}`)

  registerShutdownHooks(app, healthServer)
}

function registerShutdownHooks(app: INestApplicationContext, healthServer: Server): void {
  const shutdown = (signal: string): void => {
    logger.log(`apps/worker: получен ${signal}, остановка...`)
    healthServer.close()
    const redis = app.get<Redis>(REDIS_CONNECTION)
    void redis.quit().finally(() => void app.close())
  }
  process.on('SIGTERM', () => {
    shutdown('SIGTERM')
  })
  process.on('SIGINT', () => {
    shutdown('SIGINT')
  })
}

bootstrap().catch((error: unknown) => {
  logger.error(`apps/worker: критическая ошибка старта — ${String(error)}`)
  process.exitCode = 1
})
