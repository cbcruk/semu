import type { Id } from '../../shared/ids/ids.types.ts'
import type { Plan } from '../identity-access/actor.types.ts'
import { DEMO_COMPANY_IDS, DEMO_PLANS } from '../identity-access/identity-access.public.ts'
import type { BillingMandateRecord } from './mandates/billing-mandate.ts'
import type { PaymentRecord } from './payments/payment.ts'
import type { ServiceContractRecord } from './service-contracts/service-contract.ts'
import type { SubscriptionRecord } from './subscriptions/subscription.ts'

const CREATED_AT = '2025-01-02T00:00:00.000Z'
const MONTHLY_FEE: Record<Plan, number> = { TAXATION: 385000, PAYROLL: 330000 }

/** 데모 서비스 계약 ID입니다. */
export const DEMO_SERVICE_CONTRACT_IDS = {
  corporationBookkeeping: 'svc_01JBQ000000000000000000001' as Id<'serviceContract'>,
  corporationInsurance: 'svc_01JBQ000000000000000000002' as Id<'serviceContract'>,
  individualBookkeeping: 'svc_01JBQ000000000000000000003' as Id<'serviceContract'>,
} as const

/** 데모 결제 수단(CMS 출금 동의) ID입니다. */
export const DEMO_MANDATE_ID = 'mdt_01JBQ000000000000000000001' as Id<'billingMandate'>

/** 데모 결제 ID입니다. */
export const DEMO_PAYMENT_IDS = {
  failed: 'pay_01JBQ000000000000000000002' as Id<'payment'>,
  paid: 'pay_01JBQ000000000000000000003' as Id<'payment'>,
  scheduled: 'pay_01JBQ000000000000000000004' as Id<'payment'>,
  tax: 'pay_01JBQ000000000000000000005' as Id<'payment'>,
} as const

function subscriptionId(index: number): Id<'subscription'> {
  return `sub_01JBQ0000000000000000000${String(index).padStart(2, '0')}` as Id<'subscription'>
}

/**
 * 데모 구독입니다. Identity & Access의 `DEMO_PLANS`와 같은 플랜을 주도록 만듭니다.
 *
 * 무료 회사에는 2025년에 끝난 급여 구독을 하나 두어 `ENDED` 상태를 볼 수 있게 합니다.
 */
export function demoSubscriptions(): SubscriptionRecord[] {
  const contractOf = (companyId: Id<'company'>, plan: Plan): Id<'serviceContract'> | undefined =>
    plan !== 'TAXATION'
      ? undefined
      : companyId === DEMO_COMPANY_IDS.corporation
        ? DEMO_SERVICE_CONTRACT_IDS.corporationBookkeeping
        : companyId === DEMO_COMPANY_IDS.individual
          ? DEMO_SERVICE_CONTRACT_IDS.individualBookkeeping
          : undefined
  const active = DEMO_PLANS.flatMap(([companyId, plans]) => plans.map((plan) => ({ companyId, plan })))
  const rows: SubscriptionRecord[] = active.map(({ companyId, plan }, index) => ({
    id: subscriptionId(index + 1),
    companyId,
    plan,
    status: 'ACTIVE',
    startsOn: '2025-01-01',
    monthlyFee: MONTHLY_FEE[plan],
    serviceContractId: contractOf(companyId, plan),
    createdAt: CREATED_AT,
    version: 1,
  }))
  rows.push({
    id: subscriptionId(rows.length + 1),
    companyId: DEMO_COMPANY_IDS.free,
    plan: 'PAYROLL',
    status: 'ENDED',
    startsOn: '2025-01-01',
    endsOn: '2025-06-30',
    monthlyFee: MONTHLY_FEE.PAYROLL,
    createdAt: CREATED_AT,
    version: 2,
  })
  return rows
}

/** 데모 결제 수단입니다. 법인 회사에 등록된 CMS 출금 동의가 하나 있습니다. */
export function demoMandates(): BillingMandateRecord[] {
  return [
    {
      id: DEMO_MANDATE_ID,
      companyId: DEMO_COMPANY_IDS.corporation,
      bankCode: '088',
      accountNumberMasked: '*********4321',
      accountHolder: '주식회사 알프레드',
      source: 'ONLINE',
      status: 'REGISTERED',
      gatewayReference: 'cms-demo-0001',
      createdAt: CREATED_AT,
      registeredAt: CREATED_AT,
    },
  ]
}

