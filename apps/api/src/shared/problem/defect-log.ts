import { DecryptionFailed } from '../crypto/data-key.ts'

/**
 * 로그에 남길 결함(defect) 요약입니다. 오류 이름과 결함이 난 코드 위치(`src/...:줄`)만 남깁니다.
 *
 * 메시지는 남기지 않습니다. 레코드 디코딩 실패처럼 메시지에 이름·이메일 같은 저장 값이 섞일 수 있어서입니다.
 * 메시지에 원문이 들어가지 않는다고 확인한 오류({@link DecryptionFailed}: 용도와 원인만)만 메시지까지 남깁니다.
 */
export function describeDefect(defect: unknown): string {
  if (defect instanceof DecryptionFailed) return `${defect.name}: ${defect.message}`
  if (defect instanceof Error) {
    const location = defectLocation(defect.stack)
    return location === undefined ? defect.name : `${defect.name} at ${location}`
  }
  if (typeof defect === 'object' && defect !== null && typeof (defect as { _tag?: unknown })._tag === 'string') {
    return `defect ${(defect as { _tag: string })._tag}`
  }
  return `defect of type ${typeof defect}`
}

/** 스택에서 위치만 꺼냅니다. 앱 코드(`src/`) 줄을 먼저 고르고, 없으면 첫 위치입니다. 경로는 `src/`·`node_modules/`부터 씁니다. */
function defectLocation(stack: string | undefined): string | undefined {
  if (stack === undefined) return undefined
  const locations = stack
    .split('\n')
    .slice(1)
    .flatMap((line) => {
      const match = /\(?([^()\s]+):(\d+):\d+\)?\s*$/.exec(line)
      if (match === null || match[1]!.startsWith('node:')) return []
      return [`${match[1]!.replace(/^.*?\/(src|node_modules)\//, '$1/')}:${match[2]}`]
    })
  return locations.find((location) => location.startsWith('src/')) ?? locations[0]
}
