import { Cause, Clock, Context, Data, Effect, Exit, Layer, Option, Schedule } from 'effect'
import { describeDefect } from '../problem/defect-log.ts'
import { TableFactory } from '../persistence/record-table.ts'
import { UnitOfWork } from '../persistence/unit-of-work.ts'
import { DEFAULT_RETRY_POLICY, decideClaim, finishRun, runIdOf } from './scheduled-run.ts'
import type { RetryPolicy, ScheduledRunRecord } from './scheduled-run.ts'
import { latestSlot } from './schedule-slot.ts'
import type { ScheduleSlot, ScheduleSpec } from './schedule-slot.ts'

/**
 * 정기 작업 하나입니다. 이름은 `<context>.<작업>`이고 실행 기록의 키가 됩니다.
 *
 * `run`은 같은 슬롯에 다시 돌려도 결과가 같아야 합니다. 실패하면 슬롯 전체를 다시 돌리고, 프로세스가 죽으면 임대 시각 뒤에 다시
 * 돌리기 때문입니다. 실패는 오류 채널(`E`)로 내면 재시도합니다. 돌려준 값은 실행 기록의 `result`로 남습니다.
 */
export interface ScheduledTask<R = never> {
  readonly name: string
  readonly spec: ScheduleSpec
  readonly retry?: RetryPolicy
  run(slot: ScheduleSlot): Effect.Effect<unknown, unknown, R>
}

/** 회사별로 돈 작업에서 실패한 회사입니다. 나머지 회사는 그대로 끝냈고, 슬롯을 다시 돌리면 모든 회사를 다시 봅니다. */
export class CompaniesFailed extends Data.TaggedError('CompaniesFailed')<{
  readonly succeeded: number
  readonly failed: ReadonlyArray<{ readonly companyId: string; readonly error: string }>
}> {}

/** 회사별 작업의 결과입니다. */
export interface CompaniesSucceeded<A> {
  readonly succeeded: number
  readonly results: ReadonlyArray<{ readonly companyId: string; readonly result: A }>
}

/**
 * 항목(회사)마다 `work`를 한 트랜잭션으로 돌립니다. 한 회사가 실패해도 다음 회사로 넘어가고, 하나라도 실패했으면 끝에
 * {@link CompaniesFailed}로 실패합니다. 요청 하나가 트랜잭션 하나인 것처럼 정기 작업은 회사 하나가 트랜잭션 하나입니다.
 */
export const eachCompany = <T, A, E, R>(
  items: ReadonlyArray<T>,
  companyIdOf: (item: T) => string,
  work: (item: T) => Effect.Effect<A, E, R>,
): Effect.Effect<CompaniesSucceeded<A>, CompaniesFailed, R | UnitOfWork> =>
  Effect.gen(function* () {
    const unitOfWork = yield* UnitOfWork
    const results: Array<{ companyId: string; result: A }> = []
    const failed: Array<{ companyId: string; error: string }> = []
    for (const item of items) {
      const exit = yield* Effect.exit(unitOfWork.run(work(item)))
      if (Exit.isSuccess(exit)) results.push({ companyId: companyIdOf(item), result: exit.value })
      else failed.push({ companyId: companyIdOf(item), error: describeCause(exit.cause) })
    }
    if (failed.length > 0) return yield* new CompaniesFailed({ succeeded: results.length, failed })
    return { succeeded: results.length, results }
  })

/** 슬롯 하나를 처리한 결과입니다. */
export interface SlotOutcome {
  readonly task: string
  readonly slot: string
  /** `ERRORED`는 슬롯 잡기·기록 저장에서 결함이 난 것입니다. 다음 틱에 다시 봅니다. */
  readonly outcome: 'SUCCEEDED' | 'FAILED' | 'GAVE_UP' | 'SKIPPED' | 'ERRORED'
}

/**
 * 정기 작업 실행기입니다. `runDue`가 작업마다 지금 시각의 마지막 슬롯을 보고, 아직 끝나지 않았으면 돌립니다.
 *
 * - **중복 실행 방지:** 슬롯을 잡는 일(실행 기록 읽기·쓰기)을 한 트랜잭션에서 합니다. SQLite는 `BEGIN IMMEDIATE`로 쓰기 잠금을 먼저
 *   잡으므로 같은 파일을 연 프로세스가 둘이어도 한쪽만 `RUNNING`으로 씁니다. 잡은 쪽은 임대 시각까지 슬롯을 가집니다
 * - **재시도:** 실패하면 {@link RetryPolicy}대로 나중 틱에 다시 시도합니다
 * - **시각:** Effect `Clock`을 읽습니다. 테스트는 `TestClock`으로 옮깁니다
 */
export class Scheduler extends Context.Service<
  Scheduler,
  {
    /** 지금 돌릴 슬롯을 모두 처리합니다. 작업은 이름 순서가 아니라 등록한 순서로 하나씩 돕니다. */
    runDue(): Effect.Effect<ReadonlyArray<SlotOutcome>>
    /** 실행 기록입니다. 최근 것부터입니다. */
    runs(): Effect.Effect<ReadonlyArray<ScheduledRunRecord>>
  }