/** 데모 결제입니다. 법인 회사의 급여 아웃소싱 결제 내역(완료·실패·완료·예정)과 목록에 보이지 않는 세무 결제 한 건입니다. */
export function demoPayments(): PaymentRecord[] {
  const payrollSubscription = demoSubscriptions().find(
    (row) => row.companyId === DEMO_COMPANY_IDS.corporation && row.plan === 'PAYROLL',
  )?.id as Id<'subscription'>
  const taxSubscription = demoSubscriptions().find(
    (row) => row.companyId === DEMO_COMPANY_IDS.corporation && row.plan === 'TAXATION',
  )?.id as Id<'subscription'>
  const base = {
    companyId: DEMO_COMPANY_IDS.corporation,
    subscriptionId: payrollSubscription,
    plan: 'PAYROLL' as const,
    amount: MONTHLY_FEE.PAYROLL,
    mandateId: DEMO_MANDATE_ID,
    createdAt: CREATED_AT,
    version: 1,
  }
  return [
    {
      ...base,
      id: 'pay_01JBQ000000000000000000001' as Id<'payment'>,
      number: 1001,
      scheduledOn: '2026-08-25',
      status: 'PAID',
      settledAt: '2026-08-26T06:00:00.000Z',
    },
    {
      ...base,
      id: DEMO_PAYMENT_IDS.failed,
      number: 1002,
      scheduledOn: '2026-09-25',
      status: 'FAILED',
      failureReason: 'INSUFFICIENT_BALANCE',
    },
    {
      ...base,
      id: DEMO_PAYMENT_IDS.paid,
      number: 1004,
      scheduledOn: '2026-10-26',
      status: 'PAID',
      settledAt: '2026-10-27T06:00:00.000Z',
    },
    { ...base, id: DEMO_PAYMENT_IDS.scheduled, number: 1006, scheduledOn: '2026-11-25', status: 'SCHEDULED' },
    {
      ...base,
      id: DEMO_PAYMENT_IDS.tax,
      number: 1005,
      subscriptionId: taxSubscription,
      plan: 'TAXATION',
      amount: MONTHLY_FEE.TAXATION,
      scheduledOn: '2026-10-26',
      status: 'PAID',
      settledAt: '2026-10-27T06:00:00.000Z',
    },
  ]
}

/** 데모 서비스 계약입니다. 세무 기장 고객인 법인·개인 회사의 수임 계약과 법인의 4대보험 업무대행 동의입니다. */
export function demoServiceContracts(): ServiceContractRecord[] {
  return [
    {
      id: DEMO_SERVICE_CONTRACT_IDS.corporationBookkeeping,
      companyId: DEMO_COMPANY_IDS.corporation,
      type: 'BOOKKEEPING',
      form: 'ONLINE',
      status: 'ACTIVE',
      monthlyFee: 350000,
      adjustmentFeeMonth: 3,
      startsOn: '2025-01-01',
      termMonths: 12,
      autoRenew: true,
      signedAt: '2024-12-20T05:00:00.000Z',
      createdAt: CREATED_AT,
    },
    {
      id: DEMO_SERVICE_CONTRACT_IDS.corporationInsurance,
      companyId: DEMO_COMPANY_IDS.corporation,
      type: 'SOCIAL_INSURANCE_AGENCY',
      form: 'PAPER',
      status: 'ACTIVE',
      startsOn: '2025-01-01',
      termMonths: 12,
      autoRenew: true,
      createdAt: CREATED_AT,
    },
    {
      id: DEMO_SERVICE_CONTRACT_IDS.individualBookkeeping,
      companyId: DEMO_COMPANY_IDS.individual,
      type: 'BOOKKEEPING',
      form: 'ONLINE',
      status: 'ACTIVE',
      monthlyFee: 200000,
      adjustmentFeeMonth: 5,
      startsOn: '2025-01-01',
      termMonths: 12,
      autoRenew: true,
      signedAt: '2024-12-21T05:00:00.000Z',
      createdAt: CREATED_AT,
    },
  ]
}
