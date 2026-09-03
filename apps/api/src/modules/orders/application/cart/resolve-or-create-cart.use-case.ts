/**
 * `ResolveOrCreateCartUseCase` (EP-09, DTJ-226, D-EP09-22/D-EP09-23) — резолвит корзину
 * текущего клиента (аутентифицированного `customer` по `customerId`, либо гостя по
 * `sessionToken`) или создаёт её при первом обращении. Presentation (`CartController`)
 * вызывает это ПЕРЕД любым из четырёх use case'ов DTJ-223..225 — ни один из них корзину не
 * создаёт (D-EP09-22, `reports/EP09-CTO-BRIEF.md`), только принимает готовый `cartId`.
 *
 * Три исхода `identity`:
 *   1. `customerId !== null` (валидный Bearer JWT) — `findOrCreateByCustomerId`. Идемпотентно
 *      под гонкой (`CartIdentityRepository`, advisory lock + `UNIQUE`-индекс `0026_cart_
 *      identity_unique.sql`) — два одновременных `POST` одного залогиненного клиента дают
 *      ОДНУ корзину.
 *   2. `customerId === null`, `sessionToken !== null`, и под этим значением УЖЕ существует
 *      корзина (клиент предъявил ранее выданный сервером токен, заголовок
 *      `X-Cart-Session-Token`) — `findBySessionToken` резолвит её, `issuedSessionToken: null`
 *      (клиент уже владеет этим значением, переиздавать не нужно).
 *   3. Гость без токена ЛИБО с токеном, под которым корзины нет (протухла — TTL брошенных
 *      корзин, DTJ-224; либо строка произвольная/угаданная) — **правка приёмки CTO
 *      (session fixation, устраняет ложное свойство безопасности, заявленное в предыдущей
 *      версии JSDoc `CartIdentityGuard`)**: клиентское значение НЕ становится ключом строки
 *      `cart` — сервер генерирует НОВЫЙ криптостойкий токен (`crypto.randomBytes`, не
 *      `Math.random()` — правило 6 AGENTS.md; `application`-слой, не `domain`, поэтому прямой
 *      `node:crypto` разрешён — тот же приём, что `RefreshTokenUseCase`/
 *      `crypto-refresh-token-generator.adapter.ts`, EP-01, 32 байта = та же энтропия) и
 *      создаёт корзину ПОД НИМ. Иначе пространство `session_token` контролировал бы клиент:
 *      любой, кто отправит `X-Cart-Session-Token: 1`, получил бы (или создал бы, и тем самым
 *      «застолбил» для последующего угадывания кем угодно) корзину с медицинскими данными —
 *      содержимым конкретного человека, — адресуемую коротким предсказуемым значением.
 *      `issuedSessionToken` — сигнал вызывающему вернуть НОВОЕ значение клиенту (заголовок
 *      ответа), чтобы он мог предъявить его в следующий раз; отправленное клиентом «протухшее»
 *      значение полностью отбрасывается, не переиспользуется ни для поиска, ни для записи.
 */
import { randomBytes } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import {
  CART_IDENTITY_REPOSITORY,
  type CartIdentityRepository,
} from './ports/cart-identity.repository.port.js'
import type { CartRecord } from './ports/cart.repository.port.js'

/** Та же энтропия, что `crypto-refresh-token-generator.adapter.ts` (EP-01, DTJ-025): 256 бит. */
const SESSION_TOKEN_BYTES = 32

export interface CartIdentity {
  readonly customerId: string | null
  readonly sessionToken: string | null
}

export interface ResolveOrCreateCartResult {
  readonly cart: CartRecord
  /** Не `null` ТОЛЬКО когда для гостя сгенерирован НОВЫЙ токен — вызывающий обязан вернуть
   *  его клиенту (presentation, заголовок ответа), иначе следующий запрос снова «первый». */
  readonly issuedSessionToken: string | null
}

@Injectable()
export class ResolveOrCreateCartUseCase {
  constructor(
    @Inject(CART_IDENTITY_REPOSITORY) private readonly cartIdentityRepository: CartIdentityRepository,
  ) {}

  async execute(tenantId: string, identity: CartIdentity): Promise<ResolveOrCreateCartResult> {
    if (identity.customerId !== null) {
      const cart = await this.cartIdentityRepository.findOrCreateByCustomerId(tenantId, identity.customerId)
      return { cart, issuedSessionToken: null }
    }

    const existing =
      identity.sessionToken === null
        ? null
        : await this.cartIdentityRepository.findBySessionToken(tenantId, identity.sessionToken)
    if (existing !== null) {
      return { cart: existing, issuedSessionToken: null }
    }

    // Клиентское значение (отсутствующее ИЛИ не резолвнувшееся) отброшено целиком — новая
    // корзина создаётся ТОЛЬКО под сервер-сгенерированным токеном (см. JSDoc выше, исход №3).
    const issuedSessionToken = randomBytes(SESSION_TOKEN_BYTES).toString('base64url')
    const cart = await this.cartIdentityRepository.findOrCreateBySessionToken(tenantId, issuedSessionToken)
    return { cart, issuedSessionToken }
  }
}
