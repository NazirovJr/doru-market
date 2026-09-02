/**
 * `CreateStaffAccountUseCase` (EP-01, DTJ-030, SRS-API-018/035/037) — создание
 * staff-аккаунта (`pharmacist`/`courier`/`pharmacy_admin`/`support_agent`/
 * `super_admin`) администратором сети или `super_admin`.
 *
 * Контракт:
 *   - `actor` — `JwtClaims` текущего аутентифицированного пользователя
 *     (из `@CurrentUser()` или передан явно в тестах).
 *   - `command.role` — целевая роль. `customer` НЕ допустим: самостоятельная
 *     регистрация (DTJ-022/023/024) — это другой use case.
 *   - `command.pharmacyId` / `command.chainId` — контекстные поля, проверяются
 *     через `StaffAccountPolicy.canCreate`.
 *
 * Алгоритм:
 *   1. `PhoneNumber.parse(command.phone)` — невалиден → `ValidationError`.
 *   2. `StaffAccountPolicy.canCreate(...)` — `false` → `403 FORBIDDEN`.
 *   3. `users.findByTenantAndPhone(actor.tenantId, phone)` — существует →
 *      `409 CONFLICT` (по `unique_phone_per_tenant`, но проверяем явно для
 *      осмысленного `details`).
 *   4. `users.create({ ... })` — создаёт staff-аккаунт.
 *   5. Возвращает `{ userId, role }`. `auth_session` НЕ создаётся — сотрудник
 *      входит сам через `/auth/otp/request` → `/auth/otp/verify` (т.е. новый
 *      staff может быть активирован в любое время, но СЕЙЧАС ему не выдан
 *      JWT, это делает VerifyOtpUseCase при ПЕРВОМ входе).
 *
 * `@RolesGuard` (DTJ-022) проверяет только `role ∈ ('pharmacy_admin',
 * 'super_admin')` — это ГРУБАЯ проверка. `StaffAccountPolicy` (DTJ-030)
 * делает ТОНКУЮ (ownership) — по `actor.chainId === target.chainId`. Оба
 * нужны (SRS-API-036): `RolesGuard` отсекает `customer`/`pharmacist`/
 * `courier`/etc. на уровне HTTP, `StaffAccountPolicy` не даёт
 * `pharmacy_admin` создать `courier` чужой сети.
 */
import { Inject, Injectable } from '@nestjs/common'
import {
  ConflictError,
  ForbiddenError,
  InvalidPhoneNumberFormatError,
  type UserRole,
} from '@dorutj/contracts'
import { err, isErr, ok, type Result } from '@dorutj/domain-kernel'
import { PhoneNumber } from '@/modules/auth/domain/value-objects/phone-number.vo.js'
import {
  StaffAccountPolicy,
  type StaffAccountPolicyActor,
  type StaffAccountPolicyTarget,
} from '@/modules/auth/application/policies/staff-account.policy.js'
import {
  USERS_REPOSITORY,
  type UsersRepository,
} from '@/modules/auth/application/ports/users.repository.port.js'
import { type JwtClaims } from '@/modules/auth/application/ports/jwt-signer.port.js'

export interface CreateStaffAccountCommand {
  readonly phone: string
  readonly fullName: string
  readonly role: UserRole
  readonly pharmacyId?: string | null
  readonly chainId?: string | null
}

export interface CreateStaffAccountResult {
  readonly userId: string
  readonly role: UserRole
}

@Injectable()
export class CreateStaffAccountUseCase {
  constructor(
    @Inject(USERS_REPOSITORY) private readonly users: UsersRepository,
  ) {}

  async execute(
    actor: JwtClaims,
    command: CreateStaffAccountCommand,
  ): Promise<Result<CreateStaffAccountResult, ForbiddenError | ConflictError | InvalidPhoneNumberFormatError>> {
    const phoneResult = this.parsePhone(command.phone)
    if (isErr(phoneResult)) {
      return err(phoneResult.error)
    }
    const phone = phoneResult.value

    const policyError = this.checkPolicy(actor, command)
    if (policyError !== null) {
      return err(policyError)
    }

    // `actor.tenantId` для `super_admin` может быть null; на этом шаге
    // запрещаем создание staff-аккаунтов супер-админом (R1: super_admin не
    // управляет тенантами через этот endpoint, для этого есть admin-API R2).
    if (actor.tenantId === null) {
      return err(
        new ForbiddenError('super_admin cannot create staff accounts via this endpoint', {
          actorRole: actor.role,
        }),
      )
    }

    const duplicateError = await this.checkDuplicatePhone(actor.tenantId, phone)
    if (duplicateError !== null) {
      return err(duplicateError)
    }

    const user = await this.users.create({
      tenantId: actor.tenantId,
      phoneNumber: phone.value,
      role: command.role,
      fullName: command.fullName,
      ...(command.pharmacyId !== undefined ? { pharmacyId: command.pharmacyId } : { pharmacyId: null }),
      ...(command.chainId !== undefined ? { chainId: command.chainId } : { chainId: null }),
    })

    return ok({ userId: user.id, role: user.role })
  }

  /** Шаг 1: валидация phone. */
  private parsePhone(rawPhone: string): Result<PhoneNumber, InvalidPhoneNumberFormatError> {
    try {
      return ok(PhoneNumber.parse(rawPhone))
    } catch {
      return err(new InvalidPhoneNumberFormatError({ field: 'phone' }))
    }
  }

  /** Шаг 2: проверка прав (ownership по chainId + role-based). */
  private checkPolicy(actor: JwtClaims, command: CreateStaffAccountCommand): ForbiddenError | null {
    const policyActor: StaffAccountPolicyActor = {
      role: actor.role,
      pharmacyId: actor.pharmacyId ?? null,
      chainId: actor.chainId ?? null,
    }
    const policyTarget: StaffAccountPolicyTarget = {
      role: command.role,
      chainId: command.chainId ?? null,
    }
    if (StaffAccountPolicy.canCreate(policyActor, policyTarget)) {
      return null
    }
    return new ForbiddenError(
      `actor.role="${actor.role}" (chain=${actor.chainId ?? '∅'}) cannot create ` +
        `role="${command.role}" (chain=${command.chainId ?? '∅'})`,
      {
        actorRole: actor.role,
        targetRole: command.role,
        actorChainId: actor.chainId,
        targetChainId: command.chainId,
      },
    )
  }

  /**
   * Шаг 3: проверка дубля phone (по `unique_phone_per_tenant` constraint —
   * проверяем явно для осмысленного ErrorEnvelope).
   */
  private async checkDuplicatePhone(tenantId: string, phone: PhoneNumber): Promise<ConflictError | null> {
    const existing = await this.users.findByTenantAndPhone(tenantId, phone.value)
    if (existing === null) {
      return null
    }
    return new ConflictError(`user with phone "${phone.value}" already exists in this tenant`, {
      resource: 'users',
      existingUserId: existing.id,
      conflictingField: 'phone',
    })
  }
}

