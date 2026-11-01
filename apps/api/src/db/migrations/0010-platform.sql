ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN name TEXT;
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1));
ALTER TABLE users ADD COLUMN marketing_agreed INTEGER NOT NULL DEFAULT 0 CHECK (marketing_agreed IN (0,1));
ALTER TABLE users ADD COLUMN created_at TEXT;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
CREATE UNIQUE INDEX users_email_ci ON users (lower(email));

CREATE TABLE user_social_accounts (
  provider      TEXT NOT NULL CHECK (provider IN ('kakao')),
  provider_uid  TEXT NOT NULL,
  user_id       TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL,
  PRIMARY KEY (provider, provider_uid)
) STRICT;

CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  csrf_token      TEXT NOT NULL,
  stay_signed_in  INTEGER NOT NULL CHECK (stay_signed_in IN (0,1)),
  user_agent      TEXT,
  ip              TEXT,
  created_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  revoked_at      TEXT
) STRICT;
CREATE INDEX sessions_user ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE one_time_tokens (
  token_hash  TEXT PRIMARY KEY,
  purpose     TEXT NOT NULL CHECK (purpose IN ('signup_email','password_reset','social_signup')),
  email       TEXT NOT NULL,
  user_id     TEXT REFERENCES users(id),
  payload     TEXT CHECK (payload IS NULL OR json_valid(payload)),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
) STRICT;

ALTER TABLE companies ADD COLUMN phone TEXT;
ALTER TABLE companies ADD COLUMN business_category TEXT;
ALTER TABLE companies ADD COLUMN zip_code TEXT;
ALTER TABLE companies ADD COLUMN address TEXT;
ALTER TABLE companies ADD COLUMN address_detail TEXT;
ALTER TABLE companies ADD COLUMN payday_month TEXT CHECK (payday_month IN ('current','next'));
ALTER TABLE companies ADD COLUMN payday_day TEXT;
ALTER TABLE companies ADD COLUMN corporate_number TEXT;
ALTER TABLE companies ADD COLUMN corp_investment_type INTEGER CHECK (corp_investment_type BETWEEN 1 AND 3);
ALTER TABLE companies ADD COLUMN corp_type INTEGER CHECK (corp_type BETWEEN 1 AND 9);
ALTER TABLE companies ADD COLUMN established_on TEXT;
ALTER TABLE companies ADD COLUMN region_code TEXT;
ALTER TABLE companies ADD COLUMN agency_id TEXT;
ALTER TABLE companies ADD COLUMN agency_type TEXT CHECK (agency_type IN ('hq','branch'));
ALTER TABLE companies ADD COLUMN updated_at TEXT;

CREATE TABLE company_representatives (
  company_id  TEXT NOT NULL REFERENCES companies(id),
  id          TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('boss','co_boss')),
  name        TEXT NOT NULL,
  phone       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, id)
) STRICT;

CREATE TABLE company_attachments (
  company_id   TEXT NOT NULL,
  name         TEXT NOT NULL CHECK (name IN ('CMS동의서','건강보험대행동의서','고용보험대행동의서','국민연금대행동의서','사업자등록증','이전세무전산자료')),
  file_id      TEXT NOT NULL,
  uploaded_by  TEXT NOT NULL REFERENCES users(id),
  uploaded_at  TEXT NOT NULL,
  PRIMARY KEY (company_id, name),
  FOREIGN KEY (company_id, file_id) REFERENCES files(company_id, id)
) STRICT;

ALTER TABLE memberships ADD COLUMN is_system_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_system_admin IN (0,1));
ALTER TABLE memberships ADD COLUMN joined_at TEXT;
ALTER TABLE memberships ADD COLUMN invited_by TEXT;

ALTER TABLE perm_roles ADD COLUMN created_at TEXT;
ALTER TABLE perm_roles ADD COLUMN updated_at TEXT;

