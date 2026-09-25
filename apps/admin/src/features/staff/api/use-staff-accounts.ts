// DTJ-364: useCreateStaffAccount — 2 HTTP-вызова (identity, затем provision-courier для
// role=courier); шаг 2 может упасть после успешного шага 1, см. StaffAccountCreatePartialError.
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { CreateStaffAccountRequestDto, StaffAccountRole, StaffAccountSummaryDto } from '@dorutj/contracts'
import { httpGetJsonWithMeta, httpPatchJson, httpPostJson, type HttpError, type QueryParams } from '@/shared/api/http-client'

const STAFF_ACCOUNTS_PATH = '/api/v1/staff-accounts'
const DEFAULT_LIMIT = 50

export interface StaffAccountsPageResult {
  readonly items: readonly StaffAccountSummaryDto[]
  readonly nextCursor: string | null
  readonly hasMore: boolean
}

async function fetchStaffAccountsPage(cursor: string | null, limit: number): Promise<StaffAccountsPageResult> {
  const params: QueryParams = { limit: String(limit), cursor: cursor ?? undefined, scope: 'own' }
  const result = await httpGetJsonWithMeta<readonly StaffAccountSummaryDto[]>(STAFF_ACCOUNTS_PATH, params)
  const pagination = result.meta?.pagination as { nextCursor: string | null; hasMore: boolean } | undefined
  return { items: result.data, nextCursor: pagination?.nextCursor ?? null, hasMore: pagination?.hasMore ?? false }
}

export function staffAccountsQueryKey(cursor: string | null): readonly unknown[] {
  return ['admin', 'staff-accounts', 'list', cursor] as const
}

export function useStaffAccounts(cursor: string | null, limit: number = DEFAULT_LIMIT): UseQueryResult<StaffAccountsPageResult, HttpError> {
  return useQuery<StaffAccountsPageResult, HttpError>({
    queryKey: staffAccountsQueryKey(cursor),
    queryFn: () => fetchStaffAccountsPage(cursor, limit),
  })
}

function invalidateStaffAccountsLists(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: ['admin', 'staff-accounts', 'list'] })
}

export function useDeactivateStaffAccount(): UseMutationResult<StaffAccountSummaryDto, HttpError, string> {
  const queryClient = useQueryClient()
  return useMutation<StaffAccountSummaryDto, HttpError, string>({
    mutationFn: (userId) => httpPatchJson<StaffAccountSummaryDto>(`${STAFF_ACCOUNTS_PATH}/${userId}`, { isActive: false }),
    onSuccess: () => { invalidateStaffAccountsLists(queryClient) },
  })
}

export class StaffAccountCreatePartialError extends Error {
  public constructor(
    public readonly userId: string,
    public readonly cause: HttpError,
  ) {
    super('Identity created, courier fleet provisioning failed')
    this.name = 'StaffAccountCreatePartialError'
  }
}

export interface CreateStaffAccountInput {
  readonly phone: string
  readonly fullName: string
  readonly role: StaffAccountRole
  readonly pharmacyId?: string | undefined
  readonly chainId: string
}

async function createStaffAccount(input: CreateStaffAccountInput): Promise<string> {
  const body: CreateStaffAccountRequestDto = {
    phone: input.phone,
    fullName: input.fullName,
    role: input.role,
    chainId: input.chainId,
    ...(input.role === 'pharmacist' ? { pharmacyId: input.pharmacyId ?? null } : { pharmacyId: null }),
  }
  const created = await httpPostJson<{ readonly userId: string; readonly role: StaffAccountRole }>(STAFF_ACCOUNTS_PATH, body)
  if (input.role === 'courier') {
    try {
      await httpPostJson(`${STAFF_ACCOUNTS_PATH}/${created.userId}/provision-courier`, {})
    } catch (error) {
      throw new StaffAccountCreatePartialError(created.userId, error as HttpError)
    }
  }
  return created.userId
}

export function useCreateStaffAccount(): UseMutationResult<string, HttpError | StaffAccountCreatePartialError, CreateStaffAccountInput> {
  const queryClient = useQueryClient()
  return useMutation<string, HttpError | StaffAccountCreatePartialError, CreateStaffAccountInput>({
    mutationFn: createStaffAccount,
    onSuccess: () => { invalidateStaffAccountsLists(queryClient) },
    onError: (error) => { // частичный отказ уже создал users-строку — обновляем список
      if (error instanceof StaffAccountCreatePartialError) {
        invalidateStaffAccountsLists(queryClient)
      }
    },
  })
}

export function useProvisionCourierRetry(): UseMutationResult<unknown, HttpError, string> {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, string>({
    mutationFn: (userId) => httpPostJson(`${STAFF_ACCOUNTS_PATH}/${userId}/provision-courier`, {}),
    onSuccess: () => { invalidateStaffAccountsLists(queryClient) },
  })
}

export type { HttpError }
