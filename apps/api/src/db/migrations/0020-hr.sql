CREATE TABLE hr_secrets (
  name        TEXT PRIMARY KEY,
  value_enc   TEXT NOT NULL,
  created_at  TEXT NOT NULL
) STRICT;

CREATE TABLE departments (
  id          INTEGER PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_used     INTEGER NOT NULL DEFAULT 0 CHECK (is_used IN (0,1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (company_id, id),
  UNIQUE (company_id, name)
) STRICT;

CREATE TABLE positions (
  id          INTEGER PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_used     INTEGER NOT NULL DEFAULT 0 CHECK (is_used IN (0,1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (company_id, id),
  UNIQUE (company_id, name)
) STRICT;

CREATE TABLE employees (
  id                          INTEGER PRIMARY KEY,
  company_id                  TEXT NOT NULL REFERENCES companies(id),
  kind                        TEXT NOT NULL CHECK (kind IN ('wage-salary','daily','business','other')),
  name                        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  english_name                TEXT,
  registration_number_enc     TEXT,
  registration_number_hash    TEXT,
  identification_number_type  TEXT NOT NULL DEFAULT 'registration' CHECK (identification_number_type IN ('registration','passport')),
  birth_date                  TEXT,
  email                       TEXT,
  phone                       TEXT,
  is_local                    INTEGER NOT NULL DEFAULT 1 CHECK (is_local IN (0,1)),
  nationality                 TEXT,
  visa                        TEXT,
  is_residence                INTEGER NOT NULL DEFAULT 1 CHECK (is_residence IN (0,1)),
  country_of_residence        TEXT NOT NULL DEFAULT '대한민국',
  employee_number             TEXT,
  department_id               INTEGER,
  position_id                 INTEGER,
  join_date                   TEXT,
  work_code                   TEXT,
  is_rejoin                   INTEGER NOT NULL DEFAULT 0 CHECK (is_rejoin IN (0,1)),
  source                      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','e_sign','erp_import')),
  version                     INTEGER NOT NULL DEFAULT 0,
  created_by                  TEXT,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, department_id) REFERENCES departments(company_id, id),
  FOREIGN KEY (company_id, position_id) REFERENCES positions(company_id, id),
  CHECK ((registration_number_enc IS NULL) = (registration_number_hash IS NULL)),
  CHECK (kind <> 'wage-salary' OR join_date IS NOT NULL)
) STRICT;
CREATE INDEX employees_company_kind ON employees (company_id, kind, name);
CREATE INDEX employees_registration_hash ON employees (company_id, registration_number_hash) WHERE registration_number_hash IS NOT NULL;

CREATE TABLE employee_non_wage_details (
  company_id          TEXT NOT NULL,
  employee_id         INTEGER NOT NULL,
  leave_date          TEXT,
  daily_wage          INTEGER CHECK (daily_wage IS NULL OR daily_wage >= 0),
  business_code       TEXT,
  other_income_code   TEXT,
  bank_code           TEXT,
  account_number_enc  TEXT,
  account_holder      TEXT,
  updated_at          TEXT NOT NULL,
  PRIMARY KEY (company_id, employee_id),
  FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE employee_memos (
  company_id   TEXT NOT NULL,
  employee_id  INTEGER NOT NULL,
  content      TEXT NOT NULL,
  updated_by   TEXT,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (company_id, employee_id),
  FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE employee_memo_histories (
  id           INTEGER PRIMARY KEY,
  company_id   TEXT NOT NULL,
  employee_id  INTEGER NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('updated','deleted')),
  content      TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE
) STRICT;
CREATE INDEX employee_memo_histories_employee ON employee_memo_histories (employee_id, id DESC);

CREATE TABLE employee_family_members (
  id                             INTEGER PRIMARY KEY,
  company_id                     TEXT NOT NULL,
  employee_id                    INTEGER NOT NULL,
  name                           TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  birth_date                     TEXT NOT NULL,
  relation                       TEXT NOT NULL,
  is_local                       INTEGER NOT NULL DEFAULT 1 CHECK (is_local IN (0,1)),
  registration_number_enc        TEXT,
  is_tax_free_target             INTEGER NOT NULL DEFAULT 0 CHECK (is_tax_free_target IN (0,1)),
  is_year_end_target             INTEGER NOT NULL DEFAULT 0 CHECK (is_year_end_target IN (0,1)),
  year_end_dependant_type        TEXT NOT NULL DEFAULT '대상자아님',
  is_health_insurance_dependent  INTEGER NOT NULL DEFAULT 0 CHECK (is_health_insurance_dependent IN (0,1)),
  created_at                     TEXT NOT NULL,
  updated_at                     TEXT NOT NULL,
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE
) STRICT;
CREATE INDEX employee_family_members_employee ON employee_family_members (company_id, employee_id);

CREATE TABLE employee_family_attachments (
  id                INTEGER PRIMARY KEY,
  company_id        TEXT NOT NULL,
  family_member_id  INTEGER NOT NULL,
  file_id           TEXT NOT NULL,
  created_by        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  FOREIGN KEY (company_id, family_member_id) REFERENCES employee_family_members(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, file_id) REFERENCES files(company_id, id)
) STRICT;

CREATE TABLE employee_leaves (
  id                        INTEGER PRIMARY KEY,
  company_id                TEXT NOT NULL,
  employee_id               INTEGER NOT NULL,
  reason                    TEXT NOT NULL CHECK (reason IN ('maternity','parental','illness','etc')),
  start_date                TEXT NOT NULL,
  end_date                  TEXT NOT NULL,
  expected_return_date      TEXT,
  actual_return_date        TEXT,
  is_paid                   INTEGER NOT NULL DEFAULT 0 CHECK (is_paid IN (0,1)),
  paid_allowance            INTEGER CHECK (paid_allowance IS NULL OR paid_allowance >= 0),
  include_in_service_years  INTEGER NOT NULL DEFAULT 0 CHECK (include_in_service_years IN (0,1)),
  nps_payment_exception     INTEGER NOT NULL DEFAULT 0 CHECK (nps_payment_exception IN (0,1)),
  nhis_notice_deferral      INTEGER NOT NULL DEFAULT 0 CHECK (nhis_notice_deferral IN (0,1)),
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE,
  CHECK (start_date <= end_date),
  CHECK (actual_return_date IS NULL OR actual_return_date > start_date),
  CHECK (reason <> 'parental' OR include_in_service_years = 1),
  CHECK (is_paid = 1 OR paid_allowance IS NULL)
) STRICT;
CREATE INDEX employee_leaves_employee ON employee_leaves (company_id, employee_id, start_date);

CREATE TABLE employee_retirement_infos (
  company_id                   TEXT NOT NULL,
  employee_id                  INTEGER NOT NULL,
  retirement_benefit_type      TEXT NOT NULL DEFAULT 'grant' CHECK (retirement_benefit_type IN ('grant','pension_db','pension_dc')),
  has_interim_settlement       INTEGER NOT NULL DEFAULT 0 CHECK (has_interim_settlement IN (0,1)),
  interim_settlement_date      TEXT,
  interim_settlement_reason    TEXT,
  leave_date                   TEXT,
  leaving_reason               TEXT,
  leaving_detail_reason        TEXT,
  severance_amount             INTEGER CHECK (severance_amount IS NULL OR severance_amount >= 0),
  severance_settlement_status  TEXT CHECK (severance_settlement_status IN ('in_progress','completed','excluded')),
  updated_at                   TEXT NOT NULL,
  PRIMARY KEY (company_id, employee_id),
  FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE,
  CHECK (leave_date IS NULL OR interim_settlement_date IS NULL OR leave_date >= interim_settlement_date)
) STRICT;

CREATE TABLE employee_work_contracts (
  id                       INTEGER PRIMARY KEY,
  company_id               TEXT NOT NULL,
  employee_id              INTEGER NOT NULL,
  creation_method          TEXT NOT NULL DEFAULT 'manual' CHECK (creation_method IN ('manual','esign')),
  e_sign_request_id        INTEGER,
  contract_type            TEXT NOT NULL CHECK (contract_type IN ('regular','contract')),
  start_date               TEXT NOT NULL,
  end_date                 TEXT,
  work_type                TEXT NOT NULL DEFAULT 'regular' CHECK (work_type IN ('regular','part_time','short_time')),
  work_code                TEXT,
  work_condition_id        INTEGER,
  work_schedule_policy_id  INTEGER,
  weekly_work_hours        REAL CHECK (weekly_work_hours IS NULL OR weekly_work_hours BETWEEN 0 AND 168),
  has_probation            INTEGER NOT NULL DEFAULT 0 CHECK (has_probation IN (0,1)),
  probation_months         INTEGER CHECK (probation_months IS NULL OR probation_months BETWEEN 1 AND 12),
  probation_pay_rate       INTEGER CHECK (probation_pay_rate IS NULL OR probation_pay_rate BETWEEN 90 AND 100),
  job_description          TEXT,
  document_id              INTEGER,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE,
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (contract_type <> 'contract' OR end_date IS NOT NULL)
) STRICT;
CREATE INDEX employee_work_contracts_employee ON employee_work_contracts (company_id, employee_id, start_date);

CREATE TABLE employee_payroll_contracts (
  id                              INTEGER PRIMARY KEY,
  company_id                      TEXT NOT NULL,
  employee_id                     INTEGER NOT NULL,
  e_sign_request_id               INTEGER,
  start_date                      TEXT NOT NULL,
  end_date                        TEXT,
  wage_type                       TEXT NOT NULL CHECK (wage_type IN ('monthly','daily','hourly')),
  monthly_work_hours_source       TEXT NOT NULL DEFAULT 'manual' CHECK (monthly_work_hours_source IN ('policy','manual')),
  monthly_work_hours              REAL NOT NULL DEFAULT 209 CHECK (monthly_work_hours > 0),
  daily_work_hours                REAL CHECK (daily_work_hours IS NULL OR daily_work_hours > 0),
  amount                          INTEGER NOT NULL CHECK (amount >= 0),
  payment_items                   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(payment_items)),
  fixed_wage_auto_calc            INTEGER NOT NULL DEFAULT 0 CHECK (fixed_wage_auto_calc IN (0,1)),
  fixed_overtime_enabled          INTEGER NOT NULL DEFAULT 0 CHECK (fixed_overtime_enabled IN (0,1)),
  fixed_overtime_hours            REAL NOT NULL DEFAULT 0,
  fixed_overtime_amount           INTEGER NOT NULL DEFAULT 0,
  fixed_night_enabled             INTEGER NOT NULL DEFAULT 0 CHECK (fixed_night_enabled IN (0,1)),
  fixed_night_hours               REAL NOT NULL DEFAULT 0,
  fixed_night_amount              INTEGER NOT NULL DEFAULT 0,
  fixed_holiday_enabled           INTEGER NOT NULL DEFAULT 0 CHECK (fixed_holiday_enabled IN (0,1)),
  fixed_holiday_hours             REAL NOT NULL DEFAULT 0,
  fixed_holiday_amount            INTEGER NOT NULL DEFAULT 0,
  fixed_holiday_overtime_enabled  INTEGER NOT NULL DEFAULT 0 CHECK (fixed_holiday_overtime_enabled IN (0,1)),
  fixed_holiday_overtime_hours    REAL NOT NULL DEFAULT 0,
  fixed_holiday_overtime_amount   INTEGER NOT NULL DEFAULT 0,
  base_salary                     INTEGER NOT NULL,
  base_hourly_wage                REAL NOT NULL,
  probation_hourly_wage           REAL,
  ordinary_hourly_wage            REAL NOT NULL,
  annual_salary                   INTEGER,
  has_bonus                       INTEGER NOT NULL DEFAULT 0 CHECK (has_bonus IN (0,1)),
  bonus_amount                    INTEGER,
  bonus_in_ordinary_wage          INTEGER NOT NULL DEFAULT 0 CHECK (bonus_in_ordinary_wage IN (0,1)),
  pay_month                       TEXT NOT NULL DEFAULT 'current' CHECK (pay_month IN ('current','next')),
  pay_day                         INTEGER NOT NULL DEFAULT 25 CHECK (pay_day BETWEEN 1 AND 31),
  pay_method                      TEXT NOT NULL DEFAULT 'transfer' CHECK (pay_method IN ('transfer','direct')),
  bank_code                       TEXT,
  account_number_enc              TEXT,
  account_holder                  TEXT,
  created_at                      TEXT NOT NULL,
  updated_at                      TEXT NOT NULL,
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE,
  CHECK (end_date IS NULL OR end_date >= start_date)
) STRICT;
CREATE INDEX employee_payroll_contracts_employee ON employee_payroll_contracts (company_id, employee_id, start_date);

CREATE TABLE employee_social_insurance_infos (
  id                              INTEGER PRIMARY KEY,
  company_id                      TEXT NOT NULL,
  employee_id                     INTEGER NOT NULL,
  effective_from                  TEXT NOT NULL,
  is_representative_or_executive  INTEGER NOT NULL DEFAULT 0 CHECK (is_representative_or_executive IN (0,1)),
  is_representative_relative      INTEGER NOT NULL DEFAULT 0 CHECK (is_representative_relative IN (0,1)),
  is_person_of_merit              INTEGER NOT NULL DEFAULT 0 CHECK (is_person_of_merit IN (0,1)),
  is_non_regular                  INTEGER NOT NULL DEFAULT 0 CHECK (is_non_regular IN (0,1)),
  nps_enrolled                    INTEGER NOT NULL DEFAULT 1 CHECK (nps_enrolled IN (0,1)),
  nhis_enrolled                   INTEGER NOT NULL DEFAULT 1 CHECK (nhis_enrolled IN (0,1)),
  ei_enrolled                     INTEGER NOT NULL DEFAULT 1 CHECK (ei_enrolled IN (0,1)),
  iais_enrolled                   INTEGER NOT NULL DEFAULT 1 CHECK (iais_enrolled IN (0,1)),
  nps_exclusion_reason            TEXT,
  nhis_exclusion_reason           TEXT,
  ei_exclusion_reason             TEXT,
  iais_exclusion_reason           TEXT,
  nps_pay_acquisition_month       INTEGER NOT NULL DEFAULT 0 CHECK (nps_pay_acquisition_month IN (0,1)),
  durunuri_applied                INTEGER NOT NULL DEFAULT 0 CHECK (durunuri_applied IN (0,1)),
  updated_by                      TEXT,
  updated_at                      TEXT NOT NULL,
  UNIQUE (company_id, employee_id, effective_from),
  FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE employee_deduction_infos (
  id                                     INTEGER PRIMARY KEY,
  company_id                             TEXT NOT NULL,
  employee_id                            INTEGER NOT NULL,
  effective_from                         TEXT NOT NULL,
  income_tax_calc_method                 TEXT NOT NULL DEFAULT 'tax_table_based' CHECK (income_tax_calc_method IN ('tax_table_based','manual_input')),
  manual_income_tax                      INTEGER CHECK (manual_income_tax IS NULL OR manual_income_tax >= 0),
  income_tax_rate                        INTEGER NOT NULL DEFAULT 100 CHECK (income_tax_rate IN (80,100,120)),
  income_tax_reduction_type              TEXT NOT NULL DEFAULT 'none' CHECK (income_tax_reduction_type IN ('none','small_biz','returning_korean_talent','foreign_technician')),
  income_tax_reduction_application_type  TEXT NOT NULL DEFAULT '' CHECK (income_tax_reduction_application_type IN ('','payroll','year_end_set')),
  income_tax_reduction_reason            TEXT,
  income_tax_reduction_start_date        TEXT,
  income_tax_reduction_end_date          TEXT,
  income_tax_reduction_rate              INTEGER CHECK (income_tax_reduction_rate IS NULL OR income_tax_reduction_rate BETWEEN 1 AND 100),
  income_tax_reduction_scope             TEXT CHECK (income_tax_reduction_scope IS NULL OR income_tax_reduction_scope IN ('all','partial')),
  student_loan_applied                   INTEGER NOT NULL DEFAULT 0 CHECK (student_loan_applied IN (0,1)),
  student_loan_monthly_amount            INTEGER CHECK (student_loan_monthly_amount IS NULL OR student_loan_monthly_amount >= 0),
  student_loan_start_date                TEXT,
  student_loan_end_date                  TEXT,
  updated_by                             TEXT,
  updated_at                             TEXT NOT NULL,
  UNIQUE (company_id, employee_id, effective_from),
  FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE,
  CHECK (income_tax_calc_method <> 'manual_input' OR manual_income_tax IS NOT NULL)
) STRICT;

CREATE TABLE employee_documents (
  id           INTEGER PRIMARY KEY,
  company_id   TEXT NOT NULL,
  employee_id  INTEGER NOT NULL,
  category     TEXT NOT NULL CHECK (category IN ('contract','certificate','consent','resignation','etc')),
  source_type  TEXT NOT NULL DEFAULT 'upload' CHECK (source_type IN ('upload','e_sign','certificate')),
  source_id    INTEGER,
  file_id      TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, file_id) REFERENCES files(company_id, id)
) STRICT;
CREATE INDEX employee_documents_employee ON employee_documents (company_id, employee_id, category);

CREATE TABLE employee_insurance_filings (
  id            INTEGER PRIMARY KEY,
  company_id    TEXT NOT NULL,
  employee_id   INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('join','leave','dependent','leave_of_absence','reinstatement')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed','withdrawn')),
  source_type   TEXT,
  source_id     INTEGER,
  payload       TEXT CHECK (payload IS NULL OR json_valid(payload)),
  result_msg    TEXT,
  requested_at  TEXT NOT NULL,
  processed_at  TEXT,
  FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE
) STRICT;
CREATE INDEX employee_insurance_filings_open ON employee_insurance_filings (company_id, employee_id, status);

CREATE TABLE esign_company_seals (
  id          INTEGER PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  file_id     TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','drawn')),
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT,
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, file_id) REFERENCES files(company_id, id)
) STRICT;

CREATE TABLE esign_noti_recipients (
  id           INTEGER PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id),
  sort_order   INTEGER NOT NULL,
  name         TEXT NOT NULL,
  position_id  INTEGER,
  phone        TEXT NOT NULL,
  email        TEXT,
  FOREIGN KEY (company_id, position_id) REFERENCES positions(company_id, id),
  UNIQUE (company_id, sort_order)
) STRICT;

CREATE TABLE esign_template_overrides (
  company_id       TEXT NOT NULL REFERENCES companies(id),
  template_id      INTEGER NOT NULL,
  title            TEXT,
  body             TEXT CHECK (body IS NULL OR json_valid(body)),
  field_defaults   TEXT CHECK (field_defaults IS NULL OR json_valid(field_defaults)),
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  default_seal_id  INTEGER,
  updated_by       TEXT,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (company_id, template_id),
  FOREIGN KEY (company_id, default_seal_id) REFERENCES esign_company_seals(company_id, id)
) STRICT;

CREATE TABLE esign_requests (
  id                       INTEGER PRIMARY KEY,
  company_id               TEXT NOT NULL REFERENCES companies(id),
  status                   TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','in_progress','completed','voided','expired','cancelled','send_failed')),
  version                  INTEGER NOT NULL DEFAULT 0,
  workplace_size           TEXT CHECK (workplace_size IS NULL OR workplace_size IN ('gte5','lt5')),
  wage_type                TEXT CHECK (wage_type IS NULL OR wage_type IN ('monthly','daily','hourly')),
  work_condition_id        INTEGER,
  work_schedule_policy_id  INTEGER,
  field_values             TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(field_values)),
  company_seal_id          INTEGER,
  company_seal_file_id     TEXT,
  due_date                 TEXT,
  token_hash               TEXT UNIQUE,
  verify_failures          INTEGER NOT NULL DEFAULT 0,
  send_error               TEXT,
  sent_at                  TEXT,
  verified_at              TEXT,
  signed_at                TEXT,
  expired_at               TEXT,
  cancelled_at             TEXT,
  voided_at                TEXT,
  result_file_id           TEXT,
  signer_input             TEXT CHECK (signer_input IS NULL OR json_valid(signer_input)),
  created_by               TEXT NOT NULL,
  updated_by               TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, company_seal_id) REFERENCES esign_company_seals(company_id, id),
  FOREIGN KEY (company_id, result_file_id) REFERENCES files(company_id, id),
  CHECK ((status = 'completed' OR status = 'voided') = (result_file_id IS NOT NULL)),
  CHECK (status = 'draft' OR status = 'send_failed' OR due_date IS NOT NULL)
) STRICT;
CREATE INDEX esign_requests_company_status ON esign_requests (company_id, status, updated_at);
CREATE INDEX esign_requests_due ON esign_requests (status, due_date) WHERE status IN ('pending','in_progress');

