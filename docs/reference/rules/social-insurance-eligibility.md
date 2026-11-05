# 4대보험 자동 판정

## 요약

- 나이·근로시간·임원 여부·외국인 체류자격으로 4대보험 가입 권장값을 계산합니다. 저장은 사용자가 확인한 뒤 합니다
- 만 60세 이상 국민연금 제외(신규/재직 구분), 만 65세 이후 고용은 고용보험 제외, 대표·임원과 동거 친족은 고용·산재 제외, 주 15시간 미만은 국민연금·건강·고용 제외
- 외국인은 체류자격으로 고용보험 의무/상호주의/임의를 나눕니다

## 현행 위치

- `apps/api/legacy/src/modules/hr/social-insurance/social-insurance.utils.ts:6-37, 80-142`
- `docs/reference/spec/hr.md:646-648`
- `social-insurance.utils.ts`의 `determineSocialInsurance`
- 스펙 R12–R13

## 로직

- `ageAtJoin ≥ 60` → `nps_over_60_new_hire`, 아니면 `ageToday ≥ 60` → `nps_over_60_incumbent`
- `ageAtJoin ≥ 65` → `ei_over_65_new_hire`
- 주 15시간 미만 → 초단시간, 그 밖에 월 환산 60시간 미만 → 국민연금만 제외(가입 중이면 메시지)
- 외국인: 상호주의 체류자격이면 협정국만 가입, 의무 체류자격이 아니면 임의 가입 메시지

## 근거

`apps/api/legacy/src/modules/hr/social-insurance/social-insurance.utils.ts:80-142`

```ts
export function determineSocialInsurance(facts: DeterminationFacts, settings: SocialInsuranceSettings, today: PlainDate): DeterminationResult {
  const result: DeterminationResult = {
    determinations: [],
    messages: [],
    recommended: {
      nps_enrolled: settings.nps_enrolled,
      nhis_enrolled: settings.nhis_enrolled,
      ei_enrolled: settings.ei_enrolled,
      iais_enrolled: settings.iais_enrolled,
      nps_exclusion_reason: settings.nps_exclusion_reason,
      nhis_exclusion_reason: settings.nhis_exclusion_reason,
      ei_exclusion_reason: settings.ei_exclusion_reason,
      iais_exclusion_reason: settings.iais_exclusion_reason,
    },
  }
  const exclude = (insurance: 'nps' | 'nhis' | 'ei' | 'iais', reason: string): void => {
    result.recommended[`${insurance}_enrolled`] = false
    result.recommended[`${insurance}_exclusion_reason`] = reason
  }
  if (facts.birthDate !== null) {
    const ageAtJoin = facts.joinDate === null ? null : ageOn(facts.birthDate, facts.joinDate)
    const ageToday = ageOn(facts.birthDate, today)
    if (ageAtJoin !== null && ageAtJoin >= 60) {
      result.determinations.push({ code: 'nps_over_60_new_hire' })
      exclude('nps', '만 60세 이상')
    } else if (ageToday >= 60) {
      result.determinations.push({ code: 'nps_over_60_incumbent' })
      exclude('nps', '만 60세 이상')
    }
    if (ageAtJoin !== null && ageAtJoin >= 65) {
      result.determinations.push({ code: 'ei_over_65_new_hire' })
      exclude('ei', '만 65세 이후 고용된 자')
    }
  }
  if (settings.is_representative_or_executive) {
    exclude('ei', '대표자, 사내이사')
    exclude('iais', '대표자, 사내이사')
  } else if (settings.is_representative_relative) {
    exclude('ei', '대표자와 동거하는 친족')
    exclude('iais', '대표자와 동거하는 친족')
  }
  if (facts.weeklyWorkHours !== null) {
    if (facts.weeklyWorkHours < 15) {
      exclude('nps', '초단시간 근로자(주 15h 미만)')
      exclude('nhis', '초단시간 근로자(주 15h 미만)')
      exclude('ei', '초단시간 근로자(주 15h 미만)')
    } else if (facts.weeklyWorkHours * WEEKS_PER_MONTH < 60) {
      if (settings.nps_enrolled) result.messages.push({ code: 'nps_under_60h_enrolled' })
      exclude('nps', '단시간 근로자(월 60h 미만)')
    }
  }
  if (!facts.isLocal) {
    const visa = (facts.visa ?? '').toUpperCase()
    if (EI_RECIPROCITY_VISAS.includes(visa)) {
      const agreed = facts.nationality !== null && EI_RECIPROCITY_COUNTRIES.includes(facts.nationality.toUpperCase())
      result.messages.push({ code: agreed ? 'EI_FOREIGNER_RECIPROCITY_AGREEMENT' : 'EI_FOREIGNER_RECIPROCITY_NON_AGREEMENT' })
      if (!agreed) exclude('ei', '면제 대상의 외국인')
    } else if (!EI_MANDATORY_VISAS.includes(visa)) {
      result.messages.push({ code: 'EI_FOREIGNER_OPTIONAL' })
    }
  }
  return result
}
```

