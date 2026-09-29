/**
 * `GetPharmacyVerificationDetailUseCase` — карточка заявки аптечной точки для модератора:
 * реквизиты, данные очереди и временная ссылка на скан лицензии.
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { PHARMACY_ACCOUNT_REPOSITORY, type PharmacyAccountRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-account.repository.port.js'
import {
  PHARMACY_VERIFICATION_REPOSITORY,
  type PharmacyVerificationRepositoryPort,
} from '@/modules/onboarding/application/ports/pharmacy-verification.repository.port.js'
import { OBJECT_STORAGE, ONBOARDING_DOCS_BUCKET, type ObjectStoragePort } from '@/modules/onboarding/application/ports/object-storage.port.js'

const LICENSE_SCAN_LINK_TTL_SECONDS = 300

export interface PharmacyVerificationDetail {
  readonly id: string
  readonly chainId: string
  readonly name: string
  readonly addressText: string
  readonly phone: string
  readonly status: string
  readonly licenseNumber: string
  readonly licenseIssuingAuthority: string | null
  readonly licenseIssueDate: Date | null
  readonly licenseExpiryDate: Date | null
  readonly pharmacistInChargeName: string | null
  readonly submittedAt: Date | null
  readonly slaTargetAt: Date | null
  readonly reviewReason: string | null
  readonly licenseScan: { readonly url: string; readonly contentType: string } | null
}

@Injectable()
export class GetPharmacyVerificationDetailUseCase {
  constructor(
    @Inject(PHARMACY_ACCOUNT_REPOSITORY)
    private readonly pharmacyAccountRepository: PharmacyAccountRepositoryPort,
    @Inject(PHARMACY_VERIFICATION_REPOSITORY)
    private readonly pharmacyVerificationRepository: PharmacyVerificationRepositoryPort,
    @Inject(OBJECT_STORAGE)
    private readonly objectStorage: ObjectStoragePort,
  ) {}

  async execute(input: { readonly pharmacyId: string }): Promise<PharmacyVerificationDetail> {
    const account = await this.pharmacyAccountRepository.findById(input.pharmacyId)
    if (account === null) {
      throw new NotFoundException(`PharmacyAccount not found: ${input.pharmacyId}`)
    }
    const verification = await this.pharmacyVerificationRepository.findBySubject({ pharmacyId: input.pharmacyId })
    const scanUrl = account.licenseScanUrl
    return {
      id: account.id,
      chainId: account.chainId,
      name: account.name,
      addressText: account.addressText,
      phone: account.phone,
      status: account.status,
      licenseNumber: account.licenseNumber,
      licenseIssuingAuthority: account.licenseIssuingAuthority,
      licenseIssueDate: account.licenseIssueDate,
      licenseExpiryDate: account.licenseExpiryDate,
      pharmacistInChargeName: account.pharmacistInChargeName,
      submittedAt: verification?.submittedAt ?? null,
      slaTargetAt: verification?.slaTargetAt ?? null,
      reviewReason: verification?.reviewReason ?? null,
      licenseScan:
        scanUrl === null
          ? null
          : this.objectStorage.createTemporaryLink({
              storedUrl: scanUrl,
              bucket: ONBOARDING_DOCS_BUCKET,
              ttlSeconds: LICENSE_SCAN_LINK_TTL_SECONDS,
            }),
    }
  }
}
