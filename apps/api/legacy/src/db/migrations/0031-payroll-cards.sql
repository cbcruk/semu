CREATE TABLE payroll_cards (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id            TEXT NOT NULL REFERENCES companies(id),
  generation            TEXT NOT NULL CHECK (generation IN ('bpo','legacy')),
  kind                  TEXT NOT NULL DEFAULT 'default' CHECK (kind IN ('default','addition')),
  parent_card_id        INTEGER REFERENCES payroll_cards(id) ON DELETE SET NULL,
  title                 TEXT NOT NULL,
  attribution_month     TEXT NOT NULL CHECK (attribution_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  payment_date          TEXT NOT NULL,
  period_start          TEXT NOT NULL,
  period_end            TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'inputting'
                        CHECK (status IN ('inputting','calculated','approval_requested','approved','payslips_sent','exported')),
  approval_requested_at TEXT,
  approval_requested_by TEXT,
  approved_at           TEXT,
  approved_by           TEXT,
  rejected_at           TEXT,
  rejected_by           TEXT,
  payslips_sent_at      TEXT,
  exported_at           TEXT,
  export_type           TEXT,
  export_reference      TEXT,
  version               INTEGER NOT NULL DEFAULT 1,
  created_by            TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
) STRICT;

CREATE INDEX payroll_cards_company_month ON payroll_cards (company_id, generation, attribution_month);
CREATE INDEX payroll_cards_payment_date ON payroll_cards (company_id, payment_date);

CREATE TABLE payroll_rows (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id               TEXT NOT NULL REFERENCES companies(id),
  card_id                  INTEGER NOT NULL REFERENCES payroll_cards(id) ON DELETE CASCADE,
  income_type              TEXT NOT NULL CHECK (income_type IN ('wage_monthly','wage_daily','wage_hourly','daily','business','other')),
  employee_id              INTEGER,
  name                     TEXT NOT NULL,
  registration_number_enc  TEXT,
  is_foreigner             INTEGER NOT NULL DEFAULT 0 CHECK (is_foreigner IN (0,1)),
  residence_country        TEXT NOT NULL DEFAULT 'KR',
  payment_date             TEXT,
  birth_date               TEXT,
  department_name          TEXT,
  email                    TEXT,
  employment_status_label  TEXT,
  input                    TEXT NOT NULL CHECK (json_valid(input)),
  snapshot                 TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(snapshot)),
  overrides                TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(overrides)),
  result                   TEXT CHECK (result IS NULL OR json_valid(result)),
  gross_pay                INTEGER NOT NULL DEFAULT 0,
  taxable_pay              INTEGER NOT NULL DEFAULT 0,
  non_taxable_pay          INTEGER NOT NULL DEFAULT 0,
  income_tax               INTEGER NOT NULL DEFAULT 0,
  local_income_tax         INTEGER NOT NULL DEFAULT 0,
  employee_insurance_total INTEGER NOT NULL DEFAULT 0,
  employer_insurance_total INTEGER NOT NULL DEFAULT 0,
  deduction_total          INTEGER NOT NULL DEFAULT 0,
  net_pay                  INTEGER NOT NULL DEFAULT 0,
  calculated_at            TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
) STRICT;

CREATE INDEX payroll_rows_card ON payroll_rows (card_id, income_type);
CREATE INDEX payroll_rows_employee ON payroll_rows (company_id, employee_id);

CREATE TABLE payroll_card_items (
  card_id     INTEGER NOT NULL REFERENCES payroll_cards(id) ON DELETE CASCADE,
  item_kind   TEXT NOT NULL CHECK (item_kind IN ('payment','deduction')),
  item_id     INTEGER NOT NULL,
  is_enabled  INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0,1)),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (card_id, item_kind, item_id)
) STRICT;