CREATE TABLE perm_role_templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  menu_codes  TEXT NOT NULL CHECK (json_valid(menu_codes)),
  sort_order  INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE menu_favorites (
  company_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  menu_id     INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (company_id, user_id, menu_id),
  FOREIGN KEY (company_id, user_id) REFERENCES memberships(company_id, user_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE internal_invitations (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL REFERENCES companies(id),
  email             TEXT NOT NULL,
  token_hash        TEXT NOT NULL UNIQUE,
  is_admin          INTEGER NOT NULL CHECK (is_admin IN (0,1)),
  role_ids          TEXT NOT NULL CHECK (json_valid(role_ids)),
  status            TEXT NOT NULL CHECK (status IN ('pending','accepted','cancelled','expired')),
  invited_by        TEXT NOT NULL REFERENCES users(id),
  created_at        TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  accepted_at       TEXT,
  accepted_user_id  TEXT REFERENCES users(id),
  cancelled_at      TEXT,
  UNIQUE (company_id, id)
) STRICT;
CREATE UNIQUE INDEX internal_invitations_one_pending ON internal_invitations (company_id, lower(email)) WHERE status = 'pending';

CREATE TABLE terms (
  id              INTEGER PRIMARY KEY,
  code            TEXT NOT NULL,
  purpose_code    TEXT NOT NULL,
  title           TEXT NOT NULL,
  content_url     TEXT NOT NULL,
  version         TEXT NOT NULL,
  is_required     INTEGER NOT NULL CHECK (is_required IN (0,1)),
  audience        TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','taxation')),
  effective_from  TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  UNIQUE (code, version)
) STRICT;
CREATE INDEX terms_purpose ON terms (purpose_code, code, effective_from);

CREATE TABLE user_term_agreements (
  id          INTEGER PRIMARY KEY,
  user_id     TEXT REFERENCES users(id),
  email       TEXT,
  term_id     INTEGER NOT NULL REFERENCES terms(id),
  term_code   TEXT NOT NULL,
  version     TEXT NOT NULL,
  is_agreed   INTEGER NOT NULL CHECK (is_agreed IN (0,1)),
  ip          TEXT,
  user_agent  TEXT,
  agreed_at   TEXT NOT NULL,
  CHECK ((user_id IS NULL) <> (email IS NULL))
) STRICT;
CREATE INDEX user_term_agreements_user ON user_term_agreements (user_id, term_code, id);
CREATE INDEX user_term_agreements_guest ON user_term_agreements (lower(email), term_code, id) WHERE email IS NOT NULL;

CREATE TABLE company_subscriptions (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id),
  code         TEXT NOT NULL CHECK (code IN ('tax','payroll')),
  status       TEXT NOT NULL CHECK (status IN ('pending','active','cancelled','ended')),
  started_on   TEXT NOT NULL,
  ended_on     TEXT,
  contract_id  TEXT,
  monthly_fee  INTEGER NOT NULL DEFAULT 0 CHECK (monthly_fee >= 0),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (company_id, id)
) STRICT;
CREATE UNIQUE INDEX company_subscriptions_one_open ON company_subscriptions (company_id, code) WHERE status IN ('pending','active','cancelled');

CREATE TABLE billing_mandates (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT REFERENCES companies(id),
  business_number     TEXT NOT NULL,
  bank_code           TEXT NOT NULL,
  account_number_enc  TEXT NOT NULL,
  account_masked      TEXT NOT NULL,
  account_holder      TEXT NOT NULL,
  payer_id_enc        TEXT NOT NULL,
  consent_file_id     TEXT,
  source              TEXT NOT NULL CHECK (source IN ('upload','online')),
  status              TEXT NOT NULL CHECK (status IN ('pending','registered','rejected','revoked')),
  created_at          TEXT NOT NULL,
  registered_at       TEXT
) STRICT;

CREATE TABLE payments (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         TEXT NOT NULL REFERENCES companies(id),
  subscription_code  TEXT NOT NULL CHECK (subscription_code IN ('tax','payroll')),
  amount             INTEGER NOT NULL CHECK (amount > 0),
  scheduled_on       TEXT NOT NULL,
  attempted_on       TEXT,
  settled_at         TEXT,
  status             TEXT NOT NULL CHECK (status IN ('scheduled','paid','failed','retrying','refunded')),
  mandate_id         TEXT REFERENCES billing_mandates(id),
  failure_reason     TEXT,
  refunded_at        TEXT,
  parent_payment_id  INTEGER REFERENCES payments(id),
  created_at         TEXT NOT NULL,
  UNIQUE (company_id, subscription_code, scheduled_on, parent_payment_id)
) STRICT;

CREATE TABLE payment_events (
  id          INTEGER PRIMARY KEY,
  payment_id  INTEGER NOT NULL REFERENCES payments(id),
  type        TEXT NOT NULL,
  actor       TEXT NOT NULL,
  created_at  TEXT NOT NULL
) STRICT;

CREATE TABLE bookkeeping_contracts (
  id                    TEXT PRIMARY KEY,
  company_id            TEXT REFERENCES companies(id),
  business_number       TEXT,
  representative_phone  TEXT,
  fee_inputs            TEXT NOT NULL CHECK (json_valid(fee_inputs)),
  monthly_fee           INTEGER NOT NULL CHECK (monthly_fee >= 0),
  adjustment_fee        INTEGER NOT NULL CHECK (adjustment_fee >= 0),
  status                TEXT NOT NULL CHECK (status IN ('draft','identity_verified','sms_verified','form_requested','signed','active','expired')),
  form                  TEXT CHECK (form IS NULL OR json_valid(form)),
  signature             TEXT,
  kind                  TEXT NOT NULL DEFAULT 'online' CHECK (kind IN ('online','paper')),
  auto_renew            INTEGER NOT NULL DEFAULT 1 CHECK (auto_renew IN (0,1)),
  effective_on          TEXT,
  identity_verified_at  TEXT,
  sms_verified_at       TEXT,
  form_requested_at     TEXT,
  signed_at             TEXT,
  created_at            TEXT NOT NULL,
  expires_at            TEXT NOT NULL
) STRICT;

CREATE TABLE sms_verifications (
  id           TEXT PRIMARY KEY,
  purpose      TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  phone        TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  verified_at  TEXT
) STRICT;
CREATE INDEX sms_verifications_target ON sms_verifications (purpose, target_id, created_at);

CREATE TABLE signup_invitations (
  id               TEXT PRIMARY KEY,
  token_hash       TEXT NOT NULL UNIQUE,
  email            TEXT NOT NULL,
  company_name     TEXT,
  business_number  TEXT,
  business_type    TEXT CHECK (business_type IN ('corporate','individual')),
  agency_id        TEXT,
  contract_id      TEXT REFERENCES bookkeeping_contracts(id),
  status           TEXT NOT NULL CHECK (status IN ('issued','email_verified','agreed','completed','expired','revoked')),
  user_id          TEXT REFERENCES users(id),
  company_id       TEXT REFERENCES companies(id),
  created_at       TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  used_at          TEXT
) STRICT;

CREATE TABLE signup_sessions (
  id                TEXT PRIMARY KEY,
  invitation_id     TEXT NOT NULL REFERENCES signup_invitations(id),
  email             TEXT NOT NULL,
  email_verified_at TEXT NOT NULL,
  agreements        TEXT CHECK (agreements IS NULL OR json_valid(agreements)),
  agreed_at         TEXT,
  created_at        TEXT NOT NULL
) STRICT;

CREATE TABLE consult_leads (
  id                     TEXT PRIMARY KEY,
  company_id             TEXT REFERENCES companies(id),
  user_id                TEXT REFERENCES users(id),
  name                   TEXT NOT NULL,
  phone                  TEXT NOT NULL,
  email                  TEXT NOT NULL,
  company_name           TEXT,
  business_number        TEXT,
  legal_form             INTEGER,
  label_ids              TEXT NOT NULL CHECK (json_valid(label_ids)),
  memo                   TEXT,
  privacy_agreed_on      TEXT NOT NULL,
  third_party_agreed_on  TEXT NOT NULL,
  utm_source             TEXT,
  utm_medium             TEXT,
  utm_campaign           TEXT,
  utm_content            TEXT,
  status                 TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
  created_at             TEXT NOT NULL
) STRICT;

CREATE TABLE online_leads (
  timestamp_key  TEXT PRIMARY KEY,
  data           TEXT NOT NULL CHECK (json_valid(data)),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
) STRICT;

CREATE TABLE partner_clients (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  api_key_hash    TEXT NOT NULL UNIQUE,
  jwt_secret_enc  TEXT NOT NULL,
  created_at      TEXT NOT NULL
) STRICT;

CREATE TABLE partner_company_links (
  partner_id    TEXT NOT NULL REFERENCES partner_clients(id),
  company_id    TEXT NOT NULL REFERENCES companies(id),
  external_ref  TEXT,
  linked_by     TEXT REFERENCES users(id),
  linked_at     TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('active','revoked')),
  PRIMARY KEY (partner_id, company_id)
) STRICT;

