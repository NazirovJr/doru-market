// Бросает явную ошибку вместо тихого no-op — иначе отсутствие конфигурации выглядело бы как
// "нечего удалять".
import { Injectable, Logger } from '@nestjs/common'
import type { AuditLogRetentionPort } from './audit-log-retention.port.js'

@Injectable()
export class NullAuditLogRetentionAdapter implements AuditLogRetentionPort {
  private readonly logger = new Logger(NullAuditLogRetentionAdapter.name)

  deleteBatch(): Promise<number> {
    const message =
      'audit-log-retention: AUDIT_RETENTION_DATABASE_URL не задан в этом окружении — джоба ' +
      'не запускается под audit_retention_role'
    this.logger.error(message)
    return Promise.reject(new Error(message))
  }
}
