// Оборачивает AppConfigService (единая точка чтения ENV apps/api), не ConfigService напрямую.
// Пока без внутреннего потребителя apps/api — фактический потребитель AuditLogRetentionJob
// (apps/worker, своя независимая копия ENV, worker не импортирует apps/api).
import { Inject, Injectable } from '@nestjs/common'
import { AppConfigService } from '@/config/app-config.service.js'

export const AUDIT_RETENTION_CONFIG = Symbol('AUDIT_RETENTION_CONFIG')

export interface AuditRetentionConfig {
  readonly retentionYears: number
}

@Injectable()
export class AppConfigAuditRetentionConfig implements AuditRetentionConfig {
  constructor(@Inject(AppConfigService) private readonly appConfig: AppConfigService) {}

  get retentionYears(): number {
    return this.appConfig.auditLogRetentionYears
  }
}

export const AUDIT_RETENTION_CONFIG_PROVIDER = {
  provide: AUDIT_RETENTION_CONFIG,
  useClass: AppConfigAuditRetentionConfig,
} as const
