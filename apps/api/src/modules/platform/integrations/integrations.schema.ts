import { z } from 'zod'
import { DELIVERY_CORPS, INTEGRATION_TYPES } from './integrations.utils'

const secret = z.string().min(1).max(200)
const authFields = {
  account_id: z.string().min(1).max(100).optional(),
  account_pw: secret.optional(),
  cert_id: z.string().min(1).optional(),
  sign_pw: secret.optional(),
}

/** Query of the integration list and status endpoints. */
export const integrationTypeQuery = z.object({ integration_type: z.enum(INTEGRATION_TYPES as [string, ...string[]]).optional() })

/** Query of the scraping progress poll. */
export const scrapingStatusQuery = z.object({ id: z.string().min(1) })

/** Body of a manual collection request. */
export const scrapRequestBody = z
  .object({
    corporation_number_unused: z.boolean().optional(),
    integration_id: z.string().optional(),
    item_id: z.string().optional(),
  })
  .default({})

/** Body of `POST /integrations/hometax/`. */
export const hometaxBody = z.object({ auth_type: z.enum(['ID', 'CERTIFICATE']), ...authFields })

/** Body of `POST /integrations/cardsales/`. */
export const cardsalesBody = z.object({ account_id: z.string().min(1).max(100), account_pw: secret })

/** Body of the card and account candidate lookups. */
export const cardListBody = z.object({ card_codes: z.array(z.string().regex(/^\d{3}$/)).min(1), is_corporate: z.boolean(), ...authFields })

/** Body of `POST /integrations/bank/request-bank-list`. */
export const bankListBody = z.object({ bank_codes: z.array(z.string().regex(/^\d{3}$/)).min(1), is_corporate: z.boolean(), ...authFields })

/** Body of `POST /integrations/creditcard/`. */
export const creditcardBody = z.object({
  creditcard_code: z.string().regex(/^\d{3}$/),
  is_corporate: z.boolean(),
  cards: z.array(z.object({ external_key: z.string().min(1) })).min(1),
  ...authFields,
})

/** Body of `PUT /integrations/creditcard/:id/:cardId`. */
export const cardNumberBody = z.object({ card_number: z.string().min(14).max(19) })

/** Body of `POST /integrations/bank/`. */
export const bankBody = z.object({
  bank_code: z.string().regex(/^\d{3}$/),
  is_corporate: z.boolean(),
  accounts: z.array(z.object({ external_key: z.string().min(1) })).min(1),
  ...authFields,
})

/** Body of `PATCH /integrations/bank/accounts`. */
export const bankAccountsPatch = z.object({
  accounts: z
    .array(
      z.object({
        id: z.string().min(1),
        is_active: z.boolean().optional(),
        is_visible_on_cash_report: z.boolean().optional(),
        account_name: z.string().min(1).max(100).optional(),
      }),
    )
    .min(1),
})

/** Query of the bank integration endpoints. */
export const bankQuery = z.object({ is_active: z.enum(['true', 'false']).optional() })

/** Body of `POST /integrations/giro/`; the Giro ID and password are passed through, never stored. */
export const giroBody = z.object({ cert_id: z.string().min(1), sign_pw: secret, giro_id: z.string().min(1).optional(), giro_pw: secret.optional() })

/** Body of `POST /integrations/speedbank/`. */
export const speedbankBody = z.object({ bank_code: z.string().regex(/^\d{3}$/), account_id: z.string().min(1).max(100), account_pw: secret })

/** Body of `PATCH /integrations/speedbank/:id/`. */
export const speedbankPatch = z.object({ account_id: z.string().min(1).max(100).optional(), account_pw: secret.optional() })

/** Body of `POST /integrations/pg/`: the MID plus that PG's keys as top-level fields. */
export const pgBody = z.object({ pg_company: z.string().min(1), mid: z.string().min(1).max(100) }).catchall(z.string().max(500))

/** Body of `POST /integrations/delivery/`. */
export const deliveryBody = z.object({ delivery_corp: z.enum(DELIVERY_CORPS), account_id: z.string().min(1).max(100), account_pw: secret })

/** Query of the certificate list. */
export const certListQuery = z.object({ detail: z.enum(['true', 'false']).optional() })

/** Body of `POST /cert/`, the local agent's upload. */
export const certUploadBody = z.object({
  cert_der_b64: z.string().min(1),
  key_enc_b64: z.string().min(1),
  sign_pw: secret,
  subject_dn: z.string().min(1),
  oid: z.string().min(1),
  serial: z.string().min(1),
  pub_date: z.string(),
  end_date: z.string(),
  owner_name: z.string().min(1),
  owner_business_number: z.string().optional(),
  cert_name: z.string().optional(),
})

/** Body of `POST /cert/:id/password_check`. */
export const certPasswordBody = z.object({ sign_pw: secret })

/** Body of `POST /cert/:id/join/giro`. */
export const giroJoinBody = z.object({
  giro_id: z.string().min(1),
  giro_pw: secret,
  email: z.email(),
  phone: z.string().min(9).max(20),
  agreements: z.record(z.string(), z.boolean()),
})


