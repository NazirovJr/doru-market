/**
 * Public barrel `modules/auth` (D-27). Единственная точка, через которую
 * другие модули импортируют guard'ы/декораторы/порты (DTJ-022 §«DoD» п.5).
 *
 * Правило пополнения: каждый следующий тикет EP-01 (DTJ-023/024/025/030)
 * добавляет СВОЙ use case/контроллер/порт в `auth.module.ts` и при
 * необходимости ЭКСПОРТ наружу через эту точку.
 */
export { AuthModule } from './auth.module.js'
export { AuthGuard } from './presentation/guards/auth.guard.js'
export { RolesGuard } from './presentation/guards/roles.guard.js'
export { Roles, ROLES_METADATA_KEY } from './presentation/decorators/roles.decorator.js'
export { CurrentUser } from './presentation/decorators/current-user.decorator.js'
export {
  JWT_SIGNER,
  type JwtClaims,
  type JwtSignerPort,
  type JwtVerificationError,
} from './application/ports/jwt-signer.port.js'
export {
  USERS_REPOSITORY,
  type UsersRepository,
  type CreateUserInput,
  type UpdateUserPatch,
  type UsersListFilter,
  type UsersListCursor,
  type UsersListQuery,
  type UsersListPage,
} from './application/ports/users.repository.port.js'
export { type User } from './domain/user.js'
export {
  OTP_GENERATOR,
  type OtpGeneratorPort,
  type OtpPurpose,
} from './application/ports/otp-generator.port.js'
export {
  OTP_CODES_REPOSITORY,
  type OtpCodeRecord,
  type OtpCodesRepository,
  type CreateOtpCodeInput,
} from './application/ports/otp-codes.repository.port.js'
export { SMS_PROVIDER, type SmsProviderPort } from './application/ports/sms-provider.port.js'
export {
  RATE_LIMIT_CHECKER,
  type RateLimitCheckResult,
  type RateLimitCheckerPort,
} from './application/ports/rate-limit-checker.port.js'
export {
  AUTH_SESSIONS_REPOSITORY,
  type AuthSessionsRepository,
  type CreateAuthSessionInput,
  type RotateAuthSessionInput,
  type RevokeReason,
} from './application/ports/auth-sessions.repository.port.js'
export { AuthSession } from './domain/value-objects/auth-session.vo.js'
export {
  REFRESH_TOKEN_GENERATOR,
  type RefreshTokenGeneratorPort,
} from './application/ports/refresh-token-generator.port.js'
export { UNIT_OF_WORK, type UnitOfWorkPort } from './application/ports/unit-of-work.port.js'
// Волна 6 (self-deadlock пула соединений, см. verify-otp/telegram-auth/ingest-inventory
// use case JSDoc): `UnitOfWorkTx` — непрозрачный дескриптор транзакции, нужен другим
// модулям (inventory), чтобы прокидывать `tx` в СВОИ репозитории внутри `uow.run(...)`,
// а не открывать второе соединение пула поверх удержанного.
export { type UnitOfWorkTx } from './application/ports/unit-of-work.port.js'
export { PhoneNumber } from './domain/value-objects/phone-number.vo.js'
export { RequestOtpUseCase, type RequestOtpInput, type RequestOtpResult } from './application/use-cases/request-otp.use-case.js'
export { VerifyOtpUseCase, type VerifyOtpInput, type VerifyOtpResult, type VerifyOtpError } from './application/use-cases/verify-otp.use-case.js'
export { RefreshTokenUseCase, type RefreshTokenInput, type RefreshTokenResult, type RefreshTokenError } from './application/use-cases/refresh-token.use-case.js'
export { LogoutUseCase, type LogoutInput, type LogoutResult } from './application/use-cases/logout.use-case.js'
export { LogoutAllUseCase, type LogoutAllInput } from './application/use-cases/logout-all.use-case.js'
export { ListSessionsUseCase, type ListSessionsInput, type SessionSummary } from './application/use-cases/list-sessions.use-case.js'
export { RevokeSessionUseCase, type RevokeSessionInput, type RevokeSessionResult } from './application/use-cases/revoke-session.use-case.js'
export { TelegramAuthUseCase, type TelegramAuthInput, type TelegramAuthResult, type TelegramAuthError } from './application/use-cases/telegram-auth.use-case.js'
