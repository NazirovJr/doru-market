/** DI-токен корневого pino-логгера. Отдельный файл — иначе `logger.module.ts` и
 * `http-logger.middleware.ts` образуют цикл импортов (`import-x/no-cycle`, C16). */
export const PINO_LOGGER = Symbol('PINO_LOGGER')
