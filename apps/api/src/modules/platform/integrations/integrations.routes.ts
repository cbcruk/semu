import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { AppEnv } from '../../../app.types'
import { notFound } from '../../../lib/domain-error'
import { requireMenu } from '../../../middleware/access'
import { validationHook } from '../../../middleware/validation'
import type { IntegrationType } from '../adapters/scraping.adapter'
import { requireAnyMenu } from '../platform.middleware'
import type { PlatformDeps } from '../platform.types'
import { checkCertificatePassword, joinGiro, listCompanyCertificates, registerCertificate, removeCertificate } from './certificates.service'
import { findIntegration, listIntegrations } from './integrations.repository'
import {
  bankAccountsPatch,
  bankBody,
  bankListBody,
  bankQuery,
  businessStatusQuery,
  cardListBody,
  cardNumberBody,
  cardsalesBody,
  certListQuery,
  certPasswordBody,
  certUploadBody,
  creditcardBody,
  deliveryBody,
  giroBody,
  giroJoinBody,
  hometaxBody,
  integrationTypeQuery,
  pgBody,
  scrapingStatusQuery,
  scrapRequestBody,
  shareCompanyBody,
  speedbankBody,
  speedbankPatch,
} from './integrations.schema'
import {
  correctCardNumber,
  integrationBlocks,
  integrationStatus,
  patchBankAccounts,
  registerDelivery,
  registerPg,
  registerSimple,
  registerWithItems,
  removeIntegration,
  removeItem,
  requestCandidates,
  requireIntegration,
  serializeIntegration,
  updateSpeedbank,
} from './integrations.service'
import { isIntegrationType, MAX_REGISTER_COUNT } from './integrations.utils'
import { getBusinessTypes, lookupBusinessStatus, recentShare, refreshBusinessTypes, shareCompany } from './partner.service'
import { lastScrapRequest, requestAllScrap, requestScrap, scrapingStatus } from './scrap.service'

/**
 * Institution link, certificate and counterparty routes (remittance-api paths), mounted under `/api/company/:companyId`.
 *
 * Every integration route needs one of the integration menus; certificate
 * writes need the certificate menu. Credentials are accepted but never returned.
 */
