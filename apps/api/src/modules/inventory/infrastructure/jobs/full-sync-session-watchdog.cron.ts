/**
 * Cron-watchdog для `DetectStuckFullSyncSessionsUseCase` (EP-05, DTJ-152).
 *
 * Запускается каждые 10 минут (расписание cron: раз в 10 минут).
 * Использует `@nestjs/schedule` — модуль `ScheduleModule.forRoot()` уже
 * подключён в `app.module.ts` (если нет — добавить; см. DTJ-152 «Координация»).
 *
 * Таймаут берётся из ENV `FULL_SYNC_SESSION_TIMEOUT_MINUTES` (ASSUMPTION
 * `60`, тикет DTJ-152). Если ENV не задан — дефолт `60` минут.
 */
import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { DetectStuckFullSyncSessionsUseCase } from '@/modules/inventory/application/use-cases/detect-stuck-full-sync-sessions.use-case.js'

const DEFAULT_TIMEOUT_MINUTES = 60

@Injectable()
export class FullSyncSessionWatchdogCron {
  private readonly logger = new Logger(FullSyncSessionWatchdogCron.name)

  constructor(
    private readonly detectStuck: DetectStuckFullSyncSessionsUseCase,
  ) {}

  @Cron('*/10 * * * *')
  async handleCron(): Promise<void> {
    const timeoutMinutes = this.readTimeoutMinutes()
    try {
      const result = await this.detectStuck.execute(timeoutMinutes)
      if (result.stuckSessionsCount > 0) {
        this.logger.warn(
          `full-sync watchdog: ${String(result.stuckSessionsCount)} stuck session(s) detected (timeout=${String(timeoutMinutes)}m)`,
        )
      }
    } catch (error) {
      this.logger.error(
        'full-sync watchdog failed',
        error instanceof Error ? error.stack : String(error),
      )
    }
  }

  private readTimeoutMinutes(): number {
    // Доступ к ENV — через `process.env`, не через ConfigService (sandbox-friendly).
    // eslint-disable-next-line @typescript-eslint/dot-notation -- FULL_SYNC_SESSION_TIMEOUT_MINUTES — runtime ENV-ключ, не объявлен в NodeJS.ProcessEnv (произвольное имя настраивается через ENV-инжекцию)
    const raw = process.env['FULL_SYNC_SESSION_TIMEOUT_MINUTES']
    if (raw === undefined) return DEFAULT_TIMEOUT_MINUTES
    const parsed = Number.parseInt(raw, 10)
    if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MINUTES
    return parsed
  }
}
