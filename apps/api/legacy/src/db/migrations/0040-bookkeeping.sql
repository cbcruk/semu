CREATE TABLE bookkeeping_settings (
  company_id               TEXT PRIMARY KEY REFERENCES companies(id),
  sales_status_sources     TEXT NOT NULL DEFAULT 'all' CHECK (sales_status_sources IN ('all','vat_included')),
  realtime_pl_basis        TEXT NOT NULL DEFAULT 'supply' CHECK (realtime_pl_basis IN ('supply','total')),
  realtime_pl_include_bank INTEGER NOT NULL DEFAULT 1 CHECK (realtime_pl_include_bank IN (0,1)),
  premium_settlement       INTEGER NOT NULL DEFAULT 0 CHECK (premium_settlement IN (0,1)),
  updated_at               TEXT NOT NULL
) STRICT;

CREATE TABLE account_titles (
  id             TEXT PRIMARY KEY,
  company_id     TEXT REFERENCES companies(id),
  parent_id      TEXT REFERENCES account_titles(id),
  depth          INTEGER NOT NULL CHECK (depth IN (1,2,3)),
  code           TEXT,
  name           TEXT NOT NULL,
  description    TEXT,
  applies_to     TEXT NOT NULL CHECK (json_valid(applies_to)),
  pl_category    TEXT NOT NULL CHECK (pl_category IN ('revenue','cogs','sga','non_op_income','non_op_expense','income_tax','none')),
  cash_category  TEXT,
  is_system      INTEGER NOT NULL DEFAULT 1 CHECK (is_system IN (0,1)),
  is_auto_etc    INTEGER NOT NULL DEFAULT 0 CHECK (is_auto_etc IN (0,1)),
  sort_order     INTEGER NOT NULL,
  deleted_at     TEXT,
  created_at     TEXT NOT NULL,
  CHECK ((depth = 1) = (parent_id IS NULL))
) STRICT;
CREATE UNIQUE INDEX account_titles_name ON account_titles (COALESCE(company_id, ''), parent_id, name) WHERE deleted_at IS NULL;
CREATE INDEX account_titles_parent ON account_titles (parent_id);

CREATE TABLE partners (
  id                         TEXT PRIMARY KEY,
  company_id                 TEXT NOT NULL REFERENCES companies(id),
  partner_type               TEXT NOT NULL CHECK (partner_type IN ('business','individual')),
  business_entity_type       TEXT CHECK (business_entity_type IN ('corporation','individual')),
  name                       TEXT NOT NULL,
  representative_name        TEXT NOT NULL,
  business_number            TEXT,
  business_status            TEXT CHECK (business_status IN ('registered','suspended','closed','unknown')),
  is_sales                   INTEGER NOT NULL DEFAULT 0 CHECK (is_sales IN (0,1)),
  is_purchase                INTEGER NOT NULL DEFAULT 0 CHECK (is_purchase IN (0,1)),
  business_type              TEXT,
  business_class             TEXT,
  address                    TEXT,
  phone_number               TEXT,
  memo                       TEXT CHECK (memo IS NULL OR length(memo) <= 1000),
  representative_image_path  TEXT,
  primary_account_id         TEXT,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL,
  deleted_at                 TEXT,
  UNIQUE (company_id, id)
) STRICT;
CREATE UNIQUE INDEX partners_business_number ON partners (company_id, business_number) WHERE business_number IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE partner_bank_accounts (
  id                    TEXT PRIMARY KEY,
  partner_id            TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  bank_code             TEXT NOT NULL,
  account_number_enc    TEXT NOT NULL,
  account_number_tail   TEXT NOT NULL,
  account_name          TEXT,
  bankbook_image_path   TEXT,
  seq                   INTEGER NOT NULL
) STRICT;

CREATE TABLE partner_contacts (
  id             TEXT PRIMARY KEY,
  partner_id     TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  department     TEXT,
  email          TEXT,
  phone_number   TEXT,
  mobile_number  TEXT,
  fax_number     TEXT,
  seq            INTEGER NOT NULL
) STRICT;

CREATE TABLE partner_business_status_cache (
  business_number  TEXT PRIMARY KEY,
  business_status  TEXT NOT NULL CHECK (business_status IN ('registered','suspended','closed','unknown')),
  taxation_type    TEXT,
  closed_on        TEXT,
  checked_at       TEXT NOT NULL
) STRICT;

CREATE TABLE classification_rules (
  id                       TEXT PRIMARY KEY,
  company_id               TEXT NOT NULL REFERENCES companies(id),
  scope                    TEXT NOT NULL CHECK (scope IN ('sales','purchase','bank')),
  source                   TEXT,
  name                     TEXT NOT NULL,
  conditions               TEXT NOT NULL CHECK (json_valid(conditions)),
  result_account_title_id  TEXT REFERENCES account_titles(id),
  result_partner_id        TEXT REFERENCES partners(id),
  priority                 INTEGER NOT NULL,
  is_hidden                INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0,1)),
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  UNIQUE (company_id, id),
  CHECK (result_account_title_id IS NOT NULL OR result_partner_id IS NOT NULL)
) STRICT;
CREATE INDEX classification_rules_order ON classification_rules (company_id, scope, priority);

