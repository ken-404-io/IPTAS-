-- IPTAS database schema (matches the ERD in Laboratory Exercise 005)
-- USER = users, EMPLOYEE = employees, TIME_LOG = time_logs, PAY_PERIOD = pay_periods,
-- PAY_RULE = pay_rules, PAYROLL = payroll, PAYROLL_REPORT = payroll_reports, AUDIT_LOG = audit_log

CREATE TABLE IF NOT EXISTS users (
  user_id        SERIAL PRIMARY KEY,
  full_name      VARCHAR(100) NOT NULL,
  email          VARCHAR(100) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  role           VARCHAR(10)  NOT NULL CHECK (role IN ('owner','admin')),
  status         VARCHAR(10)  NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
  employee_id       SERIAL PRIMARY KEY,
  tracker_user_id   VARCHAR(50) UNIQUE,
  full_name         VARCHAR(100) NOT NULL,
  email             VARCHAR(100) NOT NULL,
  employment_type   VARCHAR(10)  NOT NULL CHECK (employment_type IN ('hourly','fixed')),
  pay_rate          NUMERIC(10,2) NOT NULL CHECK (pay_rate >= 0),
  currency          VARCHAR(3)   NOT NULL CHECK (currency IN ('CAD','USD')),
  overtime_eligible BOOLEAN NOT NULL DEFAULT TRUE,
  status            VARCHAR(10)  NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  date_hired        DATE NOT NULL DEFAULT CURRENT_DATE
);

-- tracker_entry_id starts with "clockify-", "manual-" or "demo-", which shows where the entry came from
CREATE TABLE IF NOT EXISTS time_logs (
  log_id            SERIAL PRIMARY KEY,
  employee_id       INT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  tracker_entry_id  VARCHAR(50) NOT NULL UNIQUE,
  work_date         DATE NOT NULL,
  start_time        TIMESTAMPTZ,
  end_time          TIMESTAMPTZ,
  hours_worked      NUMERIC(5,2) NOT NULL CHECK (hours_worked >= 0),
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_time_logs_emp_date ON time_logs(employee_id, work_date);

CREATE TABLE IF NOT EXISTS pay_periods (
  period_id   SERIAL PRIMARY KEY,
  start_date  DATE NOT NULL UNIQUE,
  end_date    DATE NOT NULL,
  pay_date    DATE NOT NULL,
  status      VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open','computed','approved'))
);

CREATE TABLE IF NOT EXISTS pay_rules (
  rule_id             SERIAL PRIMARY KEY,
  rule_name           VARCHAR(50) NOT NULL,
  overtime_threshold  NUMERIC(5,2) NOT NULL,   -- hours per day before overtime (default 6)
  overtime_multiplier NUMERIC(3,2) NOT NULL,
  cpp_rate            NUMERIC(5,4) NOT NULL,
  ei_rate             NUMERIC(5,4) NOT NULL,
  effective_date      DATE NOT NULL
);

-- fx_rate is the USD to CAD rate used for this payroll (1 for CAD)
CREATE TABLE IF NOT EXISTS payroll (
  payroll_id     SERIAL PRIMARY KEY,
  employee_id    INT NOT NULL REFERENCES employees(employee_id),
  period_id      INT NOT NULL REFERENCES pay_periods(period_id) ON DELETE CASCADE,
  rule_id        INT NOT NULL REFERENCES pay_rules(rule_id),
  computed_by    INT REFERENCES users(user_id),
  approved_by    INT REFERENCES users(user_id),
  regular_hours  NUMERIC(6,2) NOT NULL,
  overtime_hours NUMERIC(6,2) NOT NULL,
  gross_pay      NUMERIC(10,2) NOT NULL,
  cpp_deduction  NUMERIC(10,2) NOT NULL,
  ei_deduction   NUMERIC(10,2) NOT NULL,
  net_pay        NUMERIC(10,2) NOT NULL,
  currency       VARCHAR(3) NOT NULL CHECK (currency IN ('CAD','USD')),
  fx_rate        NUMERIC(8,4) NOT NULL,
  status         VARCHAR(10) NOT NULL DEFAULT 'computed' CHECK (status IN ('computed','approved')),
  UNIQUE (employee_id, period_id)
);

CREATE TABLE IF NOT EXISTS payroll_reports (
  report_id    SERIAL PRIMARY KEY,
  period_id    INT NOT NULL REFERENCES pay_periods(period_id) ON DELETE CASCADE,
  generated_by INT REFERENCES users(user_id),
  report_type  VARCHAR(50) NOT NULL,
  file_format  VARCHAR(10) NOT NULL CHECK (file_format IN ('PDF','Excel')),
  file_path    VARCHAR(255) NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  audit_id   SERIAL PRIMARY KEY,
  user_id    INT REFERENCES users(user_id),
  action     VARCHAR(50) NOT NULL,
  table_name VARCHAR(50),
  record_id  INT,
  old_value  TEXT,
  new_value  TEXT,
  logged_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upgrade a database created by an earlier version of IPTAS to the Lab Exercise 005 ERD (safe to run on every start)
ALTER TABLE users DROP COLUMN IF EXISTS failed_attempts;
ALTER TABLE users DROP COLUMN IF EXISTS locked_until;
ALTER TABLE users DROP COLUMN IF EXISTS google_sub;
ALTER TABLE employees DROP COLUMN IF EXISTS apply_deductions;
ALTER TABLE time_logs DROP COLUMN IF EXISTS project;
ALTER TABLE time_logs DROP COLUMN IF EXISTS source;
ALTER TABLE time_logs ALTER COLUMN tracker_entry_id TYPE VARCHAR(50);
ALTER TABLE pay_rules DROP COLUMN IF EXISTS fx_usd_to_cad;
ALTER TABLE pay_rules DROP COLUMN IF EXISTS created_at;
ALTER TABLE pay_rules ALTER COLUMN cpp_rate TYPE NUMERIC(5,4);
ALTER TABLE pay_rules ALTER COLUMN ei_rate TYPE NUMERIC(5,4);
ALTER TABLE payroll DROP COLUMN IF EXISTS net_pay_cad;
ALTER TABLE payroll DROP COLUMN IF EXISTS computed_at;
ALTER TABLE payroll DROP COLUMN IF EXISTS approved_at;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payroll_reports' AND column_name='file_name') THEN
    ALTER TABLE payroll_reports RENAME COLUMN file_name TO file_path;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payroll_currency_check') THEN
    ALTER TABLE payroll ADD CONSTRAINT payroll_currency_check CHECK (currency IN ('CAD','USD'));
  END IF;
END $$;
DROP TABLE IF EXISTS settings;
-- Hours come only from the time-tracker (DFD: D3 is written by 3.0 Retrieve & Sync), so old manual entries are removed
DELETE FROM time_logs WHERE tracker_entry_id LIKE 'manual-%';
-- Overtime is daily now: a threshold above 24 hours was a weekly value from an earlier version, so it becomes 6 hours a day
UPDATE pay_rules SET overtime_threshold = 6 WHERE overtime_threshold > 24;
-- PayPal payout of the net pay (sent to the employee's email after the payroll is approved)
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS paypal_batch_id VARCHAR(40);
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS paypal_item_id  VARCHAR(40);
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS payout_status   VARCHAR(20);
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS payout_error    TEXT;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS paid_at         TIMESTAMPTZ;
