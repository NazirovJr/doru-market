/**
 * NestJS-модуль `auth` (EP-01, DTJ-022/023/024/025/026/027). Barrel-файл (D-27) — правится ТОЛЬКО
 * добавлением строк.
 *
 * Поставщики (нарастающий итог по тикетам EP-01):
 *   - `JWT_SIGNER` → `Rs256JwtSignerAdapter`        (DTJ-022)
 *   - `USERS_REPOSITORY` → `InMemoryUsersRepository` (DTJ-022; Drizzle — DTJ-024)
 *   - `OTP_GENERATOR` → `CryptoOtpGeneratorAdapter`  (DTJ-010, DTJ-023)
 *   - `OTP_CODES_REPOSITORY` → `InMemoryOtpCodesRepository` (DTJ-015, DTJ-023, DTJ-024)
 *   - `SMS_PROVIDER` → `MockSmsProviderAdapter`      (DTJ-023, Charter §3.3)
 *   - `RATE_LIMIT_CHECKER` → `InMemoryRateLimitCheckerAdapter` (DTJ-023;
 *     Redis-адаптер появится, когда БД/Redis будут доступны в docker-compose)
 *   - `AUTH_SESSIONS_REPOSITORY` → `InMemoryAuthSessionsRepository` (DTJ-024, DTJ-025)
 *   - `REFRESH_TOKEN_GENERATOR` → `CryptoRefreshTokenGeneratorAdapter` (DTJ-024)
 *   - `UNIT_OF_WORK` → `InMemoryUnitOfWorkAdapter`   (DTJ-024; Drizzle — DTJ-024+)
 *   - `TELEGRAM_INIT_DATA_VERIFIER` → `TelegramInitDataVerifierAdapter` (DTJ-027)
 *   - `USER_TELEGRAM_IDENTITIES_REPOSITORY` → `InMemoryUserTelegramIdentitiesRepository` (DTJ-027)
 *   - `PINO_LOGGER` — глобальный, берётся из `LoggerModule` (DTJ-001, `@Global()`).
 *
 * `RefreshTokenUseCase` (DTJ-025) использует `PINO_LOGGER` для security-лога
 * при detect-reuse (SRS-API-027).
 *
 * Guard'ы/декораторы — экспортируются через `modules/auth/index.ts`, контроллеры
 * других модулей импортируют их ТОЛЬКО через barrel (DTJ-022 §«DoD» п.5).
 */
import { Module } from '@nestjs/common'
import {
  JWT_SIGNER,
  type JwtSignerPort,
} from './application/ports/jwt-signer.port.js'
import { USERS_REPOSITORY, type UsersRepository } from './application/ports/users.repository.port.js'
import { OTP_GENERATOR, type OtpGeneratorPort } from './application/ports/otp-generator.port.js'
import {
  OTP_CODES_REPOSITORY,
  type OtpCodesRepository,
} from './application/ports/otp-codes.repository.port.js'
import { SMS_PROVIDER, type SmsProviderPort } from './application/ports/sms-provider.port.js'
import {
  RATE_LIMIT_CHECKER,
  type RateLimitCheckerPort,
} from './application/ports/rate-limit-checker.port.js'
import {
  AUTH_SESSIONS_REPOSITORY,
  type AuthSessionsRepository,
  type RevokeReason,
  type RotateAuthSessionInput,
} from './application/ports/auth-sessions.repository.port.js'
import {
  REFRESH_TOKEN_GENERATOR,
  type RefreshTokenGeneratorPort,
} from './application/ports/refresh-token-generator.port.js'
import { UNIT_OF_WORK, type UnitOfWorkPort } from './application/ports/unit-of-work.port.js'
import { Rs256JwtSignerAdapter } from './infrastructure/adapters/rs256-jwt-signer.adapter.js'
import { CryptoOtpGeneratorAdapter } from './infrastructure/adapters/crypto-otp-generator.adapter.js'
import { MockSmsProviderAdapter } from './infrastructure/adapters/mock-sms-provider.adapter.js'
import { InMemoryRateLimitCheckerAdapter } from './infrastructure/adapters/in-memory-rate-limit-checker.adapter.js'
import { CryptoRefreshTokenGeneratorAdapter } from './infrastructure/adapters/crypto-refresh-token-generator.adapter.js'
import { InMemoryUnitOfWorkAdapter } from './infrastructure/adapters/in-memory-unit-of-work.adapter.js'
import { InMemoryUsersRepository } from './infrastructure/repositories/in-memory-users.repository.js'
import { InMemoryOtpCodesRepository } from './infrastructure/repositories/in-memory-otp-codes.repository.js'
import { InMemoryAuthSessionsRepository } from './infrastructure/repositories/in-memory-auth-sessions.repository.js'
import { RequestOtpUseCase } from './application/use-cases/request-otp.use-case.js'
import { VerifyOtpUseCase } from './application/use-cases/verify-otp.use-case.js'
import { RefreshTokenUseCase } from './application/use-cases/refresh-token.use-case.js'
import { LogoutUseCase } from './application/use-cases/logout.use-case.js'
import { LogoutAllUseCase } from './application/use-cases/logout-all.use-case.js'
import { ListSessionsUseCase } from './application/use-cases/list-sessions.use-case.js'
import { RevokeSessionUseCase } from './application/use-cases/revoke-session.use-case.js'
import { TelegramAuthUseCase } from './application/use-cases/telegram-auth.use-case.js'
import { CreateStaffAccountUseCase } from './application/use-cases/create-staff-account.use-case.js'
import { GetMeUseCase } from './application/use-cases/get-me.use-case.js'
import { OtpRequestController } from './presentation/controllers/otp-request.controller.js'
import { OtpVerifyController } from './presentation/controllers/otp-verify.controller.js'
import { RefreshController } from './presentation/controllers/refresh.controller.js'
import { SessionsController } from './presentation/controllers/sessions.controller.js'
import { TelegramAuthController } from './presentation/controllers/telegram-auth.controller.js'
import { StaffAccountsController } from './presentation/controllers/staff-accounts.controller.js'
import { MeController } from './presentation/controllers/me.controller.js'
import { AuthGuard } from './presentation/guards/auth.guard.js'
import { RolesGuard } from './presentation/guards/roles.guard.js'
import { TELEGRAM_INIT_DATA_VERIFIER, TelegramInitDataVerifierAdapter } from './infrastructure/adapters/telegram-init-data-verifier.adapter.js'
import {
  USER_TELEGRAM_IDENTITIES_REPOSITORY,
  InMemoryUserTelegramIdentitiesRepository,
} from './infrastructure/repositories/in-memory-user-telegram-identities.repository.js'
// ВАЖНО: внутренние импорты `auth.module.ts` идут ПРЯМО из файлов,
// не через barrel `./index.ts` — иначе цикл `module → barrel → module`
// (dependency-cruiser `no-circular` отвергает). Barrel `index.ts` предназначен
// ТОЛЬКО для межмодульного использования (D-27).