CREATE TABLE rule_apply_jobs (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id),
  scope        TEXT NOT NULL CHECK (scope IN ('sales','purchase','bank')),
  rule_id      TEXT,
  mode         TEXT NOT NULL CHECK (mode IN ('fill_empty','overwrite')),
  status       TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
  total        INTEGER NOT NULL DEFAULT 0,
  processed    INTEGER NOT NULL DEFAULT 0,
  updated      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  finished_at  TEXT
) STRICT;

ALTER TABLE sales_evidence ADD COLUMN external_key TEXT;
ALTER TABLE sales_evidence ADD COLUMN doc_type TEXT CHECK (doc_type IN ('tax_invoice','modified_tax_invoice','invoice','modified_invoice'));
ALTER TABLE sales_evidence ADD COLUMN kind TEXT CHECK (kind IN ('normal','zero_rate','delegation','zero_rate_delegation'));
ALTER TABLE sales_evidence ADD COLUMN written_on TEXT;
ALTER TABLE sales_evidence ADD COLUMN counterparty_business_number TEXT;
ALTER TABLE sales_evidence ADD COLUMN counterparty_name TEXT;
ALTER TABLE sales_evidence ADD COLUMN partner_id TEXT REFERENCES partners(id);
ALTER TABLE sales_evidence ADD COLUMN item_summary TEXT;
ALTER TABLE sales_evidence ADD COLUMN items TEXT CHECK (items IS NULL OR json_valid(items));
ALTER TABLE sales_evidence ADD COLUMN account_title_id TEXT REFERENCES account_titles(id);
ALTER TABLE sales_evidence ADD COLUMN classified_by TEXT CHECK (classified_by IN ('manual','rule'));
ALTER TABLE sales_evidence ADD COLUMN classified_rule_id TEXT REFERENCES classification_rules(id) ON DELETE SET NULL;
ALTER TABLE sales_evidence ADD COLUMN memo TEXT;
ALTER TABLE sales_evidence ADD COLUMN card_number_masked TEXT;
ALTER TABLE sales_evidence ADD COLUMN card_company_code TEXT;
ALTER TABLE sales_evidence ADD COLUMN approval_no TEXT;
ALTER TABLE sales_evidence ADD COLUMN channel TEXT;
ALTER TABLE sales_evidence ADD COLUMN is_canceled INTEGER NOT NULL DEFAULT 0 CHECK (is_canceled IN (0,1));
ALTER TABLE sales_evidence ADD COLUMN sales_transaction_id TEXT;
UPDATE sales_evidence SET external_key = id WHERE external_key IS NULL;
CREATE UNIQUE INDEX sales_evidence_external ON sales_evidence (company_id, source, external_key) WHERE external_key IS NOT NULL;
CREATE INDEX sales_evidence_written ON sales_evidence (company_id, source, written_on);
CREATE INDEX sales_evidence_account ON sales_evidence (company_id, account_title_id);

ALTER TABLE purchase_evidence ADD COLUMN external_key TEXT;
ALTER TABLE purchase_evidence ADD COLUMN doc_type TEXT CHECK (doc_type IN ('tax_invoice','modified_tax_invoice','invoice','modified_invoice'));
ALTER TABLE purchase_evidence ADD COLUMN kind TEXT CHECK (kind IN ('normal','zero_rate','delegation','zero_rate_delegation'));
ALTER TABLE purchase_evidence ADD COLUMN written_on TEXT;
ALTER TABLE purchase_evidence ADD COLUMN counterparty_business_number TEXT;
ALTER TABLE purchase_evidence ADD COLUMN counterparty_name TEXT;
ALTER TABLE purchase_evidence ADD COLUMN partner_id TEXT REFERENCES partners(id);
ALTER TABLE purchase_evidence ADD COLUMN item_summary TEXT;
ALTER TABLE purchase_evidence ADD COLUMN items TEXT CHECK (items IS NULL OR json_valid(items));
ALTER TABLE purchase_evidence ADD COLUMN total_amount INTEGER;
ALTER TABLE purchase_evidence ADD COLUMN account_title_id TEXT REFERENCES account_titles(id);
ALTER TABLE purchase_evidence ADD COLUMN classified_by TEXT CHECK (classified_by IN ('manual','rule'));
ALTER TABLE purchase_evidence ADD COLUMN classified_rule_id TEXT REFERENCES classification_rules(id) ON DELETE SET NULL;
ALTER TABLE purchase_evidence ADD COLUMN memo TEXT;
ALTER TABLE purchase_evidence ADD COLUMN card_number_masked TEXT;
ALTER TABLE purchase_evidence ADD COLUMN card_company_code TEXT;
ALTER TABLE purchase_evidence ADD COLUMN approval_no TEXT;
ALTER TABLE purchase_evidence ADD COLUMN is_canceled INTEGER NOT NULL DEFAULT 0 CHECK (is_canceled IN (0,1));
UPDATE purchase_evidence SET external_key = id WHERE external_key IS NULL;
CREATE UNIQUE INDEX purchase_evidence_external ON purchase_evidence (company_id, source, external_key) WHERE external_key IS NOT NULL;
CREATE INDEX purchase_evidence_written ON purchase_evidence (company_id, source, written_on);
CREATE INDEX purchase_evidence_account ON purchase_evidence (company_id, account_title_id);