>()('semu/platform/Scheduler') {
  /** `tasks`로 만듭니다. 실행 기록은 `platform_scheduled_runs` 표입니다. 작업이 쓰는 서비스(`R`)는 이 레이어에 넣습니다. */
  static readonly layer = <R>(
    tasks: ReadonlyArray<ScheduledTask<R>>,
  ): Layer.Layer<Scheduler, never, R | TableFactory | UnitOfWork> =>
    Layer.effect(
      Scheduler,
      Effect.gen(function* () {
        const names = new Set<string>()
        for (const task of tasks) {
          if (names.has(task.name)) throw new Error(`Scheduled task registered twice: ${task.name}`)
          names.add(task.name)
        }
        const table = yield* (yield* TableFactory).make<ScheduledRunRecord>('platform_scheduled_runs')
        const unitOfWork = yield* UnitOfWork
        const context = yield* Effect.context<R>()

        const runTask = (task: ScheduledTask<R>) =>
          Effect.gen(function* () {
            const policy = task.retry ?? DEFAULT_RETRY_POLICY
            const slot = latestSlot(task.spec, yield* Clock.currentTimeMillis)
            const identity = { task: task.name, slot: slot.key }
            const claim = yield* unitOfWork.run(
              Effect.gen(function* () {
                const existing = Option.getOrUndefined(yield* table.get(runIdOf(task.name, slot.key)))
                const decision = decideClaim(existing, identity, yield* Clock.currentTimeMillis, policy)
                if (decision.kind !== 'SKIP') yield* table.put(decision.record)
                return decision
              }),
            )
            if (claim.kind === 'SKIP') return { ...identity, outcome: 'SKIPPED' as const }
            if (claim.kind === 'GIVE_UP') {
              yield* Effect.logError('Scheduled task gave up', { task: task.name, slot: slot.key })
              return { ...identity, outcome: 'GAVE_UP' as const }
            }
            const exit = yield* Effect.exit(task.run(slot).pipe(Effect.provideContext(context)))
            const outcome = Exit.isSuccess(exit)
              ? { ok: true as const, result: exit.value ?? null }
              : { ok: false as const, error: describeCause(exit.cause) }
            const finished = finishRun(claim.record, outcome, yield* Clock.currentTimeMillis, policy)
            yield* unitOfWork.run(table.put(finished))
            if (!outcome.ok) {
              yield* Effect.logWarning('Scheduled task failed', {
                task: task.name,
                slot: slot.key,
                attempts: finished.attempts,
                error: outcome.error,
                retryAt: finished.nextAttemptAt,
              })
            }
            return { ...identity, outcome: outcome.ok ? ('SUCCEEDED' as const) : ('FAILED' as const) }
          })

        return Scheduler.of({
          // 슬롯 잡기·기록 저장의 결함이 뒤에 등록된 작업을 막지 않도록 작업마다 받습니다.
          runDue: () =>
            Effect.forEach(tasks, (task) =>
              runTask(task).pipe(
                Effect.catchDefect((defect) =>
                  Effect.logError('Scheduled task bookkeeping defect', {
                    task: task.name,
                    defect: describeDefect(defect),
                  }).pipe(Effect.as({ task: task.name, slot: '', outcome: 'ERRORED' as const })),
                ),
              ),
            ),
          runs: () => table.all().pipe(Effect.map((records) => records.toSorted(byStartedAtDesc))),
        })
      }),
    )
}

/**
 * 시작할 때와 그 뒤 `interval`마다 {@link Scheduler.runDue}를 부릅니다. 결함이 나도 멈추지 않고 요약만 로그에 남깁니다.
 * 서버만 얹습니다. 테스트 앱은 얹지 않아 벽시계로 작업이 돌지 않습니다.
 */
export const SchedulerRunnerLive = (
  interval: `${number} seconds` = '60 seconds',
): Layer.Layer<never, never, Scheduler> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const scheduler = yield* Scheduler
      const tick = scheduler.runDue().pipe(
        Effect.asVoid,
        Effect.catchDefect((defect) => Effect.logError('Scheduler defect', describeDefect(defect))),
      )
      yield* Effect.forkScoped(tick.pipe(Effect.andThen(Effect.repeat(tick, Schedule.spaced(interval)))))
    }),
  )

/**
 * 실패 원인의 요약입니다. 오류 메시지에는 저장 값이 섞일 수 있어 태그와 회사 ID, 결함 위치만 남깁니다.
 */
export function describeCause(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause)
  if (error instanceof CompaniesFailed) {
    const companies = error.failed.map((entry) => `${entry.companyId}: ${entry.error}`).join(', ')
    return companies === '' ? 'CompaniesFailed' : `CompaniesFailed (${companies})`
  }
  if (!Cause.hasDies(cause) && typeof error === 'object' && error !== null && '_tag' in error) {
    return String((error as { _tag: unknown })._tag)
  }
  return describeDefect(error)
}

function byStartedAtDesc(a: ScheduledRunRecord, b: ScheduledRunRecord): number {
  return a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0
}