CREATE TABLE chat_channel_tokens (
  token_hash      TEXT PRIMARY KEY,
  messenger_type  TEXT NOT NULL CHECK (messenger_type IN ('slack','kakaotalk')),
  channel_name    TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  used_at         TEXT,
  used_by         TEXT REFERENCES users(id),
  company_id      TEXT REFERENCES companies(id)
) STRICT;

CREATE TABLE hometax_delegations (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  agency_name   TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('requested','agreed','revoked')),
  requested_at  TEXT NOT NULL,
  agreed_at     TEXT,
  agreed_by     TEXT REFERENCES users(id)
) STRICT;

CREATE TABLE certificates (
  id                     TEXT PRIMARY KEY,
  company_id             TEXT NOT NULL REFERENCES companies(id),
  cert_name              TEXT NOT NULL,
  subject_dn             TEXT NOT NULL,
  oid                    TEXT NOT NULL,
  cert_type              TEXT NOT NULL CHECK (cert_type IN ('personal','business')),
  usage                  TEXT NOT NULL CHECK (usage IN ('general','bank','etax')),
  organization_code      TEXT NOT NULL,
  serial                 TEXT NOT NULL,
  pub_date               TEXT NOT NULL,
  end_date               TEXT NOT NULL,
  owner_name             TEXT NOT NULL,
  owner_business_number  TEXT,
  status                 TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  cert_blob_enc          TEXT NOT NULL,
  key_blob_enc           TEXT NOT NULL,
  sign_pw_enc            TEXT NOT NULL,
  registered_by          TEXT NOT NULL REFERENCES users(id),
  created_at             TEXT NOT NULL,
  modified_at            TEXT NOT NULL,
  deleted_at             TEXT,
  UNIQUE (company_id, id)
) STRICT;
CREATE UNIQUE INDEX certificates_serial ON certificates (company_id, serial) WHERE deleted_at IS NULL;