## 서버 이전 시 주의

- 제외 사유는 한글 문구 대신 코드(`AGE_60_OR_OVER` 등)로 저장하고 화면에서 문구로 바꿉니다
- 상호주의 국가 목록이 비어 있습니다. 참조데이터로 채워야 합니다

## 열린 질문

1. 상호주의 국가 목록(EI_RECIPROCITY_COUNTRIES)이 비어 있어 E-1~E-7 등은 모두 "협정 없음"으로 제외 권장됩니다. 국가 목록을 참조데이터로 받을까요
2. 월 60시간 미만이면 국민연금만 제외하는 분기는 주 15시간 미만 검사 뒤에 있어 실행되지 않습니다(주 15시간 × 4.345 ≈ 65시간). 지울까요, 월 소정근로시간으로 다시 판정할까요
3. 60세 판정은 입사일 기준 신규/재직자 구분만 하고, 60세 이후 임의계속가입 신청은 다루지 않습니다. 다룰까요

## 픽스처

[`apps/api/test/fixtures/rules/social-insurance-eligibility.json`](../../../apps/api/test/fixtures/rules/social-insurance-eligibility.json): 11건 (모두 추적)

| 케이스 | 결과 |
|---|---|
| ordinary employee keeps all | `{"determinations": [], "messages": [], "recommended": {"nps": {"enrolled": true}, "nhis…` |
| hired at 60 | `{"determinations": ["NPS_OVER_60_NEW_HIRE"], "messages": [], "recommended": {"nps": {"e…` |
| turns 60 while employed | `{"determinations": ["NPS_OVER_60_INCUMBENT"], "messages": [], "recommended": {"nps": {"…` |
| hired at 65 | `{"determinations": ["NPS_OVER_60_NEW_HIRE", "EI_OVER_65_NEW_HIRE"], "messages": [], "re…` |
| representative or executive | `{"determinations": [], "messages": [], "recommended": {"nps": {"enrolled": true}, "nhis…` |
| representative relative | `{"determinations": [], "messages": [], "recommended": {"nps": {"enrolled": true}, "nhis…` |
| 14 weekly hours | `{"determinations": [], "messages": [], "recommended": {"nps": {"enrolled": false, "excl…` |
| 15 weekly hours keeps all | `{"determinations": [], "messages": [], "recommended": {"nps": {"enrolled": true}, "nhis…` |
| E-9 foreigner is mandatory | `{"determinations": [], "messages": [], "recommended": {"nps": {"enrolled": true}, "nhis…` |
| E-7 foreigner without agreement | `{"determinations": [], "messages": ["EI_FOREIGNER_RECIPROCITY_NON_AGREEMENT"], "recomme…` |
| D-2 foreigner is optional | `{"determinations": [], "messages": ["EI_FOREIGNER_OPTIONAL"], "recommended": {"nps": {"…` |
