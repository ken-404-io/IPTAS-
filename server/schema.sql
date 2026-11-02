-- IPTAS database schema (matches the ERD in Laboratory Exercise 005)

CREATE TABLE IF NOT EXISTS users (
  user_id        SERIAL PRIMARY KEY,
  full_name      VARCHAR(100) NOT NULL,
  email          VARCHAR(100) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  role           VARCHAR(10)  NOT NULL CHECK (role IN ('owner','admin')),
  status         VARCHAR(10)  NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until   TIMESTAMPTZ,
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
  apply_deductions  BOOLEAN NOT NULL DEFAULT TRUE,
  status            VARCHAR(10)  NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  date_hired        DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS time_logs (
  log_id            SERIAL PRIMARY KEY,
  employee_id       INT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  tracker_entry_id  VARCHAR(80) NOT NULL UNIQUE,
  work_date         DATE NOT NULL,
  start_time        TIMESTAMPTZ,
  end_time          TIMESTAMPTZ,
  hours_worked      NUMERIC(5,2) NOT NULL CHECK (hours_worked >= 0),
  project           VARCHAR(100),
  source            VARCHAR(10) NOT NULL DEFAULT 'demo',
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
  overtime_threshold  NUMERIC(5,2) NOT NULL,   -- hours per week before overtime
  overtime_multiplier NUMERIC(3,2) NOT NULL,
  cpp_rate            NUMERIC(6,4) NOT NULL,
  ei_rate             NUMERIC(6,4) NOT NULL,
  fx_usd_to_cad       NUMERIC(8,4) NOT NULL,
  effective_date      DATE NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
  currency       VARCHAR(3) NOT NULL,
  fx_rate        NUMERIC(8,4) NOT NULL,
  net_pay_cad    NUMERIC(10,2) NOT NULL,
  status         VARCHAR(10) NOT NULL DEFAULT 'computed' CHECK (status IN ('computed','approved')),
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at    TIMESTAMPTZ,
  UNIQUE (employee_id, period_id)
);

CREATE TABLE IF NOT EXISTS payroll_reports (
  report_id    SERIAL PRIMARY KEY,
  period_id    INT NOT NULL REFERENCES pay_periods(period_id) ON DELETE CASCADE,
  generated_by INT REFERENCES users(user_id),
  report_type  VARCHAR(50) NOT NULL,
  file_format  VARCHAR(10) NOT NULL CHECK (file_format IN ('PDF','Excel')),
  file_name    VARCHAR(255) NOT NULL,
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

CREATE TABLE IF NOT EXISTS settings (
  key   VARCHAR(50) PRIMARY KEY,
  value TEXT
);

-- Google sign-in (added after the first release; safe to run on every start)
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(64) UNIQUE;