CREATE TABLE integrations (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  type            TEXT NOT NULL CHECK (type IN ('hometax','giro','cardsales','bank','creditcard','allra','speedbank','pg','delivery')),
  sub_code        TEXT,
  auth_type       TEXT NOT NULL CHECK (auth_type IN ('id','certificate','speedbank','api_key','oauth')),
  is_corporate    INTEGER NOT NULL DEFAULT 0 CHECK (is_corporate IN (0,1)),
  certificate_id  TEXT,
  account_id      TEXT,
  status          TEXT NOT NULL CHECK (status IN ('active','inactive','error','deleted')),
  created_at      TEXT NOT NULL,
  modified_at     TEXT NOT NULL,
  deleted_at      TEXT,
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, certificate_id) REFERENCES certificates(company_id, id)
) STRICT;
CREATE INDEX integrations_company ON integrations (company_id, type) WHERE status <> 'deleted';

CREATE TABLE integration_credentials (
  integration_id  TEXT PRIMARY KEY REFERENCES integrations(id) ON DELETE CASCADE,
  ciphertext      TEXT NOT NULL,
  key_version     TEXT NOT NULL,
  created_at      TEXT NOT NULL
) STRICT;

CREATE TABLE integration_items (
  id                         TEXT PRIMARY KEY,
  company_id                 TEXT NOT NULL,
  integration_id             TEXT NOT NULL,
  kind                       TEXT NOT NULL CHECK (kind IN ('card','account','store','scm')),
  external_key               TEXT NOT NULL,
  name                       TEXT NOT NULL,
  number_enc                 TEXT,
  masked_number              TEXT,
  account_type               TEXT,
  currency_code              TEXT,
  holder                     TEXT,
  open_date                  TEXT,
  balance                    INTEGER,
  is_active                  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  is_visible_on_cash_report  INTEGER NOT NULL DEFAULT 1 CHECK (is_visible_on_cash_report IN (0,1)),
  is_scrap_available         INTEGER NOT NULL DEFAULT 1 CHECK (is_scrap_available IN (0,1)),
  created_at                 TEXT NOT NULL,
  modified_at                TEXT NOT NULL,
  deleted_at                 TEXT,
  FOREIGN KEY (company_id, integration_id) REFERENCES integrations(company_id, id)
) STRICT;
CREATE INDEX integration_items_integration ON integration_items (integration_id) WHERE deleted_at IS NULL;

