import { describe, expect, it } from 'vitest'
import { fromProblem } from './legacy-error.ts'

describe('fromProblem', () => {
  it('maps request validation to the legacy 422 with field errors', () => {
    const error = fromProblem(400, {
      type: 'urn:semu:problem:validation-failed',
      title: 'Request validation failed',
      status: 400,
      code: 'VALIDATION_FAILED',
      violations: [
        { field: 'rows[0].basePay', code: 'REQUIRED' },
        { field: 'rows[0].basePay', code: 'INVALID_VALUE' },
        { field: 'body', code: 'INVALID_TYPE' },
      ],
    })

    expect(error.status).toBe(422)
    expect(error.body).toEqual({
      detail: 'Request validation failed.',
      code: 'VALIDATION_FAILED',
      errors: {
        'rows[0].base_pay': ['This field is required.', 'Invalid value.'],
        non_field_errors: ['Invalid type.'],
      },
    })
  })

  it.each([
    ['EMPLOYEE_NOT_FOUND', 404, 404, 'NOT_FOUND'],
    ['EMPLOYEE_DUPLICATE', 409, 409, 'CONFLICT'],
    ['FILING_TRANSITION_INVALID', 409, 409, 'INVALID_TRANSITION'],
    ['VERSION_MISMATCH', 412, 412, 'VERSION_CONFLICT'],
    ['TERMS_REAGREEMENT_REQUIRED', 403, 403, 'TAX_TERMS_REQUIRED'],
    ['SESSION_INVALID', 401, 401, 'UNAUTHENTICATED'],
    ['ACCOUNT_LOCKED', 423, 423, 'ACCOUNT_LOCKED'],
  ])('maps %s (%i) to %i %s', (code, status, legacyStatus, legacyCode) => {
    const error = fromProblem(status, { code, status, title: 'x' })

    expect(error.status).toBe(legacyStatus)
    expect(error.body.code).toBe(legacyCode)
  })

  it('keeps extra problem fields under snake_case names and prefers detail over title', () => {
    const error = fromProblem(409, {
      code: 'EMPLOYEE_DUPLICATE',
      title: 'Employee with this registration number exists',
      detail: 'Employee emp_1 already has this number.',
      duplicateEmployeeId: 'emp_1',
    })

    expect(error.body).toEqual({
      detail: 'Employee emp_1 already has this number.',
      code: 'CONFLICT',
      duplicate_employee_id: 'emp_1',
    })
  })

  it('survives a body that is not a problem', () => {
    expect(fromProblem(502, undefined).body).toEqual({ detail: 'Request failed.', code: 'INTERNAL_ERROR' })
  })
})