CREATE TABLE esign_request_documents (
  company_id     TEXT NOT NULL,
  request_id     INTEGER NOT NULL,
  doc_index      INTEGER NOT NULL,
  template_id    INTEGER NOT NULL,
  template_type  TEXT NOT NULL CHECK (template_type IN ('e_sign_template','company_e_sign_template')),
  title          TEXT NOT NULL,
  document_kind  TEXT NOT NULL,
  category       TEXT NOT NULL,
  PRIMARY KEY (request_id, doc_index),
  FOREIGN KEY (company_id, request_id) REFERENCES esign_requests(company_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE esign_recipients (
  company_id       TEXT NOT NULL,
  request_id       INTEGER NOT NULL PRIMARY KEY,
  employment_type  TEXT CHECK (employment_type IS NULL OR employment_type IN ('wageemployee','dailyemployee','businessemployee','otheremployee')),
  employee_id      INTEGER,
  name             TEXT NOT NULL,
  email            TEXT,
  phone            TEXT,
  is_local         INTEGER NOT NULL DEFAULT 1 CHECK (is_local IN (0,1)),
  nationality      TEXT,
  visa             TEXT,
  birth_date       TEXT,
  FOREIGN KEY (company_id, request_id) REFERENCES esign_requests(company_id, id) ON DELETE CASCADE,
  CHECK ((employee_id IS NULL) OR (employment_type IS NOT NULL))
) STRICT;
CREATE INDEX esign_recipients_employee ON esign_recipients (company_id, employee_id);

CREATE TABLE esign_signer_sessions (
  id            INTEGER PRIMARY KEY,
  company_id    TEXT NOT NULL,
  request_id    INTEGER NOT NULL,
  session_hash  TEXT NOT NULL UNIQUE,
  verified_at   TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  ip            TEXT,
  user_agent    TEXT,
  FOREIGN KEY (company_id, request_id) REFERENCES esign_requests(company_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE esign_signer_seals (
  id          INTEGER PRIMARY KEY,
  company_id  TEXT NOT NULL,
  request_id  INTEGER NOT NULL,
  file_id     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (company_id, request_id) REFERENCES esign_requests(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, file_id) REFERENCES files(company_id, id)
) STRICT;

CREATE TABLE esign_events (
  id          INTEGER PRIMARY KEY,
  company_id  TEXT NOT NULL,
  request_id  INTEGER NOT NULL,
  type        TEXT NOT NULL,
  actor_type  TEXT NOT NULL CHECK (actor_type IN ('user','signer','system')),
  actor_id    TEXT,
  ip          TEXT,
  user_agent  TEXT,
  payload     TEXT CHECK (payload IS NULL OR json_valid(payload)),
  created_at  TEXT NOT NULL,
  FOREIGN KEY (company_id, request_id) REFERENCES esign_requests(company_id, id) ON DELETE CASCADE
) STRICT;
CREATE INDEX esign_events_request ON esign_events (request_id, id);

CREATE TABLE certificate_issuances (
  id                    INTEGER PRIMARY KEY,
  company_id            TEXT NOT NULL REFERENCES companies(id),
  status                TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','sending','sent','send_failed')),
  version               INTEGER NOT NULL DEFAULT 0,
  template_id           INTEGER NOT NULL,
  title                 TEXT NOT NULL,
  employment_type       TEXT NOT NULL CHECK (employment_type IN ('wageemployee','dailyemployee','businessemployee','otheremployee')),
  employee_id           INTEGER NOT NULL,
  employee_name         TEXT NOT NULL,
  field_values          TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(field_values)),
  company_seal_id       INTEGER,
  issue_number          TEXT NOT NULL,
  issued_at             TEXT NOT NULL,
  file_id               TEXT NOT NULL,
  sent_to_email         TEXT,
  sent_to_phone         TEXT,
  sent_at               TEXT,
  send_error            TEXT,
  token_hash            TEXT UNIQUE,
  token_expires_at      TEXT,
  verify_failures       INTEGER NOT NULL DEFAULT 0,
  created_by            TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE (company_id, id),
  UNIQUE (company_id, issue_number),
  FOREIGN KEY (company_id, file_id) REFERENCES files(company_id, id),
  FOREIGN KEY (company_id, company_seal_id) REFERENCES esign_company_seals(company_id, id)
) STRICT;
CREATE INDEX certificate_issuances_company_status ON certificate_issuances (company_id, status, id);

CREATE TABLE certificate_sessions (
  id              INTEGER PRIMARY KEY,
  company_id      TEXT NOT NULL,
  certificate_id  INTEGER NOT NULL,
  session_hash    TEXT NOT NULL UNIQUE,
  verified_at     TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  ip              TEXT,
  user_agent      TEXT,
  FOREIGN KEY (company_id, certificate_id) REFERENCES certificate_issuances(company_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE hr_notifications (
  id           INTEGER PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id),
  channel      TEXT NOT NULL CHECK (channel IN ('email','alimtalk')),
  template     TEXT NOT NULL,
  recipient    TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('sent','failed')),
  error        TEXT,
  source_type  TEXT NOT NULL CHECK (source_type IN ('e_sign_request','certificate')),
  source_id    INTEGER NOT NULL,
  created_at   TEXT NOT NULL
) STRICT;
CREATE INDEX hr_notifications_source ON hr_notifications (source_type, source_id);
