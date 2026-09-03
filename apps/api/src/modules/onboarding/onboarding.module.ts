/**
 * NestJS-модуль `onboarding` (EP-03, DTJ-063). Barrel-файл (D-27) — правится
 * ТОЛЬКО добавлением строк. Провайдеры регистрируются по мере реализации
 * тикетов DTJ-064, 065, 066, 067, 068, 070, 071, 072, 073, 074.
 *
 * Сейчас модуль пуст — скелет для подключения в корневой `AppModule`
 * последующими тикетами.
 */
import { Module } from '@nestjs/common'
import { AuthModule } from '@/modules/auth/auth.module.js'
import { PHARMACY_CHAIN_REPOSITORY } from './application/ports/pharmacy-chain.repository.port.js'
import { PHARMACY_ACCOUNT_REPOSITORY } from './application/ports/pharmacy-account.repository.port.js'
import { OBJECT_STORAGE } from './application/ports/object-storage.port.js'
import { OTP_PORT } from './application/ports/otp.port.js'
import { PHARMACY_CHAIN_STATUS } from './application/ports/pharmacy-chain-status.port.js'
import { ORDERS_CANCELLATION } from './application/ports/orders-cancellation.port.js'
import { ONBOARDING_REVIEW_LOG_REPOSITORY } from './application/ports/onboarding-review-log.repository.port.js'
import {
  PHARMACY_VERIFICATION_REPOSITORY,
  DrizzlePharmacyVerificationRepository,
} from './infrastructure/repositories/pharmacy-verification.repository.js'
import { DrizzlePharmacyChainRepository } from './infrastructure/repositories/pharmacy-chain.repository.js'
import { DrizzlePharmacyAccountRepository } from './infrastructure/repositories/pharmacy-account.repository.js'
import { DrizzleOnboardingReviewLogRepository } from './infrastructure/repositories/onboarding-review-log.repository.js'
import { PharmacyChainStatusAdapter } from './infrastructure/adapters/pharmacy-chain-status.adapter.js'
import { NullOrdersCancellationAdapter } from './infrastructure/adapters/null-orders-cancellation.adapter.js'
import { LocalObjectStorageAdapter } from './infrastructure/adapters/local-object-storage.adapter.js'
import { StubOtpAdapter } from './infrastructure/adapters/otp.adapter.js'
import { OnboardingFacade } from './onboarding.facade.js'
import { SubmitChainApplicationUseCase } from './application/use-cases/submit-chain-application.use-case.js'
import { VerifyChainContactPhoneUseCase } from './application/use-cases/verify-chain-contact-phone.use-case.js'
import { SubmitPharmacyApplicationUseCase } from './application/use-cases/submit-pharmacy-application.use-case.js'
import { SubmitChainForReviewUseCase } from './application/use-cases/submit-chain-for-review.use-case.js'
import { SubmitPharmacyForReviewUseCase } from './application/use-cases/submit-pharmacy-for-review.use-case.js'
import { ListPendingVerificationsUseCase } from './application/use-cases/list-pending-verifications.use-case.js'
import { ReviewChainApplicationUseCase } from './application/use-cases/review-chain-application.use-case.js'
import { ReviewPharmacyApplicationUseCase } from './application/use-cases/review-pharmacy-application.use-case.js'
import { SuspendPharmacyUseCase } from './application/use-cases/suspend-pharmacy.use-case.js'
import { ForceCancelIncompleteOrdersUseCase } from './application/use-cases/force-cancel-incomplete-orders.use-case.js'
import { RevokeVerificationUseCase } from './application/use-cases/revoke-verification.use-case.js'
import { RequestReactivationUseCase } from './application/use-cases/request-reactivation.use-case.js'
import { ListExpiringLicensesUseCase } from './application/use-cases/list-expiring-licenses.use-case.js'
import { PharmacyChainsPublicController } from './presentation/controllers/pharmacy-chains-public.controller.js'
import { PharmacyAccountsPublicController } from './presentation/controllers/pharmacy-accounts-public.controller.js'
import { OnboardingDocumentsController } from './presentation/controllers/onboarding-documents.controller.js'
import { PharmacyVerificationQueueController } from './presentation/controllers/pharmacy-verification-queue.controller.js'
import { PharmacyVerificationDecisionsController } from './presentation/controllers/pharmacy-verification-decisions.controller.js'
import { PharmacySuspensionController } from './presentation/controllers/pharmacy-suspension.controller.js'
import { PharmacyVerificationRevocationController } from './presentation/controllers/pharmacy-verification-revocation.controller.js'
import { PharmacyAccountsAdminController } from './presentation/controllers/pharmacy-accounts-admin.controller.js'

@Module({
  // Контроллеры этого модуля защищены `@UseGuards(AuthGuard)`. Nest создаёт guard в контексте
  // ТОГО модуля, где он применён, поэтому `JWT_SIGNER` должен быть виден именно здесь —
  // без этого импорта AppModule не поднимался: «can't resolve dependencies of the AuthGuard
  // (Reflector, ?) ... in the OnboardingModule». `AuthModule` экспортирует и `AuthGuard`,
  // и `JWT_SIGNER`; цикла нет — `AuthModule` не импортирует onboarding.
  imports: [AuthModule],
  providers: [
    { provide: PHARMACY_CHAIN_REPOSITORY, useClass: DrizzlePharmacyChainRepository },
    { provide: PHARMACY_ACCOUNT_REPOSITORY, useClass: DrizzlePharmacyAccountRepository },
    { provide: PHARMACY_VERIFICATION_REPOSITORY, useClass: DrizzlePharmacyVerificationRepository },
    { provide: ONBOARDING_REVIEW_LOG_REPOSITORY, useClass: DrizzleOnboardingReviewLogRepository },
    { provide: OBJECT_STORAGE, useClass: LocalObjectStorageAdapter },
    { provide: OTP_PORT, useClass: StubOtpAdapter },
    { provide: PHARMACY_CHAIN_STATUS, useClass: PharmacyChainStatusAdapter },
    { provide: ORDERS_CANCELLATION, useClass: NullOrdersCancellationAdapter },
    SubmitChainApplicationUseCase,
    VerifyChainContactPhoneUseCase,
    SubmitPharmacyApplicationUseCase,
    SubmitChainForReviewUseCase,
    SubmitPharmacyForReviewUseCase,
    ListPendingVerificationsUseCase,
    ReviewChainApplicationUseCase,
    ReviewPharmacyApplicationUseCase,
    SuspendPharmacyUseCase,
    ForceCancelIncompleteOrdersUseCase,
    RevokeVerificationUseCase,
    RequestReactivationUseCase,
    ListExpiringLicensesUseCase,
    OnboardingFacade,
  ],
  controllers: [
    PharmacyChainsPublicController,
    PharmacyAccountsPublicController,
    OnboardingDocumentsController,
    PharmacyVerificationQueueController,
    PharmacyVerificationDecisionsController,
    PharmacySuspensionController,
    PharmacyVerificationRevocationController,
    PharmacyAccountsAdminController,
  ],
  // DTJ-227 (EP-09 checkout) — первый межмодульный DI-потребитель `OnboardingFacade`
  // (`orders.module.ts` импортирует `OnboardingModule`, инжектит `OnboardingFacade` напрямую
  // через `CatalogFacadeAdapter`-подобный адаптер). Без `exports` Nest не резолвит провайдер
  // за пределами этого модуля даже при наличии `imports: [OnboardingModule]` у потребителя.
  exports: [OnboardingFacade],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
export class OnboardingModule {}
