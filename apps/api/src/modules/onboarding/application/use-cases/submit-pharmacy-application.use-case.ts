/**
 * `SubmitPharmacyApplicationUseCase` (DTJ-065) — публичная подача заявки
 * конкретной аптечной точки (REQ-ONBOARD-2).
 *
 * Логика:
 * - `chainId` передан → заявка в существующую сеть.
 * - `chainId` НЕ передан (соло-аптека) → СНАЧАЛА `SubmitChainApplicationUseCase`
 *   с параметрами из dto (`legalEntityName` = name, `tinInn` обязателен, и т.д.),
 *   получаем `chainId` созданной сети, далее создаём `PharmacyAccount`.
 *
 * В обоих случаях — `PharmacyAccount.create(cmd, status='draft')` + `save()`.
 * Возвращает `{ id, chainId, status }` — DTO для presentation.
 */
import { Inject, Injectable } from '@nestjs/common'
import { ConflictException } from '@nestjs/common'
import {
  PharmacyAccount,
  type PharmacyAccountCreateCommand,
} from '@/modules/onboarding/domain/pharmacy-account.entity.js'
import type { PharmacyAccountRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-account.repository.port.js'
import { PHARMACY_ACCOUNT_REPOSITORY } from '@/modules/onboarding/application/ports/pharmacy-account.repository.port.js'
import { SubmitChainApplicationUseCase, type SubmitChainApplicationInput } from './submit-chain-application.use-case.js'

export interface SubmitPharmacyApplicationInput {
  readonly id: string
  readonly chainId: string | null
  /** Для соло-аптеки обязателен. */
  readonly tinInn: string | undefined
  readonly name: string
  readonly addressText: string
  readonly landmarkTj: string | null
  readonly latitude: number
  readonly longitude: number
  readonly phone: string
  readonly isOpen247: boolean
  readonly openingTime: string | null
  readonly closingTime: string | null
  readonly licenseNumber: string
  readonly licenseIssuingAuthority: string | null
  readonly licenseIssueDate: Date | null
  readonly licenseExpiryDate: Date
  readonly licenseScanUrl: string | null
  readonly pharmacistInChargeName: string
}

export interface SubmitPharmacyApplicationResult {
  readonly id: string
  readonly chainId: string
  readonly status: string
}

@Injectable()
export class SubmitPharmacyApplicationUseCase {
  constructor(
    @Inject(PHARMACY_ACCOUNT_REPOSITORY)
    private readonly pharmacyAccountRepository: PharmacyAccountRepositoryPort,
    // Явный @Inject: без него параметр не попадает в paramtypes и поле остаётся undefined
    // молча — бут не падает, TypeError прилетает на первом вызове (DTJ-001).
    @Inject(SubmitChainApplicationUseCase)
    private readonly submitChainApplication: SubmitChainApplicationUseCase,
  ) {}

  async execute(input: SubmitPharmacyApplicationInput): Promise<SubmitPharmacyApplicationResult> {
    const chainId = await this.resolveChainId(input)
    const cmd: PharmacyAccountCreateCommand = {
      id: input.id,
      chainId,
      name: input.name,
      addressText: input.addressText,
      latitude: input.latitude,
      longitude: input.longitude,
      phone: input.phone,
      licenseNumber: input.licenseNumber,
      licenseExpiryDate: input.licenseExpiryDate,
    }
    const account = PharmacyAccount.create(cmd)
    await this.pharmacyAccountRepository.save(account)
    return { id: account.id, chainId: account.chainId, status: account.status }
  }

  /** Соло-аптека: создаём PharmacyChain «на лету» через существующий use case. */
  private async resolveChainId(input: SubmitPharmacyApplicationInput): Promise<string> {
    if (input.chainId !== null) {
      return input.chainId
    }
    if (input.tinInn === undefined || input.tinInn.length === 0) {
      throw new ConflictException('tinInn is required for solo pharmacy application')
    }
    const chainInput: SubmitChainApplicationInput = {
      id: globalThis.crypto.randomUUID(),
      legalEntityName: input.name,
      tinInn: input.tinInn,
      directorFullName: input.pharmacistInChargeName,
      contactPhone: input.phone,
      legalAddress: input.addressText,
      isWhitelabelRequested: false,
    }
    const chainResult = await this.submitChainApplication.execute(chainInput)
    return chainResult.id
  }
}
