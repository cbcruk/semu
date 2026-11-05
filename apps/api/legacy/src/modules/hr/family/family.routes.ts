import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { AppEnv } from '../../../app.types'
import type { Cipher } from '../../../lib/crypto/crypto.types'
import { parsePageRequest, toPage } from '../../../lib/drf-pagination'
import { requireMenu } from '../../../middleware/access'
import { validationHook } from '../../../middleware/validation'
import { parseId, requireEmployee } from '../employees/employee-guard'
import type { HrContext } from '../shared/hr-context.types'
import { HR_MAX_FILE_BYTES, readHrUpload } from '../shared/hr-files'
import { pageQuery } from '../shared/hr.schema'
import { fromFlag } from '../shared/hr.utils'
import { maskIdentificationNumber } from '../shared/registration-number'
import { listFamilyAttachments, listFamilyMembers } from './family.repository'
import { familyMemberBody } from './family.schema'
import {
  addFamilyAttachment,
  createFamilyMember,
  removeFamilyAttachment,
  removeFamilyMember,
  replaceFamilyAttachment,
  requireFamily,
  updateFamily,
} from './family.service'
import type { FamilyAttachmentRow, FamilyMemberRow } from './family.types'

const BASE = '/employment/wage-employees/:employeeId{[0-9]+}/family-members'
const ONE = `${BASE}/:familyId{[0-9]+}`
const ATTACHMENT = `${ONE}/attachments/:attachmentId{[0-9]+}`

/** Routes of an employee's 인적공제 대상자 and their attachments. */
export function familyRoutes({ deps }: HrContext): Hono<AppEnv> {
  const menu = requireMenu('employment_employee')
  const uploadLimit = bodyLimit({
    maxSize: HR_MAX_FILE_BYTES + 64 * 1024,
    onError: (c) => c.json({ detail: 'The file is too large.', code: 'PAYLOAD_TOO_LARGE' }, 413),
  })
  const respond = (companyId: string, family: FamilyMemberRow): Record<string, unknown> =>
    serializeFamily(family, listFamilyAttachments(deps.db, companyId, [family.id]), deps.cipher)

  return new Hono<AppEnv>()
    .get(BASE, menu, zValidator('query', pageQuery, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const all = listFamilyMembers(deps.db, c.var.company.id, employee.id)
      const rows = all.slice(page.offset, page.offset + page.limit)
      const attachments = listFamilyAttachments(deps.db, c.var.company.id, rows.map((row) => row.id))
      const results = rows.map((row) => serializeFamily(row, attachments.filter((attachment) => attachment.family_member_id === row.id), deps.cipher))
      return c.json(toPage(results, all.length, page, c.req.url))
    })
    .post(BASE, menu, zValidator('json', familyMemberBody, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      return c.json(respond(c.var.company.id, createFamilyMember(deps, employee, c.req.valid('json'))), 201)
    })
    .get(ONE, menu, (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      return c.json(respond(c.var.company.id, requireFamily(deps, employee, parseId(c.req.param('familyId'), 'Family member'))))
    })
    .put(ONE, menu, zValidator('json', familyMemberBody, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const family = updateFamily(deps, employee, parseId(c.req.param('familyId'), 'Family member'), c.req.valid('json'))
      return c.json(respond(c.var.company.id, family))
    })
    .delete(ONE, menu, (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      removeFamilyMember(deps, employee, parseId(c.req.param('familyId'), 'Family member'))
      return c.body(null, 204)
    })
    .post(`${ONE}/attachments`, menu, uploadLimit, async (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const upload = await readHrUpload(c)
      const attachment = await addFamilyAttachment(deps, employee, parseId(c.req.param('familyId'), 'Family member'), upload, c.var.user.id)
      return c.json(serializeAttachment(attachment), 201)
    })
    .patch(ATTACHMENT, menu, uploadLimit, async (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const upload = await readHrUpload(c)
      const attachment = await replaceFamilyAttachment(
        deps,
        employee,
        parseId(c.req.param('familyId'), 'Family member'),
        parseId(c.req.param('attachmentId'), 'Attachment'),
        upload,
        c.var.user.id,
      )
      return c.json(serializeAttachment(attachment))
    })
    .delete(ATTACHMENT, menu, (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      removeFamilyAttachment(deps, employee, parseId(c.req.param('familyId'), 'Family member'), parseId(c.req.param('attachmentId'), 'Attachment'))
      return c.body(null, 204)
    })
}

function serializeFamily(family: FamilyMemberRow, attachments: readonly FamilyAttachmentRow[], cipher: Cipher): Record<string, unknown> {
  return {
    id: family.id,
    name: family.name,
    birth_date: family.birth_date,
    relation: family.relation,
    is_local: fromFlag(family.is_local),
    registration_number: family.registration_number_enc === null ? null : maskIdentificationNumber(cipher.decrypt(family.registration_number_enc), 'registration'),
    is_tax_free_target: fromFlag(family.is_tax_free_target),
    is_year_end_target: fromFlag(family.is_year_end_target),
    year_end_dependant_type: family.year_end_dependant_type,
    is_health_insurance_dependent: fromFlag(family.is_health_insurance_dependent),
    attachments: attachments.map(serializeAttachment),
    created: family.created_at,
    updated: family.updated_at,
  }
}

function serializeAttachment(attachment: FamilyAttachmentRow): Record<string, unknown> {
  return {
    id: attachment.id,
    file_id: attachment.file_id,
    file_name: attachment.original_name,
    mime_type: attachment.mime_type,
    size: attachment.size_bytes,
    created: attachment.created_at,
    updated: attachment.updated_at,
  }
}