CREATE TABLE scrap_requests_v2 (
  id                 TEXT PRIMARY KEY DEFAULT ('sr-' || lower(hex(randomblob(8)))),
  company_id         TEXT NOT NULL REFERENCES companies(id),
  service            TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('request','done','timeout')),
  requested_at       TEXT NOT NULL,
  finished_at        TEXT,
  group_id           TEXT,
  requester          TEXT NOT NULL DEFAULT 'system' CHECK (requester IN ('user','system')),
  requested_by       TEXT REFERENCES users(id),
  integration_id     TEXT,
  item_id            TEXT,
  options            TEXT CHECK (options IS NULL OR json_valid(options)),
  code               TEXT,
  message            TEXT,
  is_initial         INTEGER NOT NULL DEFAULT 0 CHECK (is_initial IN (0,1)),
  next_available_at  TEXT,
  timeout_at         TEXT
) STRICT;
INSERT INTO scrap_requests_v2 (id, company_id, service, status, requested_at, finished_at)
  SELECT 'sr-legacy-' || rowid, company_id, service, status, requested_at, finished_at FROM scrap_requests;
DROP TABLE scrap_requests;
ALTER TABLE scrap_requests_v2 RENAME TO scrap_requests;
CREATE INDEX scrap_requests_latest ON scrap_requests (company_id, service, requested_at);
CREATE INDEX scrap_requests_group ON scrap_requests (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX scrap_requests_open ON scrap_requests (status) WHERE status = 'request';

CREATE TABLE scrap_results (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES companies(id),
  request_id       TEXT REFERENCES scrap_requests(id),
  service          TEXT NOT NULL,
  integration_id   TEXT NOT NULL,
  item_id          TEXT,
  status           TEXT NOT NULL CHECK (status IN ('success','fail','progress')),
  code             TEXT,
  message          TEXT,
  message_content  TEXT,
  is_initial       INTEGER NOT NULL DEFAULT 0 CHECK (is_initial IN (0,1)),
  is_retryable     INTEGER NOT NULL DEFAULT 1 CHECK (is_retryable IN (0,1)),
  record_count     INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL
) STRICT;
CREATE INDEX scrap_results_latest ON scrap_results (integration_id, item_id, created_at);

CREATE TABLE ai_conversations (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  UNIQUE (company_id, id)
) STRICT;

CREATE TABLE ai_messages (
  id               INTEGER PRIMARY KEY,
  company_id       TEXT NOT NULL,
  conversation_id  TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
  content          TEXT NOT NULL,
  tool_calls       TEXT CHECK (tool_calls IS NULL OR json_valid(tool_calls)),
  created_at       TEXT NOT NULL,
  FOREIGN KEY (company_id, conversation_id) REFERENCES ai_conversations(company_id, id)
) STRICT;

CREATE TABLE grants (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  title           TEXT NOT NULL,
  agency          TEXT NOT NULL,
  region_codes    TEXT NOT NULL CHECK (json_valid(region_codes)),
  industry_codes  TEXT NOT NULL CHECK (json_valid(industry_codes)),
  apply_start_on  TEXT NOT NULL,
  apply_end_on    TEXT,
  url             TEXT NOT NULL,
  summary         TEXT NOT NULL,
  fetched_at      TEXT NOT NULL,
  UNIQUE (source, source_id)
) STRICT;
