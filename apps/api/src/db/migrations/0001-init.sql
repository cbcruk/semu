CREATE TABLE companies (
  id                     TEXT PRIMARY KEY,
  nexus_company_id       TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  business_number        TEXT NOT NULL UNIQUE,
  business_type          TEXT NOT NULL CHECK (business_type IN ('corporate','individual')),
  tax_plan               TEXT CHECK (tax_plan IN ('taxation')),
  has_payroll_plan       INTEGER NOT NULL DEFAULT 0 CHECK (has_payroll_plan IN (0,1)),
  fiscal_year_end_month  INTEGER NOT NULL DEFAULT 12 CHECK (fiscal_year_end_month BETWEEN 1 AND 12),
  withholding_semiannual INTEGER NOT NULL DEFAULT 0 CHECK (withholding_semiannual IN (0,1)),
  vat_preliminary_mode   TEXT NOT NULL DEFAULT 'filing' CHECK (vat_preliminary_mode IN ('filing','notice')),
  sincere_filing_target  INTEGER NOT NULL DEFAULT 0 CHECK (sincere_filing_target IN (0,1)),
  taxable_card_ratio_bp  INTEGER NOT NULL DEFAULT 10000 CHECK (taxable_card_ratio_bp BETWEEN 0 AND 10000),
  created_at             TEXT NOT NULL
) STRICT;

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  user_type   INTEGER NOT NULL CHECK (user_type IN (0,1,2,3,4,51,99)),
  manager_id  TEXT REFERENCES users(id)
) STRICT;

CREATE TABLE term_agreements (
  user_id     TEXT NOT NULL REFERENCES users(id),
  term_type   TEXT NOT NULL CHECK (term_type IN ('signup','tax')),
  version     TEXT NOT NULL,
  agreed_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, term_type, version)
) STRICT;

