// pharmacyId — из токена (не query): скоуп доступа принудительный, чужой pharmacyId в query игнорируется.
import { Controller, Get, HttpException, HttpStatus, Inject, Query, UseGuards } from '@nestjs/common'
import {
  ErrorCode,
  InvalidCursorError,
  ValidationError,
  decodeCursor,
  encodeCursor,
  fail,
  ok,
  pharmacyInventoryListQuerySchema,
  type PaginationMeta,
  type PharmacyInventoryItemDto,
} from '@dorutj/contracts'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import {
  ListPharmacyInventoryUseCase,
  type ListPharmacyInventoryResult,
} from '@/modules/inventory/application/use-cases/list-pharmacy-inventory.use-case.js'
import type { PharmacyInventoryListRow } from '@/modules/inventory/application/ports/pharmacy-inventory.repository.port.js'

interface ParsedCursor {
  readonly tradeName: string
  readonly id: string
}

function parseListQuery(rawQuery: Record<string, string | undefined>): {
  readonly limit: number
  readonly q: string | null
  readonly cursor: ParsedCursor | null
} {
  const parsed = pharmacyInventoryListQuerySchema.safeParse(rawQuery)
  if (!parsed.success) {
    throw new ValidationError('Invalid inventory list query parameters', { issues: parsed.error.issues })
  }
  const { limit, cursor: rawCursor, 'filter[q]': q } = parsed.data
  const cursor = rawCursor === undefined ? null : decodeListCursor(rawCursor)
  return { limit, q: q ?? null, cursor }
}

function decodeListCursor(raw: string): ParsedCursor {
  const decoded = decodeCursor(raw)
  if (decoded === null || typeof decoded.v !== 'string') {
    throw new InvalidCursorError(`Cannot decode cursor: "${raw}"`, { raw })
  }
  return { tradeName: decoded.v, id: decoded.id }
}

function requirePharmacyId(claims: JwtClaims): string {
  if (claims.pharmacyId === null) {
    throw new HttpException(
      fail(ErrorCode.VALIDATION_ERROR, 'acting user has no associated pharmacy to list inventory for', {
        field: 'pharmacyId',
      }),
      HttpStatus.BAD_REQUEST,
    )
  }
  return claims.pharmacyId
}

function toItemDto(row: PharmacyInventoryListRow): PharmacyInventoryItemDto {
  return {
    inventoryId: row.inventoryId,
    medicineId: row.medicineId,
    tradeName: row.tradeName,
    dosageForm: row.dosageForm,
    dosageStrength: row.dosageStrength,
    priceDiram: row.priceDiram,
    stockQuantity: row.stockQuantity,
    batchNumber: row.batchNumber,
    expiryDate: row.expiryDate,
    lastSyncedAt: row.lastSyncedAt.toISOString(),
  }
}

function toPagination(result: ListPharmacyInventoryResult, limit: number): PaginationMeta {
  return {
    nextCursor: result.nextCursor === null ? null : encodeCursor({ v: result.nextCursor.tradeName, id: result.nextCursor.id }),
    hasMore: result.hasMore,
    limit,
  }
}

@Controller({ path: 'inventory', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('pharmacist', 'pharmacy_admin')
export class InventoryListController {
  constructor(
    @Inject(ListPharmacyInventoryUseCase)
    private readonly listInventory: ListPharmacyInventoryUseCase,
  ) {}

  @Get()
  async list(@Query() rawQuery: Record<string, string | undefined>, @CurrentUser() claims: JwtClaims): Promise<unknown> {
    const pharmacyId = requirePharmacyId(claims)
    const { limit, q, cursor } = parseListQuery(rawQuery)
    const result = await this.listInventory.execute({ pharmacyId, q, cursor, limit })
    return ok(result.items.map(toItemDto), { pagination: toPagination(result, limit) })
  }
}
