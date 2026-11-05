import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { ACCESS_ERRORS } from '../shared/hr-access.ts'
import { IfMatchHeaders } from '../shared/hr-schemas.ts'
import {
  OrganizationNameTaken,
  OrganizationOrder,
  OrganizationOrderMismatch,
  OrganizationUnit,
  OrganizationUnitInUse,
  OrganizationUnitName,
  OrganizationUnitNotFound,
} from './organization.ts'

const params = { id: Schema.String }
const list = Schema.Struct({ items: Schema.Array(OrganizationUnit) })
const withEtag = HttpApiSchema.WithHeaders(OrganizationUnit, { etag: Schema.String })
const created = OrganizationUnit.pipe(HttpApiSchema.status(201))

/**
 * 부서·직위입니다. 이름은 회사 안에서 유일하고, 한 번이라도 배정된 단위는 지울 수 없습니다(409).
 *
 * 현행은 목록 전체를 `PUT`으로 바꿨고, 재설계는 단위별 CRUD와 순서 변경(`:reorder`)으로 나눕니다.
 */
export class OrganizationApi extends HttpApiGroup.make('hrOrganization')
  .add(
    HttpApiEndpoint.get('listDepartments', '/departments', { success: list, error: ACCESS_ERRORS }),
    HttpApiEndpoint.post('createDepartment', '/departments', {
      payload: OrganizationUnitName,
      success: created,
      error: [...ACCESS_ERRORS, OrganizationNameTaken],
    }),
    HttpApiEndpoint.patch('renameDepartment', '/departments/:id', {
      params,
      headers: IfMatchHeaders,
      payload: OrganizationUnitName,
      success: withEtag,
      error: [...ACCESS_ERRORS, OrganizationUnitNotFound, OrganizationNameTaken, VersionMismatch],
    }),
    HttpApiEndpoint.delete('deleteDepartment', '/departments/:id', {
      params,
      success: HttpApiSchema.NoContent,
      error: [...ACCESS_ERRORS, OrganizationUnitNotFound, OrganizationUnitInUse],
    }),
    HttpApiEndpoint.post('reorderDepartments', '/departments::reorder', {
      payload: OrganizationOrder,
      success: list,
      error: [...ACCESS_ERRORS, OrganizationOrderMismatch],
    }),
    HttpApiEndpoint.get('listPositions', '/positions', { success: list, error: ACCESS_ERRORS }),
    HttpApiEndpoint.post('createPosition', '/positions', {
      payload: OrganizationUnitName,
      success: created,
      error: [...ACCESS_ERRORS, OrganizationNameTaken],
    }),
    HttpApiEndpoint.patch('renamePosition', '/positions/:id', {
      params,
      headers: IfMatchHeaders,
      payload: OrganizationUnitName,
      success: withEtag,
      error: [...ACCESS_ERRORS, OrganizationUnitNotFound, OrganizationNameTaken, VersionMismatch],
    }),
    HttpApiEndpoint.delete('deletePosition', '/positions/:id', {
      params,
      success: HttpApiSchema.NoContent,
      error: [...ACCESS_ERRORS, OrganizationUnitNotFound, OrganizationUnitInUse],
    }),
    HttpApiEndpoint.post('reorderPositions', '/positions::reorder', {
      payload: OrganizationOrder,
      success: list,
      error: [...ACCESS_ERRORS, OrganizationOrderMismatch],
    }),
  )
  .middleware(Authentication) {}