CREATE TABLE payroll_payslips (
  row_id              INTEGER PRIMARY KEY REFERENCES payroll_rows(id) ON DELETE CASCADE,
  card_id             INTEGER NOT NULL REFERENCES payroll_cards(id) ON DELETE CASCADE,
  email               TEXT,
  payment_formulas    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payment_formulas)),
  notification_status TEXT CHECK (notification_status IS NULL OR notification_status IN ('in_flight','success','fail')),
  sent_at             TEXT,
  fail_reason         TEXT,
  updated_at          TEXT NOT NULL
) STRICT;

CREATE TABLE payroll_payslip_notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  row_id       INTEGER NOT NULL REFERENCES payroll_rows(id) ON DELETE CASCADE,
  card_id      INTEGER NOT NULL REFERENCES payroll_cards(id) ON DELETE CASCADE,
  recipient    TEXT,
  status       TEXT NOT NULL CHECK (status IN ('in_flight','success','fail')),
  message_id   TEXT,
  error        TEXT,
  requested_by TEXT,
  created_at   TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE TABLE payroll_manager_memos (
  company_id TEXT PRIMARY KEY REFERENCES companies(id),
  content    TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE payroll_legacy_preferences (
  company_id       TEXT PRIMARY KEY REFERENCES companies(id),
  maintain_payroll INTEGER NOT NULL DEFAULT 0 CHECK (maintain_payroll IN (0,1)),
  updated_by       TEXT,
  updated_at       TEXT NOT NULL
) STRICT;

CREATE TABLE payroll_external_integrations (
  company_id          TEXT NOT NULL REFERENCES companies(id),
  provider            TEXT NOT NULL CHECK (provider IN ('shiftee')),
  status              TEXT NOT NULL CHECK (status IN ('linked','unlinked')),
  external_company_id TEXT NOT NULL,
  company_name        TEXT NOT NULL,
  representative_name TEXT NOT NULL,
  admin_email         TEXT NOT NULL,
  linked_by           TEXT,
  linked_at           TEXT NOT NULL,
  unlinked_at         TEXT,
  PRIMARY KEY (company_id, provider)
) STRICT;

CREATE TABLE severance_settlements (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id              TEXT NOT NULL REFERENCES companies(id),
  employee_id             INTEGER NOT NULL,
  employee_name           TEXT NOT NULL,
  kind                    TEXT NOT NULL CHECK (kind IN ('retirement','interim')),
  status                  TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','excluded')),
  interim_reason          TEXT CHECK (interim_reason IS NULL OR interim_reason IN (
                            'home_purchase','rent_deposit','medical_treatment','bankruptcy','personal_rehabilitation',
                            'wage_peak','work_hours_reduction','legal_work_hours_reduction','etc_gov_notice')),
  join_date               TEXT NOT NULL,
  service_start_date      TEXT NOT NULL,
  base_date               TEXT NOT NULL,
  retirement_benefit_type TEXT NOT NULL CHECK (retirement_benefit_type IN ('grant','pension_db','pension_dc')),
  payment_date            TEXT,
  input                   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input)),
  result                  TEXT CHECK (result IS NULL OR json_valid(result)),
  service_days            INTEGER NOT NULL DEFAULT 0,
  average_daily_wage      INTEGER NOT NULL DEFAULT 0,
  severance_pay           INTEGER NOT NULL DEFAULT 0,
  retirement_income_tax   INTEGER NOT NULL DEFAULT 0,
  local_income_tax        INTEGER NOT NULL DEFAULT 0,
  net_pay                 INTEGER NOT NULL DEFAULT 0,
  exclude_reason          TEXT,
  completed_at            TEXT,
  version                 INTEGER NOT NULL DEFAULT 1,
  created_by              TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
) STRICT;

CREATE INDEX severance_settlements_company ON severance_settlements (company_id, kind, status);

CREATE TABLE severance_monthly_wages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  settlement_id INTEGER NOT NULL REFERENCES severance_settlements(id) ON DELETE CASCADE,
  month         TEXT NOT NULL,
  period_start  TEXT NOT NULL,
  period_end    TEXT NOT NULL,
  days          INTEGER NOT NULL,
  base_pay      INTEGER NOT NULL,
  allowances    INTEGER NOT NULL,
  total         INTEGER NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('payroll','contract','manual'))
) STRICT;
