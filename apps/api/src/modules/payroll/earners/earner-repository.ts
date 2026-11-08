import { Context, Layer } from 'effect'
import { makeTenantTable, TableFactory, type TenantTable } from '../../../shared/persistence/record-table.ts'
import type { EarnerRecord } from './earner.ts'

/** 소득자 명부 저장소입니다. */
export class EarnerRepository extends Context.Service<EarnerRepository, TenantTable<EarnerRecord>>()(
  'semu/payroll/EarnerRepository',
) {
  /** `payroll_earners` 표에 둡니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = (seed: ReadonlyArray<EarnerRecord> = []) =>
    Layer.effect(EarnerRepository, makeTenantTable<EarnerRecord>('payroll_earners', seed))

  /** `seed`로 시작해 프로세스 메모리에 둡니다. */
  static readonly layerMemory = (seed: ReadonlyArray<EarnerRecord> = []) =>
    EarnerRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