CREATE TABLE bank_accounts (
  id                         TEXT PRIMARY KEY,
  company_id                 TEXT NOT NULL REFERENCES companies(id),
  integration_id             TEXT,
  bank_code                  TEXT NOT NULL,
  account_number_enc         TEXT NOT NULL,
  account_number_digest      TEXT NOT NULL,
  account_number_tail        TEXT NOT NULL,
  account_name               TEXT,
  account_type               TEXT NOT NULL CHECK (account_type IN ('01','02','11','21','31','41','51','61')),
  is_corporate               INTEGER NOT NULL DEFAULT 1 CHECK (is_corporate IN (0,1)),
  currency_code              TEXT NOT NULL DEFAULT 'KRW',
  holder                     TEXT,
  open_date                  TEXT,
  end_date                   TEXT,
  balance                    INTEGER,
  balance_fx                 TEXT,
  fx_rate                    TEXT,
  is_dormant                 INTEGER NOT NULL DEFAULT 0 CHECK (is_dormant IN (0,1)),
  is_active                  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  is_visible_on_cash_report  INTEGER NOT NULL DEFAULT 1 CHECK (is_visible_on_cash_report IN (0,1)),
  last_transaction_date      TEXT,
  external_key               TEXT,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL,
  UNIQUE (company_id, bank_code, account_number_digest),
  UNIQUE (company_id, id)
) STRICT;

CREATE TABLE bank_balance_snapshots (
  account_id       TEXT NOT NULL REFERENCES bank_accounts(id),
  date             TEXT NOT NULL,
  closing_balance  INTEGER NOT NULL,
  source           TEXT NOT NULL CHECK (source IN ('scrap','derived')),
  PRIMARY KEY (account_id, date)
) STRICT;

CREATE TABLE bank_transactions (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES companies(id),
  account_id          TEXT NOT NULL,
  external_key        TEXT NOT NULL,
  transacted_at       TEXT NOT NULL,
  direction           TEXT NOT NULL CHECK (direction IN ('deposit','withdrawal')),
  amount              INTEGER NOT NULL,
  balance_after       INTEGER,
  summary             TEXT,
  currency_code       TEXT NOT NULL DEFAULT 'KRW',
  amount_fx           TEXT,
  account_title_id    TEXT REFERENCES account_titles(id),
  classified_by       TEXT CHECK (classified_by IN ('manual','rule')),
  classified_rule_id  TEXT REFERENCES classification_rules(id) ON DELETE SET NULL,
  partner_id          TEXT REFERENCES partners(id),
  memo                TEXT CHECK (memo IS NULL OR length(memo) <= 50),
  settlement_status   TEXT NOT NULL DEFAULT 'not_applicable' CHECK (settlement_status IN ('partner_required','unmatched','matched','not_applicable')),
  synced_at           TEXT NOT NULL,
  UNIQUE (company_id, account_id, external_key),
  FOREIGN KEY (company_id, account_id) REFERENCES bank_accounts(company_id, id),
  CHECK ((direction = 'deposit') = (amount >= 0))
) STRICT;
CREATE INDEX bank_tx_period ON bank_transactions (company_id, transacted_at);
CREATE INDEX bank_tx_partner ON bank_transactions (company_id, partner_id);

CREATE TABLE settlement_links (
  id                   TEXT PRIMARY KEY,
  company_id           TEXT NOT NULL REFERENCES companies(id),
  bank_transaction_id  TEXT NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  evidence_side        TEXT NOT NULL CHECK (evidence_side IN ('sales','purchase')),
  evidence_id          TEXT NOT NULL,
  amount               INTEGER NOT NULL CHECK (amount > 0),
  created_at           TEXT NOT NULL,
  UNIQUE (bank_transaction_id, evidence_side, evidence_id)
) STRICT;
CREATE INDEX settlement_links_evidence ON settlement_links (company_id, evidence_side, evidence_id);

