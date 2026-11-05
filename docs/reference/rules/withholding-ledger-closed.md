# 원천세 "급여대장 마감" 연계

## 요약

원천세 신고 건의 제출 자료 "급여대장 마감"은 그 **지급월**에 지급일이 있는 급여대장이 하나 이상이고 모두 마감됐을 때 제출됨이 됩니다. 하나라도 마감이 풀리면 다시 대기로 돌아갑니다. 급여는 지급월 소득 종류별 원천세 집계를 함께 넘깁니다.

## 현행 위치

- 화면: 세무 > 원천세의 "원천세 신고 대상 급여 대장 마감 내용 확인"
- 현행은 대장 마감과 원천세 자료 갱신이 따로 움직입니다(P2)
- 재설계 전 구현: `apps/api/legacy/src/modules/payroll/withholding/withholding-link.ts`

## 로직

```
지급월 대장 = 지급일이 그 달인 대장
마감 = 지급월 대장이 1개 이상 && 모두 CLOSED
변경 전후로 마감 여부가 바뀌면 payroll.pay-month.closed / payroll.pay-month.reopened 이벤트
집계 = 소득 종류(WAGE·DAILY·BUSINESS·OTHER)별 인원, 총지급액, 과세 급여, 소득세, 지방소득세
```

## 근거

- 스펙 6.1(`docs/reference/spec/payroll.md:707-730`): "`payroll_ledger_closed`는 `auto_linked = 1`이고 `linked_status` ∈ `closed|open`", "귀속월(정확히는 **지급월**, 원천세는 지급 시기 기준) 대장이 모두 `approved`(BPO) 또는 `완료`(legacy)이면 `closed`, 하나라도 미마감이면 `open`", 집계 코드 표 A01·A03·A25·A40, "코드 매핑의 정확성은 **확인 필요**"
- 매뉴얼 `alfred-manual/06-세무/02-원천세.md`: 원천세 화면의 급여대장 마감 확인

## 서버 이전 시 주의

- 급여는 신고서 코드를 모릅니다. 소득 종류로 넘기고 Tax가 코드로 바꿉니다
- 마감·해제·새 대장·지급일 이동·삭제가 모두 같은 판정을 거칩니다. 이벤트는 같은 트랜잭션의 아웃박스로 냅니다
- 퇴직금(A21)과 연말정산(A04)은 아직 집계하지 않습니다

## 픽스처

`apps/api/test/fixtures/rules/withholding-ledger-closed.json`: 모두 마감, 승인 대기 포함, 다른 달 무시, 대장 없음 4건
