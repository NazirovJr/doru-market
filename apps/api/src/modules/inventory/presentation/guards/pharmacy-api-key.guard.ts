/**
 * `PharmacyApiKeyGuard` (EP-05, DTJ-156, SRS-API-033, D-11).
 *
 * Извлекает 4 заголовка `X-Pharmacy-*` + опциональный
 * `X-SSL-Client-Verify`, читает `rawBody` (Fastify обязан сохранять
 * `rawBody` — TODO(EP-19) координировать с EP-01), вызывает
 * `PharmacyApiKeyVerificationPort`. При успехе прокидывает
 * `request.principal = { type: 'pharmacy_system', pharmacyId, chainId }`.
 *
 * **Разделение ответственности (DTJ-156 §5):** проверка
 * `pharmacy_guid` ∈ `chainId.pharmacies` — ответственность
 * КОНТРОЛЛЕРА (DTJ-157) после Zod-валидации тела. Здесь тело ещё не
 * распарсено; guard прокидывает `chainId` для последующей проверки.
 */
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import {
  PHARMACY_API_KEY_VERIFICATION,
  type PharmacyApiKeyVerificationInput,
  type PharmacyApiKeyVerificationPort,
} from '../../application/ports/pharmacy-api-key-verification.port.js'
import {
  MtlsRequiredError,
  PharmacyApiKeyInvalidError,
  PharmacyApiKeyVerificationError,
  PharmacyRequestReplayedError,
  PharmacySignatureInvalidError,
  PharmacyTimestampOutOfWindowError,
} from '@dorutj/contracts'

/** Принципал, прокидываемый в `request.principal`. */
export interface PharmacySystemPrincipal {
  readonly type: 'pharmacy_system'
  readonly pharmacyId: string
  readonly chainId: string | null
}

/** Расширение FastifyRequest под наш принципал. */
export interface FastifyRequestWithPrincipal extends FastifyRequest {
  principal?: PharmacySystemPrincipal
  rawBody?: Buffer
}

@Injectable()
export class PharmacyApiKeyGuard implements CanActivate {
  constructor(
    @Inject(PHARMACY_API_KEY_VERIFICATION)
    private readonly verifier: PharmacyApiKeyVerificationPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequestWithPrincipal>()
    const headers = req.headers
    const keyIdHeader = this.headerToString(headers['x-pharmacy-api-key'])
    const timestamp = this.headerToString(headers['x-pharmacy-timestamp'])
    const nonce = this.headerToString(headers['x-pharmacy-nonce'])
    const signature = this.headerToString(headers['x-pharmacy-signature'])
    const mtls = this.headerToString(headers['x-ssl-client-verify'])

    if (keyIdHeader === null || timestamp === null || nonce === null || signature === null) {
      throw new UnauthorizedException('Missing X-Pharmacy-* headers')
    }

    const dotIndex = keyIdHeader.indexOf('.')
    if (dotIndex <= 0 || dotIndex === keyIdHeader.length - 1) {
      // Невалидный формат `keyId.secret` — единая ошибка
      // (не раскрываем, что именно).
      throw new UnauthorizedException('Invalid X-Pharmacy-API-Key format')
    }
    const keyId = keyIdHeader.slice(0, dotIndex)
    const secret = keyIdHeader.slice(dotIndex + 1)

    const rawBody = req.rawBody ?? Buffer.alloc(0)
    const input: PharmacyApiKeyVerificationInput = {
      keyId,
      secret,
      timestamp,
      nonce,
      signature,
      method: req.method,
      path: req.url,
      rawBody,
      mtlsVerifiedHeader: mtls === null ? undefined : mtls,
    }

    try {
      const result = await this.verifier.verify(input)
      req.principal = {
        type: 'pharmacy_system',
        pharmacyId: result.pharmacyId,
        chainId: result.chainId,
      }
      return true
    } catch (error) {
      throw this.mapToUnauthorized(error)
    }
  }

  private mapToUnauthorized(error: unknown): UnauthorizedException {
    if (error instanceof PharmacyApiKeyVerificationError) {
      // Тип не важен для `UnauthorizedException` — все они 401.
      // Конкретный `code` приходит в ответе через
      // `TransportExceptionFilter` (TODO: подключить маппинг).
      void error
      return new UnauthorizedException(error.message)
    }
    if (
      error instanceof PharmacyApiKeyInvalidError ||
      error instanceof MtlsRequiredError ||
      error instanceof PharmacyTimestampOutOfWindowError ||
      error instanceof PharmacyRequestReplayedError ||
      error instanceof PharmacySignatureInvalidError
    ) {
      return new UnauthorizedException(error.message)
    }
    return new UnauthorizedException('Pharmacy authentication failed')
  }

  private headerToString(value: string | string[] | undefined): string | null {
    if (value === undefined) return null
    if (Array.isArray(value)) return value[0] ?? null
    return value
  }
}
