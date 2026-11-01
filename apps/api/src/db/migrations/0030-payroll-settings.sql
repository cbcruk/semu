CREATE TABLE payroll_rate_tables (
  effective_from TEXT PRIMARY KEY CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  payload        TEXT NOT NULL CHECK (json_valid(payload)),
  created_at     TEXT NOT NULL
) STRICT;

CREATE TABLE payroll_terms (
  company_id                          TEXT PRIMARY KEY REFERENCES companies(id),
  wage_period_start_day               INTEGER NOT NULL DEFAULT 1 CHECK (wage_period_start_day BETWEEN 1 AND 31),
  payment_month                       TEXT NOT NULL DEFAULT 'current' CHECK (payment_month IN ('current','next','previous')),
  payment_day                         INTEGER NOT NULL DEFAULT 25 CHECK (payment_day BETWEEN 1 AND 31),
  payment_method                      TEXT NOT NULL DEFAULT 'bank_transfer' CHECK (payment_method IN ('bank_transfer','cash_payment')),
  attendance_record_integration       TEXT NOT NULL DEFAULT 'none' CHECK (attendance_record_integration IN ('none','manual_input')),
  is_under_five_employees             INTEGER NOT NULL DEFAULT 0 CHECK (is_under_five_employees IN (0,1)),
  fixed_overtime_multiplier_x100      INTEGER NOT NULL DEFAULT 150 CHECK (fixed_overtime_multiplier_x100 BETWEEN 0 AND 1000),
  fixed_night_multiplier_x100         INTEGER NOT NULL DEFAULT 50 CHECK (fixed_night_multiplier_x100 BETWEEN 0 AND 1000),
  fixed_holiday_multiplier_x100       INTEGER NOT NULL DEFAULT 150 CHECK (fixed_holiday_multiplier_x100 BETWEEN 0 AND 1000),
  fixed_holiday_overtime_multiplier_x100 INTEGER NOT NULL DEFAULT 200 CHECK (fixed_holiday_overtime_multiplier_x100 BETWEEN 0 AND 1000),
  retirement_benefit_type             TEXT NOT NULL DEFAULT 'grant' CHECK (retirement_benefit_type IN ('grant','pension_db','pension_dc')),
  updated_at                          TEXT NOT NULL
) STRICT;

CREATE TABLE payroll_deduction_settings (
  company_id                               TEXT PRIMARY KEY REFERENCES companies(id),
  national_pension_method                  TEXT NOT NULL DEFAULT 'notice' CHECK (national_pension_method IN ('notice','rate')),
  national_pension_pay_on_acquisition_month INTEGER NOT NULL DEFAULT 0 CHECK (national_pension_pay_on_acquisition_month IN (0,1)),
  health_insurance_method                  TEXT NOT NULL DEFAULT 'notice' CHECK (health_insurance_method IN ('notice','rate')),
  employment_insurance_method              TEXT NOT NULL DEFAULT 'rate' CHECK (employment_insurance_method IN ('notice','rate')),
  income_tax_method                        TEXT NOT NULL DEFAULT 'tax_table_based' CHECK (income_tax_method IN ('tax_table_based','manual_input','none')),
  updated_at                               TEXT NOT NULL
) STRICT;

CREATE TABLE payroll_payment_items (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id                 TEXT NOT NULL REFERENCES companies(id),
  name                       TEXT NOT NULL,
  source                     TEXT NOT NULL CHECK (source IN ('catalog','custom')),
  catalog_code               TEXT,
  default_amount             INTEGER CHECK (default_amount IS NULL OR default_amount >= 0),
  is_taxable                 INTEGER NOT NULL CHECK (is_taxable IN (0,1)),
  non_taxable_category       TEXT,
  non_taxable_limit_enabled  INTEGER NOT NULL DEFAULT 0 CHECK (non_taxable_limit_enabled IN (0,1)),
  non_taxable_limit_amount   INTEGER CHECK (non_taxable_limit_amount IS NULL OR non_taxable_limit_amount >= 0),
  include_in_monthly_salary  INTEGER NOT NULL CHECK (include_in_monthly_salary IN (0,1)),
  include_in_ordinary_wage   INTEGER NOT NULL CHECK (include_in_ordinary_wage IN (0,1)),
  include_in_average_wage    INTEGER NOT NULL CHECK (include_in_average_wage IN (0,1)),
  include_in_minimum_wage    INTEGER NOT NULL CHECK (include_in_minimum_wage IN (0,1)),
  show_formula_on_payslip    INTEGER NOT NULL DEFAULT 0 CHECK (show_formula_on_payslip IN (0,1)),
  formula_text               TEXT,
  is_system                  INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
  sort_order                 INTEGER NOT NULL DEFAULT 0,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL,
  UNIQUE (company_id, name),
  CHECK ((source = 'catalog') = (catalog_code IS NOT NULL)),
  CHECK (is_taxable = 1 OR non_taxable_category IS NOT NULL)
) STRICT;

CREATE TABLE payroll_deduction_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   TEXT NOT NULL REFERENCES companies(id),
  name         TEXT NOT NULL,
  amount_mode  TEXT NOT NULL CHECK (amount_mode IN ('fixed','on_settlement')),
  amount       INTEGER CHECK (amount IS NULL OR amount >= 0),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (company_id, name),
  CHECK ((amount_mode = 'fixed') = (amount IS NOT NULL))
) STRICT;

CREATE TABLE work_conditions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         TEXT NOT NULL REFERENCES companies(id),
  name               TEXT NOT NULL,
  work_place         TEXT NOT NULL DEFAULT '',
  probation_months   INTEGER NOT NULL DEFAULT 0 CHECK (probation_months BETWEEN 0 AND 12),
  probation_pay_rate INTEGER NOT NULL DEFAULT 100 CHECK (probation_pay_rate BETWEEN 1 AND 100),
  is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
) STRICT;

CREATE INDEX work_conditions_company ON work_conditions (company_id, id);

CREATE TABLE work_schedule_policies (
  id                               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id                       TEXT NOT NULL REFERENCES companies(id),
  name                             TEXT NOT NULL,
  paid_weekly_holidays             TEXT NOT NULL CHECK (json_valid(paid_weekly_holidays)),
  unpaid_holidays                  TEXT NOT NULL CHECK (json_valid(unpaid_holidays)),
  contractual_work_schedule_type   TEXT NOT NULL CHECK (contractual_work_schedule_type IN ('weekly','biweekly','monthly')),
  contractual_work_schedules       TEXT NOT NULL CHECK (json_valid(contractual_work_schedules)),
  weekly_rest_hours_input_method   TEXT NOT NULL CHECK (weekly_rest_hours_input_method IN ('auto_calculated','manual')),
  weekly_rest_hours_x100           INTEGER CHECK (weekly_rest_hours_x100 IS NULL OR weekly_rest_hours_x100 BETWEEN 0 AND 800),
  fixed_overtime_work_schedule_type TEXT NOT NULL CHECK (fixed_overtime_work_schedule_type IN ('none','daily','weekly','monthly')),
  fixed_overtime_input_type        TEXT NOT NULL CHECK (fixed_overtime_input_type IN ('none','actual','additional')),
  fixed_overtime_items             TEXT NOT NULL CHECK (json_valid(fixed_overtime_items)),
  is_active                        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at                       TEXT NOT NULL,
  updated_at                       TEXT NOT NULL
) STRICT;

CREATE INDEX work_schedule_policies_company ON work_schedule_policies (company_id, id);
