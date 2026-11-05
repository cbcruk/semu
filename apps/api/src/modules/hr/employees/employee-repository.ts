import { Context, Layer } from 'effect'
import { makeMemoryTable, type TenantTable } from '../shared/tenant-table.ts'
import type { EmployeeRecord } from './employee.ts'

/** 직원 저장소입니다. 환경마다 다른 Layer를 넣어 구현을 바꿉니다. */
export class EmployeeRepository extends Context.Service<EmployeeRepository, TenantTable<EmployeeRecord>>()(
  'semu/hr/EmployeeRepository',
) {
  /** `seed`로 시작해 프로세스 메모리에 직원을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<EmployeeRecord> = []) =>
    Layer.effect(EmployeeRepository, makeMemoryTable(seed))
}
