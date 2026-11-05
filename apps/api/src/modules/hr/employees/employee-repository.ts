import { Context, Layer } from 'effect'
import { makeTenantTable, TableFactory, type TenantTable } from '../../../shared/persistence/record-table.ts'
import type { EmployeeRecord } from './employee.ts'

/** 직원 저장소입니다. 환경마다 다른 Layer를 넣어 구현을 바꿉니다. */
export class EmployeeRepository extends Context.Service<EmployeeRepository, TenantTable<EmployeeRecord>>()(
  'semu/hr/EmployeeRepository',
) {
  /** `hr_employees` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = (seed: ReadonlyArray<EmployeeRecord> = []) =>
    Layer.effect(EmployeeRepository, makeTenantTable<EmployeeRecord>('hr_employees', seed))

  /** `seed`로 시작해 프로세스 메모리에 직원을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<EmployeeRecord> = []) =>
    EmployeeRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
