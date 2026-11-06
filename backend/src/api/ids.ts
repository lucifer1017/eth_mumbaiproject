import { ulid } from 'ulid'

export const newUserId         = (): string => `usr_${ulid()}`
export const newAgentId        = (): string => `agt_${ulid()}`
export const newPlanId         = (): string => `pln_${ulid()}`
export const newSubscriptionId = (): string => `sub_${ulid()}`
export const newInvoiceId      = (): string => `inv_${ulid()}`
export const newPayoutId       = (): string => `pay_${ulid()}`
export const newInvocationId   = (): string => `invk_${ulid()}`
export const newRunId          = (): string => `run_${ulid()}`
export const newWithdrawalId   = (): string => `wth_${ulid()}`