@Module({
  providers: [
    { provide: JWT_SIGNER, useClass: Rs256JwtSignerAdapter },
    { provide: USERS_REPOSITORY, useClass: InMemoryUsersRepository },
    { provide: OTP_GENERATOR, useClass: CryptoOtpGeneratorAdapter },
    { provide: OTP_CODES_REPOSITORY, useClass: InMemoryOtpCodesRepository },
    { provide: SMS_PROVIDER, useClass: MockSmsProviderAdapter },
    { provide: RATE_LIMIT_CHECKER, useClass: InMemoryRateLimitCheckerAdapter },
    { provide: AUTH_SESSIONS_REPOSITORY, useClass: InMemoryAuthSessionsRepository },
    { provide: REFRESH_TOKEN_GENERATOR, useClass: CryptoRefreshTokenGeneratorAdapter },
    { provide: UNIT_OF_WORK, useClass: InMemoryUnitOfWorkAdapter },
    { provide: TELEGRAM_INIT_DATA_VERIFIER, useClass: TelegramInitDataVerifierAdapter },
    { provide: USER_TELEGRAM_IDENTITIES_REPOSITORY, useClass: InMemoryUserTelegramIdentitiesRepository },
    Rs256JwtSignerAdapter,
    CryptoOtpGeneratorAdapter,
    MockSmsProviderAdapter,
    InMemoryRateLimitCheckerAdapter,
    CryptoRefreshTokenGeneratorAdapter,
    InMemoryUnitOfWorkAdapter,
    InMemoryUsersRepository,
    InMemoryOtpCodesRepository,
    InMemoryAuthSessionsRepository,
    InMemoryUserTelegramIdentitiesRepository,
    TelegramInitDataVerifierAdapter,
    RequestOtpUseCase,
    VerifyOtpUseCase,
    RefreshTokenUseCase,
    LogoutUseCase,
    LogoutAllUseCase,
    ListSessionsUseCase,
    RevokeSessionUseCase,
    TelegramAuthUseCase,
    CreateStaffAccountUseCase,
    GetMeUseCase,
    AuthGuard,
    RolesGuard,
  ],
  controllers: [
    OtpRequestController,
    OtpVerifyController,
    RefreshController,
    SessionsController,
    TelegramAuthController,
    StaffAccountsController,
    MeController,
  ],
  exports: [
    JWT_SIGNER,
    USERS_REPOSITORY,
    OTP_GENERATOR,
    OTP_CODES_REPOSITORY,
    SMS_PROVIDER,
    RATE_LIMIT_CHECKER,
    AUTH_SESSIONS_REPOSITORY,
    REFRESH_TOKEN_GENERATOR,
    UNIT_OF_WORK,
    TELEGRAM_INIT_DATA_VERIFIER,
    USER_TELEGRAM_IDENTITIES_REPOSITORY,
    RequestOtpUseCase,
    VerifyOtpUseCase,
    RefreshTokenUseCase,
    LogoutUseCase,
    LogoutAllUseCase,
    ListSessionsUseCase,
    RevokeSessionUseCase,
    TelegramAuthUseCase,
    CreateStaffAccountUseCase,
    GetMeUseCase,
    AuthGuard,
    RolesGuard,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
export class AuthModule {}

// Типобезопасный re-export портов (для использования в других модулях)
export type {
  JwtSignerPort,
  UsersRepository,
  OtpGeneratorPort,
  OtpCodesRepository,
  SmsProviderPort,
  RateLimitCheckerPort,
  AuthSessionsRepository,
  RefreshTokenGeneratorPort,
  UnitOfWorkPort,
  RotateAuthSessionInput,
  RevokeReason,
}