export function integrationRoutes(deps: PlatformDeps): Hono<AppEnv> {
  const integrationMenus = requireAnyMenu(['integrate_transaction', 'integrate_tax'])
  const certReadMenus = requireAnyMenu(['cert_management', 'integrate_transaction', 'integrate_tax'])
  const serviceParam = (value: string | undefined): IntegrationType => {
    if (value === undefined || !isIntegrationType(value)) throw notFound('Service')
    return value
  }

  return new Hono<AppEnv>()
    .get('/integrations/v2', integrationMenus, zValidator('query', integrationTypeQuery, validationHook), (c) =>
      c.json(integrationBlocks(deps, c.var.company.id, c.req.valid('query').integration_type as IntegrationType | undefined)),
    )
    .get('/integrations/status', integrationMenus, zValidator('query', integrationTypeQuery, validationHook), (c) =>
      c.json(integrationStatus(deps, c.var.company.id, c.req.valid('query').integration_type as IntegrationType | undefined)),
    )
    .get('/integrations/scraping-status', integrationMenus, zValidator('query', scrapingStatusQuery, validationHook), (c) =>
      c.json(scrapingStatus(deps, c.var.company.id, c.req.valid('query').id)),
    )
    .post('/integrations/request-all-scrapping', integrationMenus, (c) => c.json(requestAllScrap(deps, c.var.company.id, c.var.user.id), 201))
    .post('/integrations/request-scrapping/:service', integrationMenus, zValidator('json', scrapRequestBody, validationHook), (c) => {
      const body = c.req.valid('json')
      return c.json(
        requestScrap(deps, c.var.company.id, c.var.user.id, serviceParam(c.req.param('service')), {
          integrationId: body.integration_id,
          itemId: body.item_id,
          corporationNumberUnused: body.corporation_number_unused,
        }),
        201,
      )
    })
    .get('/integrations/:service/last-scrap-request-status', integrationMenus, (c) =>
      c.json(lastScrapRequest(deps, c.var.company.id, serviceParam(c.req.param('service')))),
    )
    .post('/integrations/hometax', integrationMenus, zValidator('json', hometaxBody, validationHook), async (c) => {
      const body = c.req.valid('json')
      const auth = body.auth_type === 'CERTIFICATE' ? { cert_id: body.cert_id ?? '', sign_pw: body.sign_pw } : { account_id: body.account_id, account_pw: body.account_pw }
      const row = await registerSimple(deps, c.var.company, 'hometax', { auth })
      return c.json(serializeIntegration(deps, row), 201)
    })
    .delete('/integrations/hometax/:id', integrationMenus, (c) => {
      removeIntegration(deps, c.var.company.id, c.req.param('id'), 'hometax')
      return c.body(null, 204)
    })
    .post('/integrations/cardsales', integrationMenus, zValidator('json', cardsalesBody, validationHook), async (c) => {
      const row = await registerSimple(deps, c.var.company, 'cardsales', { auth: c.req.valid('json') })
      return c.json(serializeIntegration(deps, row), 201)
    })
    .post('/integrations/creditcard/request-card-list', integrationMenus, zValidator('json', cardListBody, validationHook), async (c) => {
      const body = c.req.valid('json')
      return c.json({ candidates: await requestCandidates(deps, c.var.company, 'creditcard', body.card_codes, body.is_corporate, body) })
    })
    .post('/integrations/creditcard', integrationMenus, zValidator('json', creditcardBody, validationHook), async (c) => {
      const body = c.req.valid('json')
      const row = await registerWithItems(deps, c.var.company, 'creditcard', {
        code: body.creditcard_code,
        isCorporate: body.is_corporate,
        auth: body,
        externalKeys: body.cards.map((card) => card.external_key),
      })
      return c.json(serializeIntegration(deps, row), 201)
    })
    .get('/integrations/creditcard/:id', integrationMenus, (c) =>
      c.json(serializeIntegration(deps, requireIntegration(deps, c.var.company.id, c.req.param('id'), 'creditcard'))),
    )
    .put('/integrations/creditcard/:id/:cardId', integrationMenus, zValidator('json', cardNumberBody, validationHook), (c) =>
      c.json(correctCardNumber(deps, c.var.company.id, c.req.param('id'), c.req.param('cardId'), c.req.valid('json').card_number)),
    )
    .delete('/integrations/creditcard/:id/:cardId', integrationMenus, (c) => {
      removeItem(deps, c.var.company.id, c.req.param('id'), c.req.param('cardId'), 'creditcard')
      return c.body(null, 204)
    })
    .post('/integrations/bank/request-bank-list', integrationMenus, zValidator('json', bankListBody, validationHook), async (c) => {
      const body = c.req.valid('json')
      return c.json({ candidates: await requestCandidates(deps, c.var.company, 'bank', body.bank_codes, body.is_corporate, body) })
    })
    .patch('/integrations/bank/accounts', integrationMenus, zValidator('json', bankAccountsPatch, validationHook), (c) =>
      c.json({ accounts: patchBankAccounts(deps, c.var.company.id, c.req.valid('json').accounts) }),
    )
    .post('/integrations/bank', integrationMenus, zValidator('json', bankBody, validationHook), async (c) => {
      const body = c.req.valid('json')
      const row = await registerWithItems(deps, c.var.company, 'bank', {
        code: body.bank_code,
        isCorporate: body.is_corporate,
        auth: body,
        externalKeys: body.accounts.map((account) => account.external_key),
      })
      return c.json(serializeIntegration(deps, row), 201)
    })
    .get('/integrations/bank', integrationMenus, zValidator('query', bankQuery, validationHook), (c) => {
      const activeOnly = c.req.valid('query').is_active === 'true'
      return c.json(listIntegrations(deps.db, c.var.company.id, 'bank').map((row) => serializeIntegration(deps, row, { activeOnly })))
    })
    .get('/integrations/bank/:id', integrationMenus, zValidator('query', bankQuery, validationHook), (c) => {
      const row = requireIntegration(deps, c.var.company.id, c.req.param('id'), 'bank')
      return c.json(serializeIntegration(deps, row, { activeOnly: c.req.valid('query').is_active === 'true' }))
    })
    .delete('/integrations/bank/:id/:accountId', integrationMenus, (c) => {
      removeItem(deps, c.var.company.id, c.req.param('id'), c.req.param('accountId'), 'bank')
      return c.body(null, 204)
    })
    .post('/integrations/giro', integrationMenus, zValidator('json', giroBody, validationHook), async (c) => {
      const body = c.req.valid('json')
      const transient = body.giro_id !== undefined && body.giro_pw !== undefined ? { accountId: body.giro_id, password: body.giro_pw } : undefined
      const row = await registerSimple(deps, c.var.company, 'giro', { auth: { cert_id: body.cert_id, sign_pw: body.sign_pw }, transientSecrets: transient })
      return c.json(serializeIntegration(deps, row), 201)
    })
    .post('/integrations/speedbank', integrationMenus, zValidator('json', speedbankBody, validationHook), async (c) => {
      const body = c.req.valid('json')
      const row = await registerSimple(deps, c.var.company, 'speedbank', { subCode: body.bank_code, auth: body })
      return c.json(serializeIntegration(deps, row), 201)
    })
    .patch('/integrations/speedbank/:id', integrationMenus, zValidator('json', speedbankPatch, validationHook), async (c) =>
      c.json(serializeIntegration(deps, await updateSpeedbank(deps, c.var.company, c.req.param('id'), c.req.valid('json')))),
    )
    .delete('/integrations/speedbank/:id', integrationMenus, (c) => {
      removeIntegration(deps, c.var.company.id, c.req.param('id'), 'speedbank')
      return c.body(null, 204)
    })
    .get('/integrations/pg', integrationMenus, (c) => c.json(integrationBlocks(deps, c.var.company.id, 'pg')['pg']))
    .post('/integrations/pg/scrap-request', integrationMenus, (c) => c.json(requestScrap(deps, c.var.company.id, c.var.user.id, 'pg', {}), 201))
    .get('/integrations/pg/:id', integrationMenus, (c) => c.json(serializeIntegration(deps, requireIntegration(deps, c.var.company.id, c.req.param('id'), 'pg'))))
    .post('/integrations/pg', integrationMenus, zValidator('json', pgBody, validationHook), async (c) => {
      const { pg_company: pgCompany, mid, ...keys } = c.req.valid('json')
      const row = await registerPg(deps, c.var.company, { pg_company: pgCompany, mid, keys })
      return c.json(serializeIntegration(deps, row), 201)
    })
    .delete('/integrations/pg/:id', integrationMenus, (c) => {
      removeIntegration(deps, c.var.company.id, c.req.param('id'), 'pg')
      return c.body(null, 204)
    })
    .get('/integrations/delivery', integrationMenus, (c) => c.json(integrationBlocks(deps, c.var.company.id, 'delivery')['delivery']))
    .post('/integrations/delivery/scrap-request', integrationMenus, (c) => c.json(requestScrap(deps, c.var.company.id, c.var.user.id, 'delivery', {}), 201))
    .delete('/integrations/delivery/store/:storeId', integrationMenus, (c) => {
      removeItem(deps, c.var.company.id, null, c.req.param('storeId'), 'delivery')
      return c.body(null, 204)
    })
    .get('/integrations/delivery/:id', integrationMenus, (c) =>
      c.json(serializeIntegration(deps, requireIntegration(deps, c.var.company.id, c.req.param('id'), 'delivery'))),
    )
    .post('/integrations/delivery', integrationMenus, zValidator('json', deliveryBody, validationHook), async (c) => {
      const body = c.req.valid('json')
      const row = await registerDelivery(deps, c.var.company, { delivery_corp: body.delivery_corp, auth: body })
      return c.json({ ...serializeIntegration(deps, row), max_register_delivery_count: MAX_REGISTER_COUNT }, 201)
    })
    .delete('/integrations/:integrationId', integrationMenus, (c) => {
      const row = findIntegration(deps.db, c.var.company.id, c.req.param('integrationId'))
      if (row === undefined) throw notFound('Integration')
      removeIntegration(deps, c.var.company.id, row.id)
      return c.body(null, 204)
    })
    .get('/cert', certReadMenus, zValidator('query', certListQuery, validationHook), (c) =>
      c.json(listCompanyCertificates(deps, c.var.company.id, c.req.valid('query').detail === 'true')),
    )
    .post('/cert', requireMenu('cert_management'), zValidator('json', certUploadBody, validationHook), async (c) =>
      c.json(await registerCertificate(deps, c.var.company, c.var.user.id, c.req.valid('json')), 201),
    )
    .delete('/cert/:id', requireMenu('cert_management'), (c) => {
      removeCertificate(deps, c.var.company.id, c.req.param('id'))
      return c.body(null, 204)
    })
    .post('/cert/:id/join/giro', integrationMenus, zValidator('json', giroJoinBody, validationHook), async (c) => {
      await joinGiro(deps, c.var.company.id, c.req.param('id'), c.req.valid('json'))
      return c.json({ joined: true }, 201)
    })
    .post('/cert/:id/password_check', certReadMenus, zValidator('json', certPasswordBody, validationHook), async (c) => {
      await checkCertificatePassword(deps, c.var.company.id, c.req.param('id'), c.req.valid('json').sign_pw)
      return c.json({ is_valid: true })
    })
    .get('/partner/scrap/business-status', zValidator('query', businessStatusQuery, validationHook), async (c) =>
      c.json(await lookupBusinessStatus(deps, c.req.valid('query').business_number)),
    )
    .post('/partner/share-company/send', zValidator('json', shareCompanyBody, validationHook), async (c) =>
      c.json(await shareCompany(deps, c.var.company.id, c.var.user.id, c.req.valid('json')), 201),
    )
    .get('/share-histories/recent', (c) => c.json(recentShare(deps, c.var.company.id)))
    .get('/get-business_types', (c) => c.json(getBusinessTypes(deps, c.var.company.id)))
    .post('/update-business_types', async (c) => c.json(await refreshBusinessTypes(deps, c.var.company.id)))
}
