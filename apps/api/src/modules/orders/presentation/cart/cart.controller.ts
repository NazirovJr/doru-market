/**
 * `CartController` (EP-09, DTJ-226, SRS-ORD-002/010/012/013, SRS-API-001..015) — REST-вход в
 * корзину. Четыре маршрута из тикета, все под `@Public()` + `CartIdentityGuard` (не
 * `AuthGuard`, EP-01 — гость имеет право на корзину без логина, см. JSDoc guard'а):
 *
 *   - `GET    /api/v1/cart?extendHold=true`
 *   - `POST   /api/v1/cart/items { medicineId, pharmacyId, quantity }`
 *   - `PATCH  /api/v1/cart/items/:id { quantity }`
 *   - `DELETE /api/v1/cart/items/:id`
 *
 * Presentation НЕ ходит в репозиторий (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2) — каждый
 * хендлер сначала резолвит/создаёт корзину через `ResolveOrCreateCartUseCase` (D-EP09-22, эта
 * связка отсутствовала во ВСЕХ четырёх use case'ах DTJ-223..225 — они принимают готовый
 * `cartId` и никогда не создают строку `cart`), затем передаёт `cart.id` в соответствующий
 * use case DTJ-223/224/225. Ни один из них тенант не резолвит сам (SRS-API-043) — `tenantId`
 * берётся ИЗ `TenantContext` (`TenantResolutionMiddleware`+`TenantScopeGuard`, глобальные,
 * гарантируют резолвленный тенант ДО presentation) и передаётся вниз ЯВНЫМ параметром,
 * ровно как того требует D-EP09-24.
 *
 * `X-Cart-Session-Token` (ответ) — `applyIssuedSessionToken` ставит заголовок ТОЛЬКО когда
 * `ResolveOrCreateCartUseCase` реально выдал НОВЫЙ токен (первый визит гостя, D-EP09-23);
 * клиент обязан сохранить и предъявлять его тем же заголовком на все следующие запросы.
 *
 * AC3 тикета называет код `CONTROLLED_SUBSTANCE_NOT_ORDERABLE` — в `packages/contracts/src/
 * errors.ts`/`domain-errors.ts` (владелец EP-01, единственный источник каталога кодов, правило
 * 3 AGENTS.md — не выдумывать несуществующие коды) фактическое имя ошибки
 * `ControlledSubstanceNotOrderableError` уже маппится на `CONTROLLED_SUBSTANCE_FORBIDDEN`
 * (422) — используется РЕАЛЬНЫЙ код, ticket-текст неточен (foundIssues отчёта сдачи).
 *
 * `DELETE .../items/:id` — 204 БЕЗУСЛОВНО (успех/не найдено не различаются в ответе):
 * `RemoveCartItemUseCase` спроектирован идемпотентным (JSDoc use case'а, DTJ-223) — то же
 * решение, что `SessionsController.revokeSession`/`logout` (EP-01).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common'
import { type FastifyReply } from 'fastify'
import { ErrorCode, NotFoundError, ok, type ErrorEnvelope, type SuccessEnvelope } from '@dorutj/contracts'
import { Public } from '@/common/decorators/public.decorator.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import {
  ResolveOrCreateCartUseCase,
  type CartIdentity as CartIdentityInput,
} from '@/modules/orders/application/cart/resolve-or-create-cart.use-case.js'
import { GetCartUseCase } from '@/modules/orders/application/cart/get-cart.use-case.js'
import { ExtendCartHoldUseCase } from '@/modules/orders/application/cart/extend-cart-hold.use-case.js'
import { AddCartItemUseCase } from '@/modules/orders/application/cart/add-cart-item.use-case.js'
import {
  UpdateCartItemQuantityUseCase,
  type UpdateCartItemQuantityResult,
} from '@/modules/orders/application/cart/update-cart-item-quantity.use-case.js'
import { RemoveCartItemUseCase } from '@/modules/orders/application/cart/remove-cart-item.use-case.js'
import { CartIdentityGuard, SESSION_TOKEN_HEADER } from './guards/cart-identity.guard.js'
import { CartIdentity } from './decorators/cart-identity.decorator.js'
import {
  CartItemQuantityRequestSchema,
  CartItemRequestSchema,
  type CartItemQuantityRequestDto,
  type CartItemRequestDto,
} from './dto/cart-item-request.dto.js'
import {
  toCartItemRecordResponseDto,
  toCartViewMetaDto,
  toCartViewResponseDto,
  toDuplicateSubstanceWarningDto,
} from './cart-view.mapper.js'

const UUID_PIPE = new ParseUUIDPipe({ version: '4' })
const HTTP_NO_CONTENT = 204
const EXTEND_HOLD_TRUE = 'true'

@Controller({ path: 'cart', version: '1' })
@Public()
@UseGuards(CartIdentityGuard)
export class CartController {
  // eslint-disable-next-line max-params -- 6 use case'ов корзины (5 из DTJ-223/224/225 + ResolveOrCreateCartUseCase этого тикета) — контроллер единственная REST-точка входа ко всем; тот же приём, что InventoryBatchUpdateController/SessionsController (явные @Inject-параметры вместо скрывающей DI-графа фабрики).
  constructor(
    @Inject(ResolveOrCreateCartUseCase) private readonly resolveOrCreateCart: ResolveOrCreateCartUseCase,
    // Явный @Inject на КАЖДОМ параметре — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
    @Inject(GetCartUseCase) private readonly getCart: GetCartUseCase,
    @Inject(ExtendCartHoldUseCase) private readonly extendCartHold: ExtendCartHoldUseCase,
    @Inject(AddCartItemUseCase) private readonly addCartItem: AddCartItemUseCase,
    @Inject(UpdateCartItemQuantityUseCase) private readonly updateCartItemQuantity: UpdateCartItemQuantityUseCase,
    @Inject(RemoveCartItemUseCase) private readonly removeCartItem: RemoveCartItemUseCase,
  ) {}

  @Get()
  async getCartView(
    @CartIdentity() identity: CartIdentityInput,
    @Query('extendHold') extendHoldRaw: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SuccessEnvelope<unknown> | ErrorEnvelope> {
    const tenantId = resolveTenantId()
    const { cart, issuedSessionToken } = await this.resolveOrCreateCart.execute(tenantId, identity)
    applyIssuedSessionToken(reply, issuedSessionToken)
    if (extendHoldRaw === EXTEND_HOLD_TRUE) {
      // AC4: холды продлеваются ДО сборки ответа — порядок вызовов, не только результат.
      await this.extendCartHold.execute(tenantId, cart.id)
    }
    const view = await this.getCart.execute(tenantId, cart.id)
    return ok(toCartViewResponseDto(view), toCartViewMetaDto(view))
  }

  @Post('items')
  @HttpCode(HttpStatus.Created)
  async addItem(
    @CartIdentity() identity: CartIdentityInput,
    @Body(new ZodValidationPipe(CartItemRequestSchema)) body: CartItemRequestDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SuccessEnvelope<unknown> | ErrorEnvelope> {
    const tenantId = resolveTenantId()
    const { cart, issuedSessionToken } = await this.resolveOrCreateCart.execute(tenantId, identity)
    applyIssuedSessionToken(reply, issuedSessionToken)
    const result = await this.addCartItem.execute({ tenantId, cartId: cart.id, ...body })
    if (!result.ok) {
      throw result.error
    }
    return ok(toCartItemRecordResponseDto(result.value.item), {
      warnings: result.value.warnings.map(toDuplicateSubstanceWarningDto),
    })
  }

  // eslint-disable-next-line max-params -- 4 HTTP-параметра (:id, identity, тело, reply), каждый со своим Nest-декоратором (@Param/@CartIdentity/@Body/@Res) — параметры handler'а не сворачиваются в объект-обёртку, Nest резолвит их позиционно по декоратору.
  @Patch('items/:id')
  async updateItemQuantity(
    @Param('id', UUID_PIPE) cartItemId: string,
    @CartIdentity() identity: CartIdentityInput,
    @Body(new ZodValidationPipe(CartItemQuantityRequestSchema)) body: CartItemQuantityRequestDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SuccessEnvelope<unknown> | ErrorEnvelope> {
    const tenantId = resolveTenantId()
    const { cart, issuedSessionToken } = await this.resolveOrCreateCart.execute(tenantId, identity)
    applyIssuedSessionToken(reply, issuedSessionToken)
    const result = await this.updateCartItemQuantity.execute({
      tenantId,
      cartId: cart.id,
      cartItemId,
      quantity: body.quantity,
    })
    return toUpdateQuantityResponse(result, cartItemId)
  }

  @Delete('items/:id')
  @HttpCode(HTTP_NO_CONTENT)
  async removeItem(
    @Param('id', UUID_PIPE) cartItemId: string,
    @CartIdentity() identity: CartIdentityInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SuccessEnvelope<null> | ErrorEnvelope> {
    const tenantId = resolveTenantId()
    const { cart, issuedSessionToken } = await this.resolveOrCreateCart.execute(tenantId, identity)
    applyIssuedSessionToken(reply, issuedSessionToken)
    await this.removeCartItem.execute(tenantId, cart.id, cartItemId)
    return ok(null)
  }
}

function toUpdateQuantityResponse(
  result: UpdateCartItemQuantityResult,
  cartItemId: string,
): SuccessEnvelope<unknown> {
  if (result.kind === 'not_found') {
    // SRS-API-046: чужой/несуществующий ресурс — 404, не подтверждаем существование.
    throw new NotFoundError({ resource: 'cartItem', cartItemId })
  }
  if (result.kind === 'removed') {
    return ok({ removed: true })
  }
  return ok(toCartItemRecordResponseDto(result.item))
}

function applyIssuedSessionToken(reply: FastifyReply, issuedSessionToken: string | null): void {
  if (issuedSessionToken !== null) {
    reply.header(SESSION_TOKEN_HEADER, issuedSessionToken)
  }
}

/** 1:1 с `pharmacies-map.controller.ts`/`catalog-search.controller.ts` — `TenantScopeGuard`
 *  (глобальный `APP_GUARD`) уже отверг нерезолвленный тенант ДО того, как запрос дошёл сюда. */
function resolveTenantId(): string {
  const store = TenantContext.get()
  if (store?.tenantId === undefined || store.tenantId === null) {
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'tenant context not resolved (TenantScopeGuard should have rejected earlier)',
    })
  }
  return store.tenantId
}