CREATE TABLE sales_transactions (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES companies(id),
  partner_id          TEXT REFERENCES partners(id),
  class_code          TEXT NOT NULL CHECK (class_code IN ('01','02','03','04')),
  kind_code           TEXT NOT NULL CHECK (kind_code IN ('01','02','03','04')),
  buyer_class_code    TEXT NOT NULL CHECK (buyer_class_code IN ('01','02','03')),
  purpose             TEXT NOT NULL CHECK (purpose IN ('01','02')),
  write_date          TEXT NOT NULL,
  description         TEXT,
  cash                INTEGER,
  check_bill          INTEGER,
  note                INTEGER,
  crit                INTEGER,
  supplier            TEXT NOT NULL CHECK (json_valid(supplier)),
  buyer               TEXT NOT NULL CHECK (json_valid(buyer)),
  grand_total_amount  INTEGER NOT NULL,
  charge_total_amount INTEGER NOT NULL,
  tax_total_amount    INTEGER NOT NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT,
  UNIQUE (company_id, id)
) STRICT;
CREATE INDEX sales_transactions_period ON sales_transactions (company_id, write_date);

CREATE TABLE sales_transaction_items (
  id              TEXT PRIMARY KEY,
  transaction_id  TEXT NOT NULL REFERENCES sales_transactions(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  month           TEXT NOT NULL,
  day             TEXT NOT NULL,
  name            TEXT NOT NULL,
  specification   TEXT,
  quantity        TEXT,
  unit_price      INTEGER,
  supply_amount   INTEGER NOT NULL,
  tax_amount      INTEGER NOT NULL,
  description     TEXT
) STRICT;

CREATE TABLE issued_invoices (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL REFERENCES companies(id),
  transaction_id    TEXT NOT NULL REFERENCES sales_transactions(id),
  issue_type        TEXT NOT NULL DEFAULT 'normal' CHECK (issue_type IN ('normal','modify')),
  status            TEXT NOT NULL CHECK (status IN ('issuing','issued','failed')),
  issue_no          TEXT,
  issue_datetime    TEXT,
  snapshot          TEXT NOT NULL CHECK (json_valid(snapshot)),
  is_detail_synced  INTEGER NOT NULL DEFAULT 0 CHECK (is_detail_synced IN (0,1)),
  error_code        TEXT,
  error_message     TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
) STRICT;
CREATE INDEX issued_invoices_transaction ON issued_invoices (transaction_id, created_at);
CREATE UNIQUE INDEX issued_invoices_issue_no ON issued_invoices (company_id, issue_no) WHERE issue_no IS NOT NULL;

CREATE TABLE giros (
  id                 TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL REFERENCES companies(id),
  e_pay_no           TEXT NOT NULL,
  giro_type          TEXT NOT NULL CHECK (giro_type IN ('국세','지방세')),
  slip_type          TEXT NOT NULL,
  tax_name           TEXT NOT NULL,
  bill_org_name      TEXT,
  pay_amount         INTEGER NOT NULL,
  due_date           TEXT,
  detail             TEXT NOT NULL CHECK (json_valid(detail)),
  status             TEXT NOT NULL CHECK (status IN ('todo','unknown','done','hidden')),
  done_reason        TEXT CHECK (done_reason IN ('paid_in_app','manual','scraped')),
  memo               TEXT NOT NULL DEFAULT '',
  status_updated_at  TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  modified_at        TEXT NOT NULL,
  UNIQUE (company_id, e_pay_no),
  UNIQUE (company_id, id),
  CHECK ((status = 'done') = (done_reason IS NOT NULL))
) STRICT;

CREATE TABLE giro_actions (
  id                 TEXT PRIMARY KEY,
  giro_id            TEXT NOT NULL REFERENCES giros(id),
  status             TEXT NOT NULL,
  memo               TEXT NOT NULL DEFAULT '',
  username           TEXT NOT NULL,
  approver_username  TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL
) STRICT;
CREATE INDEX giro_actions_giro ON giro_actions (giro_id, created_at);

CREATE TABLE giro_payments (
  id                   TEXT PRIMARY KEY,
  giro_id              TEXT NOT NULL REFERENCES giros(id),
  request_id           TEXT NOT NULL,
  bank_code            TEXT NOT NULL,
  account_number_enc   TEXT NOT NULL,
  account_number_tail  TEXT NOT NULL,
  amount               INTEGER NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('requested','succeeded','failed')),
  result_code          TEXT,
  result_message       TEXT,
  requested_by         TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  UNIQUE (giro_id, request_id)
) STRICT;

