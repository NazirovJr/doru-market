// [ДОПОЛНЕНИЕ] — таблица отсутствует в исходной схеме (DTJ-361).
import { sql } from 'drizzle-orm'
import { jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { exportJobFormatEnum, exportJobStatusEnum } from './enums.schema.js'
import { users } from './users.js'

const REPORT_TYPE_MAX_LENGTH = 100

export const EXPORT_JOBS_TABLE = 'export_jobs'

export const exportJobs = pgTable(EXPORT_JOBS_TABLE, {
  // id — из ID_GENERATOR use case'а, не gen_random_uuid(): нужен ДО INSERT для ключа MinIO.
  id: uuid('id').primaryKey(),
  reportType: varchar('report_type', { length: REPORT_TYPE_MAX_LENGTH }).notNull(),
  params: jsonb('params').notNull(),
  format: exportJobFormatEnum('format').notNull(),
  status: exportJobStatusEnum('status').notNull().default('processing'),
  downloadUrl: text('download_url'),
  requestedBy: uuid('requested_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`NOW()`),
  completedAt: timestamp('completed_at', { withTimezone: true }),
})

export type ExportJobRow = typeof exportJobs.$inferSelect
export type ExportJobInsert = typeof exportJobs.$inferInsert
