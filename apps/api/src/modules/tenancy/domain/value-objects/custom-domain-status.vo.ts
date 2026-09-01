/**
 * `CustomDomainStatus` — состояние DNS-верификации кастомного домена
 * (`26-module-tenancy-whitelabel.md` §12 п.3, DTJ-051). Тенант резолвится по
 * `custom_domain` ТОЛЬКО при статусе `verified`; `pending_verification` — домен
 * указан, но DNS TXT ещё не подтверждён.
 */
export const CUSTOM_DOMAIN_STATUSES = ['none', 'pending_verification', 'verified'] as const

export type CustomDomainStatus = (typeof CUSTOM_DOMAIN_STATUSES)[number]

export class CustomDomainStatusVO {
  private constructor(public readonly value: CustomDomainStatus) {}

  static none(): CustomDomainStatusVO {
    return new CustomDomainStatusVO('none')
  }

  static pending(): CustomDomainStatusVO {
    return new CustomDomainStatusVO('pending_verification')
  }

  static verified(): CustomDomainStatusVO {
    return new CustomDomainStatusVO('verified')
  }

  static parse(raw: string): CustomDomainStatusVO {
    if (typeof raw !== 'string' || !CUSTOM_DOMAIN_STATUSES.includes(raw as CustomDomainStatus)) {
      throw new Error(`Invalid custom domain status: ${raw}`)
    }
    return new CustomDomainStatusVO(raw as CustomDomainStatus)
  }

  /** Резолвинг по домену разрешён ТОЛЬКО при `verified` (SRS-API-041 шаг 1, уточнение §12 п.3). */
  isResolvedByDomain(): boolean {
    return this.value === 'verified'
  }

  equals(other: CustomDomainStatusVO): boolean {
    return this.value === other.value
  }
}