CREATE TABLE notification_subscriptions (
  company_id  TEXT NOT NULL REFERENCES companies(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL CHECK (kind IN ('tax_payment_due','giro_certificate_expiring','giro_lookup_failed')),
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (company_id, user_id, kind)
) STRICT;

CREATE TABLE notification_deliveries (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  sent_on     TEXT NOT NULL,
  payload     TEXT CHECK (payload IS NULL OR json_valid(payload)),
  created_at  TEXT NOT NULL,
  UNIQUE (company_id, user_id, kind, target_id, sent_on)
) STRICT;

CREATE TABLE company_share_histories (
  id                       TEXT PRIMARY KEY,
  company_id               TEXT NOT NULL REFERENCES companies(id),
  receivers                TEXT NOT NULL CHECK (json_valid(receivers)),
  detail                   TEXT NOT NULL CHECK (json_valid(detail)),
  representative_image_id  TEXT,
  bankbook_image_id        TEXT,
  sent_by                  TEXT NOT NULL REFERENCES users(id),
  created_at               TEXT NOT NULL
) STRICT;

CREATE TABLE company_business_types (
  company_id      TEXT NOT NULL REFERENCES companies(id),
  seq             INTEGER NOT NULL,
  code            TEXT NOT NULL,
  business_type   TEXT NOT NULL,
  business_class  TEXT NOT NULL,
  is_main         INTEGER NOT NULL DEFAULT 0 CHECK (is_main IN (0,1)),
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (company_id, seq)
) STRICT;

CREATE TABLE settlement_closings (
  company_id      TEXT NOT NULL REFERENCES companies(id),
  fiscal_year     INTEGER NOT NULL,
  scope           TEXT NOT NULL CHECK (scope IN ('pl','bs','cash','ar_ap')),
  closed_through  TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT NOT NULL,
  PRIMARY KEY (company_id, fiscal_year, scope)
) STRICT;

CREATE TABLE settlement_pl_lines (
  company_id  TEXT NOT NULL REFERENCES companies(id),
  year        INTEGER NOT NULL,
  month       INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  section     TEXT NOT NULL CHECK (section IN ('매출액','매출원가','매출총이익','판매비와관리비','영업이익','영업외수익','영업외비용','법인세등','당기순이익')),
  path        TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  PRIMARY KEY (company_id, year, month, section, path)
) STRICT;

CREATE TABLE settlement_bs_lines (
  company_id      TEXT NOT NULL REFERENCES companies(id),
  target_month    TEXT NOT NULL,
  subject         TEXT NOT NULL,
  parent_subject  TEXT,
  sort_order      INTEGER NOT NULL,
  amount          INTEGER NOT NULL,
  PRIMARY KEY (company_id, target_month, subject)
) STRICT;

CREATE TABLE settlement_cash_ledger (
  company_id       TEXT NOT NULL REFERENCES companies(id),
  year             INTEGER NOT NULL,
  month            INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  cash_account     TEXT NOT NULL CHECK (cash_account IN ('현금','당좌예금','보통예금','제예금')),
  inflow           INTEGER NOT NULL,
  outflow          INTEGER NOT NULL,
  closing_balance  INTEGER NOT NULL,
  PRIMARY KEY (company_id, year, month, cash_account)
) STRICT;

CREATE TABLE settlement_cash_entries (
  company_id    TEXT NOT NULL REFERENCES companies(id),
  year          INTEGER NOT NULL,
  seq           INTEGER NOT NULL,
  date          TEXT NOT NULL,
  cash_account  TEXT NOT NULL,
  summary       TEXT,
  inflow        INTEGER NOT NULL,
  outflow       INTEGER NOT NULL,
  balance       INTEGER NOT NULL,
  PRIMARY KEY (company_id, year, seq)
) STRICT;

CREATE TABLE settlement_partner_balances (
  company_id        TEXT NOT NULL REFERENCES companies(id),
  kind              TEXT NOT NULL CHECK (kind IN ('receivable','payable')),
  year              INTEGER NOT NULL,
  month             INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  erp_partner_code  TEXT NOT NULL,
  partner_name      TEXT NOT NULL,
  summary           TEXT,
  entry_count       INTEGER NOT NULL,
  rollover_balance  INTEGER NOT NULL,
  increase_amount   INTEGER NOT NULL,
  decrease_amount   INTEGER NOT NULL,
  balance           INTEGER NOT NULL,
  PRIMARY KEY (company_id, kind, year, month, erp_partner_code)
) STRICT;

CREATE TABLE settlement_partner_entries (
  company_id          TEXT NOT NULL REFERENCES companies(id),
  kind                TEXT NOT NULL CHECK (kind IN ('receivable','payable')),
  year                INTEGER NOT NULL,
  erp_partner_code    TEXT NOT NULL,
  seq                 INTEGER NOT NULL,
  date                TEXT NOT NULL,
  summary             TEXT,
  transaction_amount  INTEGER NOT NULL,
  balance             INTEGER NOT NULL,
  PRIMARY KEY (company_id, kind, year, erp_partner_code, seq)
) STRICT;

INSERT INTO account_titles (id, company_id, parent_id, depth, code, name, description, applies_to, pl_category, cash_category, sort_order, created_at) VALUES
  ('at-g-sales', NULL, NULL, 1, 'sales', '매출', '재화와 용역을 판매해 얻은 수익', '["sales","deposit","withdrawal"]', 'revenue', NULL, 10, '2026-01-01T00:00:00+09:00'),
  ('at-sales', NULL, 'at-g-sales', 2, 'sales.revenue', '매출', '상품·제품·용역 매출', '["sales","deposit"]', 'revenue', '매출 대금', 11, '2026-01-01T00:00:00+09:00'),
  ('at-sales-cancel', NULL, 'at-g-sales', 2, 'sales.cancel', '매출 취소', '반품·환불 등으로 취소된 매출', '["sales","withdrawal"]', 'revenue', '매출 취소', 12, '2026-01-01T00:00:00+09:00'),
  ('at-g-noi', NULL, NULL, 1, 'non_op_income', '영업외수익', '주된 영업 활동 밖에서 생긴 수익', '["sales","deposit","withdrawal"]', 'non_op_income', NULL, 20, '2026-01-01T00:00:00+09:00'),
  ('at-noi-interest', NULL, 'at-g-noi', 2, 'non_op_income.interest', '이자수익', '예금·대여금 이자', '["deposit","withdrawal"]', 'non_op_income', '이자 수취', 21, '2026-01-01T00:00:00+09:00'),
  ('at-noi-subsidy', NULL, 'at-g-noi', 2, 'non_op_income.subsidy', '정부지원금 수취', '정부·지자체 지원금', '["sales","deposit","withdrawal"]', 'non_op_income', '정부지원금', 22, '2026-01-01T00:00:00+09:00'),
  ('at-noi-tax-refund', NULL, 'at-g-noi', 2, 'non_op_income.tax_refund', '세금환급', '국세·지방세 환급금', '["deposit"]', 'non_op_income', '세금환급', 23, '2026-01-01T00:00:00+09:00'),
  ('at-noi-dividend', NULL, 'at-g-noi', 2, 'non_op_income.dividend', '배당금수익', '보유 주식의 배당금', '["deposit"]', 'non_op_income', '기타 입금', 24, '2026-01-01T00:00:00+09:00'),
  ('at-noi-misc', NULL, 'at-g-noi', 2, 'non_op_income.misc', '잡이익', '그 밖의 소액 수익', '["sales","deposit"]', 'non_op_income', '기타 입금', 25, '2026-01-01T00:00:00+09:00'),
  ('at-noi-disposal', NULL, 'at-g-noi', 2, 'non_op_income.disposal', '자산처분이익', '유형·무형·금융·기타자산 처분이익', '["sales","deposit"]', 'non_op_income', '자산 처분', 26, '2026-01-01T00:00:00+09:00'),
  ('at-noi-other', NULL, 'at-g-noi', 2, 'non_op_income.other', '기타영업외수익', '그 밖의 영업외수익', '["sales","deposit"]', 'non_op_income', '기타 입금', 27, '2026-01-01T00:00:00+09:00'),
  ('at-g-cogs', NULL, NULL, 1, 'cogs', '매출원가', '판매한 상품·제품의 원가', '["purchase","withdrawal"]', 'cogs', NULL, 30, '2026-01-01T00:00:00+09:00'),
  ('at-cogs-goods', NULL, 'at-g-cogs', 2, 'cogs.goods', '상품매입', '판매용 상품 매입', '["purchase","withdrawal"]', 'cogs', '매입 대금', 31, '2026-01-01T00:00:00+09:00'),
  ('at-cogs-materials', NULL, 'at-g-cogs', 2, 'cogs.materials', '원재료매입', '제조용 원재료 매입', '["purchase","withdrawal"]', 'cogs', '원자재 구매', 32, '2026-01-01T00:00:00+09:00'),
  ('at-cogs-outsourcing', NULL, 'at-g-cogs', 2, 'cogs.outsourcing', '외주가공비', '외부에 맡긴 가공비', '["purchase","withdrawal"]', 'cogs', '매입 대금', 33, '2026-01-01T00:00:00+09:00'),
  ('at-g-sga', NULL, NULL, 1, 'sga', '판매비와관리비', '판매와 관리 활동에 쓴 비용', '["purchase","withdrawal"]', 'sga', NULL, 40, '2026-01-01T00:00:00+09:00'),
  ('at-sga-salary', NULL, 'at-g-sga', 2, 'sga.salary', '직원급여', '직원 급여', '["withdrawal"]', 'sga', '급여', 41, '2026-01-01T00:00:00+09:00'),
  ('at-sga-welfare', NULL, 'at-g-sga', 2, 'sga.welfare', '복리후생비', '식대·경조사비 등 직원 복리후생', '["purchase","withdrawal"]', 'sga', '운영비', 42, '2026-01-01T00:00:00+09:00'),
  ('at-sga-travel', NULL, 'at-g-sga', 2, 'sga.travel', '여비교통비', '출장비·교통비', '["purchase","withdrawal"]', 'sga', '운영비', 43, '2026-01-01T00:00:00+09:00'),
  ('at-sga-entertainment', NULL, 'at-g-sga', 2, 'sga.entertainment', '접대비', '거래처 접대', '["purchase","withdrawal"]', 'sga', '운영비', 44, '2026-01-01T00:00:00+09:00'),
  ('at-sga-communication', NULL, 'at-g-sga', 2, 'sga.communication', '통신비', '전화·인터넷 요금', '["purchase","withdrawal"]', 'sga', '운영비', 45, '2026-01-01T00:00:00+09:00'),
  ('at-sga-utilities', NULL, 'at-g-sga', 2, 'sga.utilities', '수도광열비', '전기·가스·수도 요금', '["purchase","withdrawal"]', 'sga', '운영비', 46, '2026-01-01T00:00:00+09:00'),
  ('at-sga-taxes', NULL, 'at-g-sga', 2, 'sga.taxes', '세금과공과', '재산세·자동차세·협회비 등', '["purchase","withdrawal"]', 'sga', '세금 납부', 47, '2026-01-01T00:00:00+09:00'),
  ('at-sga-rent', NULL, 'at-g-sga', 2, 'sga.rent', '지급임차료', '사무실·매장 임차료', '["purchase","withdrawal"]', 'sga', '임대료 지급', 48, '2026-01-01T00:00:00+09:00'),
  ('at-sga-insurance', NULL, 'at-g-sga', 2, 'sga.insurance', '보험료', '4대보험 회사 부담분·손해보험료', '["purchase","withdrawal"]', 'sga', '보험료', 49, '2026-01-01T00:00:00+09:00'),
  ('at-sga-vehicle', NULL, 'at-g-sga', 2, 'sga.vehicle', '차량유지비', '유류비·주차비·수리비', '["purchase","withdrawal"]', 'sga', '운영비', 50, '2026-01-01T00:00:00+09:00'),
  ('at-sga-supplies', NULL, 'at-g-sga', 2, 'sga.supplies', '소모품비', '사무용품·소모품', '["purchase","withdrawal"]', 'sga', '운영비', 51, '2026-01-01T00:00:00+09:00'),
  ('at-sga-fees', NULL, 'at-g-sga', 2, 'sga.fees', '지급수수료', '각종 수수료·용역비', '["purchase","withdrawal"]', 'sga', '운영비', 52, '2026-01-01T00:00:00+09:00'),
  ('at-sga-advertising', NULL, 'at-g-sga', 2, 'sga.advertising', '광고선전비', '광고·홍보비', '["purchase","withdrawal"]', 'sga', '운영비', 53, '2026-01-01T00:00:00+09:00'),
  ('at-sga-freight', NULL, 'at-g-sga', 2, 'sga.freight', '운반비', '택배·화물 운송비', '["purchase","withdrawal"]', 'sga', '운영비', 54, '2026-01-01T00:00:00+09:00'),
  ('at-g-noe', NULL, NULL, 1, 'non_op_expense', '영업외비용', '주된 영업 활동 밖에서 생긴 비용', '["purchase","withdrawal"]', 'non_op_expense', NULL, 60, '2026-01-01T00:00:00+09:00'),
  ('at-noe-interest', NULL, 'at-g-noe', 2, 'non_op_expense.interest', '이자비용', '차입금 이자', '["withdrawal"]', 'non_op_expense', '이자 지급', 61, '2026-01-01T00:00:00+09:00'),
  ('at-noe-misc', NULL, 'at-g-noe', 2, 'non_op_expense.misc', '잡손실', '그 밖의 소액 손실', '["purchase","withdrawal"]', 'non_op_expense', '기타 출금', 62, '2026-01-01T00:00:00+09:00'),
  ('at-noe-donation', NULL, 'at-g-noe', 2, 'non_op_expense.donation', '기부금', '기부금', '["withdrawal"]', 'non_op_expense', '기타 출금', 63, '2026-01-01T00:00:00+09:00'),
  ('at-g-income-tax', NULL, NULL, 1, 'income_tax', '법인세등', '법인세·소득세와 지방소득세', '["withdrawal"]', 'income_tax', NULL, 70, '2026-01-01T00:00:00+09:00'),
  ('at-income-tax', NULL, 'at-g-income-tax', 2, 'income_tax.tax', '법인세등', '법인세(개인은 소득세)와 지방소득세 납부', '["withdrawal"]', 'income_tax', '세금 납부', 71, '2026-01-01T00:00:00+09:00'),
  ('at-g-trade', NULL, NULL, 1, 'trade', '거래대금', '거래처와의 매출·매입 거래에서 발생하는 자금 입출금', '["deposit","withdrawal"]', 'none', NULL, 80, '2026-01-01T00:00:00+09:00'),
  ('at-trade-sales-in', NULL, 'at-g-trade', 2, 'trade.sales_in', '매출대금 입금', '매출 거래처에서 받은 대금', '["deposit","withdrawal"]', 'none', '매출 대금', 81, '2026-01-01T00:00:00+09:00'),
  ('at-trade-sales-in-partner', NULL, 'at-trade-sales-in', 3, 'trade.sales_in.partner', '거래처대금 입금', '거래처가 보낸 매출 대금', '["deposit","withdrawal"]', 'none', '매출 대금', 82, '2026-01-01T00:00:00+09:00'),
  ('at-trade-sales-in-cash-receipt', NULL, 'at-trade-sales-in', 3, 'trade.sales_in.cash_receipt', '현금영수증 매출 대금 입금', '현금영수증 매출 대금', '["deposit","withdrawal"]', 'none', '매출 대금', 83, '2026-01-01T00:00:00+09:00'),
  ('at-trade-sales-in-card', NULL, 'at-trade-sales-in', 3, 'trade.sales_in.card', '카드 매출 대금 입금', '카드사 정산 대금', '["deposit","withdrawal"]', 'none', '카드사 정산', 84, '2026-01-01T00:00:00+09:00'),
  ('at-trade-sales-in-pg', NULL, 'at-trade-sales-in', 3, 'trade.sales_in.pg', 'PG 매출 대금 입금', 'PG사 정산 대금', '["deposit","withdrawal"]', 'none', 'PG 매출', 85, '2026-01-01T00:00:00+09:00'),
  ('at-trade-sales-in-other', NULL, 'at-trade-sales-in', 3, 'trade.sales_in.other', '기타 매출 대금 입금', '그 밖의 매출 대금', '["deposit","withdrawal"]', 'none', '매출 대금', 86, '2026-01-01T00:00:00+09:00'),
  ('at-trade-purchase-refund', NULL, 'at-g-trade', 2, 'trade.purchase_refund', '매입 취소 대금 입금', '매입 취소로 돌려받은 대금', '["deposit"]', 'none', '매입 취소', 87, '2026-01-01T00:00:00+09:00'),
  ('at-trade-purchase-out', NULL, 'at-g-trade', 2, 'trade.purchase_out', '매입대금 출금', '매입 거래처에 보낸 대금', '["withdrawal"]', 'none', '매입 대금', 88, '2026-01-01T00:00:00+09:00'),
  ('at-trade-expense-claim', NULL, 'at-g-trade', 2, 'trade.expense_claim', '개인경비정산', '직원이 먼저 쓴 경비의 정산', '["withdrawal"]', 'none', '경비 정산', 89, '2026-01-01T00:00:00+09:00'),
  ('at-g-balance', NULL, NULL, 1, 'balance', '자산·부채', '손익에 영향이 없는 자산·부채 변동', '["purchase","deposit","withdrawal"]', 'none', NULL, 90, '2026-01-01T00:00:00+09:00'),
  ('at-balance-equipment', NULL, 'at-g-balance', 2, 'balance.equipment', '설비 구매', '유형자산 취득', '["purchase","withdrawal"]', 'none', '설비 구매', 91, '2026-01-01T00:00:00+09:00'),
  ('at-balance-loan-in', NULL, 'at-g-balance', 2, 'balance.loan_in', '차입금 입금', '대출 실행', '["deposit"]', 'none', '차입금', 92, '2026-01-01T00:00:00+09:00'),
  ('at-balance-loan-out', NULL, 'at-g-balance', 2, 'balance.loan_out', '차입금 상환', '대출 원금 상환', '["withdrawal"]', 'none', '차입금 상환', 93, '2026-01-01T00:00:00+09:00'),
  ('at-balance-transfer', NULL, 'at-g-balance', 2, 'balance.transfer', '계좌 간 이체', '회사 계좌 사이의 이체', '["deposit","withdrawal"]', 'none', '계좌 간 이체', 94, '2026-01-01T00:00:00+09:00'),
  ('at-balance-vat', NULL, 'at-g-balance', 2, 'balance.vat', '부가세 납부', '부가가치세 납부·환급', '["deposit","withdrawal"]', 'none', '세금 납부', 95, '2026-01-01T00:00:00+09:00'),
  ('at-balance-card-payment', NULL, 'at-g-balance', 2, 'balance.card_payment', '카드대금 결제', '법인카드 대금 결제', '["withdrawal"]', 'none', '카드대금 결제', 96, '2026-01-01T00:00:00+09:00'),
  ('at-balance-owner', NULL, 'at-g-balance', 2, 'balance.owner', '대표자 입출금', '가수금·가지급금', '["deposit","withdrawal"]', 'none', '대표자 입출금', 97, '2026-01-01T00:00:00+09:00');

UPDATE purchase_evidence SET account_title_id = (
  SELECT t.id FROM account_titles t WHERE t.company_id IS NULL AND t.code = purchase_evidence.account_code
) WHERE account_code IS NOT NULL AND account_title_id IS NULL;
