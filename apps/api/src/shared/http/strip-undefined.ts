/** 값이 `undefined`인 키를 지웁니다. 선택 필드를 응답 스키마(`optionalKey`)에 맞출 때 씁니다. */
export function stripUndefined<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>
  }
}
