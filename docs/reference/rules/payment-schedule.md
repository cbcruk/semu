# 정기결제 일정과 결제 상태

## 요약

- 서비스 사용료는 은행망 CMS 자동출금으로 받습니다. 비영업일(주말·공휴일)이면 다음 영업일에 출금합니다
- 출금 결과는 출금일 **익일 오후**에 반영됩니다. 결제 1일 전 알림톡으로 예정 금액을 안내합니다
- 결제 상태는 다섯 가지(결제 예정·완료·실패·재시도·환불)이고, 재시도는 담당자만 합니다
- 2025년 12월 기준 결제 내역에는 급여 아웃소싱만 나옵니다
- 레거시 서버는 매달 25일(비영업일이면 다음 영업일)을 결제일로 두었습니다(제안값)

## 현행 위치

- 화면: 설정 > 서비스 및 결제(서비스 카드, 결제 내역 표)
- 호출: nexus `GET /api/company/:cid/payment/?limit=&offset=`
- 레거시 구현: `apps/api/legacy/src/modules/platform/billing/billing.utils.ts`(`BILLING_DAY`, `nextBusinessDay`, `serializePayment`), `billing.service.ts`(`runBillingCycle`, `retryPayment`)

## 로직

```
scheduled ──출금 성공──▶ paid ──환불──▶ refunded
scheduled ──출금 실패──▶ failed ──담당자 재시도──▶ retrying ──▶ paid | failed
```

- 결제일: 그달 25일에서 시작해 토·일·공휴일이면 하루씩 미룹니다
- 매달 작업은 결제일에 구독 중이고 월 이용료가 0보다 큰 구독마다 결제 예정 건을 하나 만듭니다. 같은 구독·결제일 건이 있으면 만들지 않습니다
- 출금 결과는 CMS 결과 파일로 다음 날 오후에 반영합니다(레거시 가짜 게이트웨이는 즉시 반영)
- 화면 표시: `isScheduled = status === 'scheduled'`, 결제 계좌는 은행 코드와 끝 4자리 마스킹

## 근거

`manual/08-설정/10-서비스-및-결제.md:33, 48-54, 62-66`

> *2025년 12월 기준 급여 아웃소싱 서비스 결제 내역에 대하여만 확인 가능합니다.
>
> | 결제 예정 | 다음 정기 결제건이 존재하는 경우 생성됨 |
> | 결제 완료 | 결제(출금)가 정상적으로 이루어진 경우, 출금 익일 오후에 완료 상태로 변경 |
> | 결제 실패 | 잔액 부족 등의 사유로 정상 출금되지 않은 경우, 익일 오후에 실패 상태로 변경 |
> | 결제 재시도 | 결제 실패 이후 담당자가 출금을 재시도하는 경우, 실패건이 재시도로 변경 |
> | 환불 | 특정 결제건에 대해 환불이 완료된 경우 표시 |
>
> 은행망을 사용하는 CMS 결제 특성상 주말·공휴일을 포함한 비영업일에는 결제가 진행되지 않으며, 휴일 이후 다음 영업일에 결제가 진행됩니다.
>
> - **결제 예정 금액 안내**: 결제 1일 전 알림톡으로 자동 발송됩니다.

`docs/reference/spec/platform.md:372-377`

> ```
> payment:      scheduled → paid
>               scheduled → failed → retrying → paid | failed
>               paid → refunded
> ```
> - `failed→retrying`은 담당자(desk) 액션. 결과 반영은 출금 익일 오후 배치(CMS 결과 파일).

`apps/api/legacy/src/modules/platform/billing/billing.utils.ts:18-22`

```ts
export function nextBusinessDay(date: PlainDate, holidays: ReadonlySet<string>): PlainDate {
  let current = date
  while (dayOfWeek(current) === 0 || dayOfWeek(current) === 6 || holidays.has(current)) current = addDays(current, 1)
  return current
}
```

## 픽스처

[`apps/api/test/fixtures/rules/payment-schedule.json`](../../../apps/api/test/fixtures/rules/payment-schedule.json): 19건 (추적 19). 공휴일은 입력으로 줍니다

| 케이스 | 결과 |
|---|---|
| 2026-11 (수) | 11-25 |
| 2026-04 (토) / 2026-10 (일) | 04-27 / 10-26 |
| 2026-05 대체공휴일 / 2026-12 성탄절 / 2026-09 추석 | 05-26 / 12-28 / 09-28 |
| 결과 반영 / 알림톡 | 익일 오후 / D-1 |
| 전이 6종 | 예정→완료·실패, 실패→재시도→완료·실패, 완료→환불 |
| 예정 건 재시도 | 409 |
| 결제 내역 | 급여 아웃소싱만 |
| 월 이용료 0 / 작업 두 번 | 예정 없음 / 한 건 |

## 서버 이전 시 주의

- 결제일(25일)은 레거시 제안값입니다. 계약별 결제일이 있으면 서비스 계약에 둡니다
- 공휴일 목록은 서버 참조데이터(공휴일·대체공휴일)로 두고 회사 시간대로 판정합니다
- 결과는 비동기(익일 결과 파일)라 출금 요청과 결과 반영을 다른 커맨드·작업으로 나눕니다. 결과 반영은 멱등이어야 합니다
- 재시도는 담당자(세무 대리인 직원) 권한입니다. 고객 API에는 열지 않습니다
- "급여 아웃소싱만 표시"는 표시 정책이라 서버가 상품별로 필터할지 정해야 합니다
- 출금 계좌 번호는 암호화해 저장하고 응답에는 끝 4자리만 줍니다