CREATE TABLE memberships (
  company_id  TEXT NOT NULL REFERENCES companies(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  role        TEXT NOT NULL CHECK (role IN ('admin','member')),
  PRIMARY KEY (company_id, user_id)
) STRICT;

CREATE TABLE perm_roles (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  name        TEXT NOT NULL,
  menu_codes  TEXT NOT NULL CHECK (json_valid(menu_codes)),
  UNIQUE (company_id, name),
  UNIQUE (company_id, id)
) STRICT;

CREATE TABLE membership_roles (
  company_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  role_id     TEXT NOT NULL,
  PRIMARY KEY (company_id, user_id, role_id),
  FOREIGN KEY (company_id, user_id) REFERENCES memberships(company_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, role_id) REFERENCES perm_roles(company_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE agency_assignments (
  user_id     TEXT NOT NULL REFERENCES users(id),
  company_id  TEXT NOT NULL REFERENCES companies(id),
  PRIMARY KEY (user_id, company_id)
) STRICT;

CREATE TABLE menu_tree_versions (
  version     TEXT PRIMARY KEY,
  tree        TEXT NOT NULL CHECK (json_valid(tree)),
  is_latest   INTEGER NOT NULL DEFAULT 0 CHECK (is_latest IN (0,1)),
  created_at  TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX menu_tree_versions_latest ON menu_tree_versions (is_latest) WHERE is_latest = 1;

CREATE TABLE tax_filings (
  id                    TEXT PRIMARY KEY,
  company_id            TEXT NOT NULL REFERENCES companies(id),
  tax_type              TEXT NOT NULL CHECK (tax_type IN ('surtax','withholding_tax','corporation_tax','aggr_income_tax')),
  kind                  TEXT NOT NULL CHECK (kind IN ('preliminary','final','notice','monthly','semiannual','annual')),
  tax_period_key        TEXT NOT NULL,
  revision              INTEGER NOT NULL DEFAULT 0,
  year                  INTEGER NOT NULL,
  quarter               INTEGER CHECK (quarter BETWEEN 1 AND 4),
  period_start          TEXT NOT NULL,
  period_end            TEXT NOT NULL,
  statutory_due         TEXT,
  due_date              TEXT,
  payment_due           TEXT,
  submit_due            TEXT,
  status                TEXT NOT NULL CHECK (status IN ('scheduled','requested','submitted','reviewing','ledger_pending','preparing','filed','settled','cancelled')),
  payable_amount        INTEGER,
  settlement            TEXT CHECK (settlement IN ('paid','refund','no_payment')),
  paid_on               TEXT,
  ledger_uploaded_at    TEXT,
  ledger_confirmed_at   TEXT,
  ledger_dispute_count  INTEGER NOT NULL DEFAULT 0,
  payment_slip_sent_at  TEXT,
  version               INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE (company_id, id),
  UNIQUE (company_id, tax_type, tax_period_key, revision),
  CHECK ((kind = 'notice') OR (due_date IS NOT NULL AND statutory_due IS NOT NULL)),
  CHECK (status <> 'ledger_pending' OR tax_type = 'surtax'),
  CHECK ((status IN ('filed','settled')) = (payable_amount IS NOT NULL)),
  CHECK ((status IN ('filed','settled')) <= (payment_due IS NOT NULL)),
  CHECK ((status = 'settled') = (settlement IS NOT NULL)),
  CHECK ((settlement = 'paid') = (paid_on IS NOT NULL)),
  CHECK (settlement IS NULL
         OR (settlement = 'paid'       AND payable_amount > 0)
         OR (settlement = 'refund'     AND payable_amount < 0)
         OR (settlement = 'no_payment' AND payable_amount = 0))
) STRICT;
CREATE INDEX tax_filings_company_list ON tax_filings (company_id, tax_type, year DESC, quarter DESC);
CREATE INDEX tax_filings_open ON tax_filings (status, due_date) WHERE status NOT IN ('settled','cancelled');

CREATE TABLE filing_requirements (
  company_id    TEXT NOT NULL,
  filing_id     TEXT NOT NULL,
  code          TEXT NOT NULL,
  label         TEXT NOT NULL,
  response      TEXT NOT NULL DEFAULT 'pending' CHECK (response IN ('pending','provided','not_applicable')),
  auto_linked   INTEGER NOT NULL DEFAULT 0 CHECK (auto_linked IN (0,1)),
  note          TEXT,
  updated_by    TEXT,
  updated_at    TEXT,
  PRIMARY KEY (filing_id, code),
  FOREIGN KEY (company_id, filing_id) REFERENCES tax_filings(company_id, id)
) STRICT;

CREATE TABLE files (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  storage_key   TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  uploaded_by   TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL,
  UNIQUE (company_id, id),
  UNIQUE (company_id, sha256)
) STRICT;

CREATE TABLE requirement_files (
  company_id  TEXT NOT NULL,
  filing_id   TEXT NOT NULL,
  code        TEXT NOT NULL,
  file_id     TEXT NOT NULL,
  PRIMARY KEY (filing_id, code, file_id),
  FOREIGN KEY (filing_id, code)     REFERENCES filing_requirements(filing_id, code) ON DELETE CASCADE,
  FOREIGN KEY (company_id, file_id) REFERENCES files(company_id, id)
) STRICT;

CREATE TABLE filing_documents (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL,
  filing_id       TEXT NOT NULL,
  doc_type        TEXT NOT NULL CHECK (doc_type IN ('ledger','return','payment_slip','notice')),
  file_id         TEXT NOT NULL,
  first_viewed_at TEXT,
  replaced_at     TEXT,
  created_at      TEXT NOT NULL,
  FOREIGN KEY (company_id, filing_id) REFERENCES tax_filings(company_id, id),
  FOREIGN KEY (company_id, file_id)   REFERENCES files(company_id, id)
) STRICT;

CREATE TABLE filing_events (
  id          INTEGER PRIMARY KEY,
  company_id  TEXT NOT NULL,
  filing_id   TEXT NOT NULL,
  actor_type  TEXT NOT NULL CHECK (actor_type IN ('client','agency','system')),
  actor_id    TEXT,
  type        TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  payload     TEXT CHECK (payload IS NULL OR json_valid(payload)),
  created_at  TEXT NOT NULL,
  FOREIGN KEY (company_id, filing_id) REFERENCES tax_filings(company_id, id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX filing_events_filing ON filing_events (filing_id, id);

CREATE TABLE action_cards (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  source_type   TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  kind          TEXT NOT NULL,
  menu_code     TEXT NOT NULL,
  title         TEXT NOT NULL,
  cta_path      TEXT NOT NULL,
  due_date      TEXT,
  status        TEXT NOT NULL CHECK (status IN ('open','done','skipped_overdue')),
  reopen_count  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  completed_at  TEXT,
  UNIQUE (company_id, source_type, source_id, kind),
  CHECK ((status = 'open') = (completed_at IS NULL))
) STRICT;
CREATE INDEX action_cards_open ON action_cards (company_id, status, due_date);

CREATE TABLE action_card_events (
  id          INTEGER PRIMARY KEY,
  card_id     TEXT NOT NULL REFERENCES action_cards(id),
  type        TEXT NOT NULL CHECK (type IN ('created','completed','skipped','reopened','closed_by_system')),
  actor_id    TEXT,
  created_at  TEXT NOT NULL
) STRICT;

CREATE TABLE sales_evidence (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  source          TEXT NOT NULL CHECK (source IN ('tax_invoice','cash_receipt','card','pg','mall','delivery')),
  issued_on       TEXT NOT NULL,
  total_amount    INTEGER NOT NULL,
  supply_amount   INTEGER,
  vat_amount      INTEGER,
  dedupe_group    TEXT,
  synced_at       TEXT NOT NULL
) STRICT;
CREATE INDEX sales_evidence_period ON sales_evidence (company_id, issued_on);

CREATE TABLE purchase_evidence (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  source          TEXT NOT NULL CHECK (source IN ('tax_invoice','cash_receipt','card')),
  issued_on       TEXT NOT NULL,
  supply_amount   INTEGER NOT NULL,
  vat_amount      INTEGER NOT NULL,
  account_code    TEXT,
  deductible      INTEGER CHECK (deductible IN (0,1)),
  synced_at       TEXT NOT NULL
) STRICT;
CREATE INDEX purchase_evidence_period ON purchase_evidence (company_id, issued_on);

CREATE TABLE scrap_requests (
  company_id    TEXT NOT NULL REFERENCES companies(id),
  service       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('request','done','timeout')),
  requested_at  TEXT NOT NULL,
  finished_at   TEXT,
  PRIMARY KEY (company_id, service, requested_at)
) STRICT;

CREATE TABLE public_holidays (
  date  TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  kind  TEXT NOT NULL CHECK (kind IN ('public','substitute','temporary','statutory_extra'))
) STRICT;

CREATE TABLE tax_rules (
  key             TEXT NOT NULL,
  effective_from  TEXT NOT NULL,
  value           TEXT NOT NULL CHECK (json_valid(value)),
  PRIMARY KEY (key, effective_from)
) STRICT;
