/**
 * `SubmitChainApplicationUseCase` (DTJ-064) — публичная подача заявки сети
 * (REQ-ONBOARD-3/4, без JWT).
 *
 * Логика:
 * - `pharmacyChainRepository.findByTinInn(tinInn)` — резолв существующей заявки
 *   (REQ-ONBOARD-19, SRS-ADM-007).
 * - Не найдено → `PharmacyChain.create(dto)` + `save()`.
 * - Найдено со `status='rejected'` → `updateApplication` (сброс `submittedAt`).
 * - Найдено в ЛЮБОМ другом статусе → `ChainApplicationAlreadyExistsError` (409).
 *
 * Возвращает `{ id, status }` — DTO-проекция для presentation слоя.
 */
import { Inject, Injectable } from '@nestjs/common'
import { PharmacyChain, type PharmacyChainCreateCommand } from '../../domain/pharmacy-chain.entity.js'
import { type PharmacyChainRepositoryPort } from '../ports/pharmacy-chain.repository.port.js'
import { ChainApplicationAlreadyExistsError } from '../../domain/errors/chain-application-already-exists.error.js'
import { PHARMACY_CHAIN_REPOSITORY } from '../ports/pharmacy-chain.repository.port.js'

export interface SubmitChainApplicationInput {
  readonly id: string
  readonly legalEntityName: string
  readonly tinInn: string
  readonly directorFullName: string
  readonly contactPhone: string
  readonly legalAddress: string | null
  readonly isWhitelabelRequested: boolean
}

export interface SubmitChainApplicationResult {
  readonly id: string
  readonly status: string
}

@Injectable()
export class SubmitChainApplicationUseCase {
  constructor(
    @Inject(PHARMACY_CHAIN_REPOSITORY)
    private readonly pharmacyChainRepository: PharmacyChainRepositoryPort,
  ) {}

  async execute(input: SubmitChainApplicationInput): Promise<SubmitChainApplicationResult> {
    const existing = await this.pharmacyChainRepository.findByTinInn(input.tinInn)
    if (existing !== null) {
      return this.handleExisting(existing, input)
    }
    return this.createNew(input)
  }

  private async createNew(input: SubmitChainApplicationInput): Promise<SubmitChainApplicationResult> {
    const cmd: PharmacyChainCreateCommand = {
      id: input.id,
      name: input.legalEntityName,
      legalEntityName: input.legalEntityName,
      tinInn: input.tinInn,
      directorFullName: input.directorFullName,
      contactPhone: input.contactPhone,
      legalAddress: input.legalAddress,
      isWhitelabelRequested: input.isWhitelabelRequested,
    }
    const chain = PharmacyChain.create(cmd)
    await this.pharmacyChainRepository.save(chain)
    return { id: chain.id, status: chain.status }
  }

  private async handleExisting(
    existing: PharmacyChain,
    input: SubmitChainApplicationInput,
  ): Promise<SubmitChainApplicationResult> {
    if (existing.status === 'rejected') {
      // SRS-ADM-007: повторная подача переиспользует запись, сбрасывает submittedAt.
      const updated = existing.updateApplication({
        legalEntityName: input.legalEntityName,
        directorFullName: input.directorFullName,
        contactPhone: input.contactPhone,
        legalAddress: input.legalAddress,
        isWhitelabelRequested: input.isWhitelabelRequested,
      })
      await this.pharmacyChainRepository.save(updated)
      return { id: updated.id, status: updated.status }
    }
    throw new ChainApplicationAlreadyExistsError(input.tinInn, existing.status)
  }
}
