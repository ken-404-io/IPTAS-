# IPTAS Database & Login Credentials

## Entity Relationship Diagram (ERD)

![IPTAS ERD](erd.png)

Image files: [`erd.png`](erd.png) (for Word/Google Docs) and [`erd.svg`](erd.svg) (sharp at any size).
Source: [`erd.mmd`](erd.mmd); the tables are defined in [`server/schema.sql`](../server/schema.sql).

```mermaid
erDiagram
  USERS |o--o{ PAYROLL : "computes (computed_by)"
  USERS |o--o{ PAYROLL : "approves (approved_by)"
  USERS |o--o{ PAYROLL_REPORTS : generates
  USERS |o--o{ AUDIT_LOG : performs
  EMPLOYEES ||--o{ TIME_LOGS : records
  EMPLOYEES ||--o{ PAYROLL : receives
  PAY_PERIODS ||--o{ PAYROLL : contains
  PAY_PERIODS ||--o{ PAYROLL_REPORTS : "summarized in"
  PAY_RULES ||--o{ PAYROLL : "applied to"

  USERS {
    int user_id PK
    varchar full_name
    varchar email UK
    varchar password_hash
    varchar google_sub UK "Google sign-in ID"
    varchar role "owner | admin"
    varchar status "active | inactive"
    int failed_attempts
    timestamptz locked_until
    timestamptz created_at
  }
  EMPLOYEES {
    int employee_id PK
    varchar tracker_user_id UK
    varchar full_name
    varchar email
    varchar employment_type "hourly | fixed"
    numeric pay_rate
    varchar currency "CAD | USD"
    boolean overtime_eligible
    boolean apply_deductions
    varchar status "active | inactive"
    date date_hired
  }
  TIME_LOGS {
    int log_id PK
    int employee_id FK
    varchar tracker_entry_id UK
    date work_date
    timestamptz start_time
    timestamptz end_time
    numeric hours_worked
    varchar project
    varchar source
    timestamptz synced_at
  }
  PAY_PERIODS {
    int period_id PK
    date start_date UK
    date end_date
    date pay_date
    varchar status "open | computed | approved"
  }
  PAY_RULES {
    int rule_id PK
    varchar rule_name
    numeric overtime_threshold
    numeric overtime_multiplier
    numeric cpp_rate
    numeric ei_rate
    numeric fx_usd_to_cad
    date effective_date
    timestamptz created_at
  }
  PAYROLL {
    int payroll_id PK
    int employee_id FK
    int period_id FK
    int rule_id FK
    int computed_by FK
    int approved_by FK
    numeric regular_hours
    numeric overtime_hours
    numeric gross_pay
    numeric cpp_deduction
    numeric ei_deduction
    numeric net_pay
    varchar currency
    numeric fx_rate
    numeric net_pay_cad
    varchar status "computed | approved"
    timestamptz computed_at
    timestamptz approved_at
  }
  PAYROLL_REPORTS {
    int report_id PK
    int period_id FK
    int generated_by FK
    varchar report_type
    varchar file_format "PDF | Excel"
    varchar file_name
    timestamptz generated_at
  }
  AUDIT_LOG {
    int audit_id PK
    int user_id FK
    varchar action
    varchar table_name
    int record_id
    text old_value
    text new_value
    timestamptz logged_at
  }
  SETTINGS {
    varchar key PK
    text value
  }
```

## Tables

| Table | Purpose |
|---|---|
| `users` | System accounts that log in (Owner, Payroll Admin), with password and optional Google sign-in (`google_sub`) |
| `employees` | Staff who get paid (hourly or fixed, CAD or USD) |
| `time_logs` | Hours worked. `source` is `clockify` (synced from the API), `manual` (added by a user) or `demo` (sample data) |
| `pay_periods` | Two-week pay periods (open, then computed, then approved) |
| `pay_rules` | Overtime, CPP/EI deduction rates and USD-to-CAD rate |
| `payroll` | One computed pay record per employee per pay period |
| `payroll_reports` | Log of PDF/Excel reports generated |
| `audit_log` | Who did what, and when |
| `settings` | App settings: company name, storefront URL, business time zone, Clockify key and workspace, demo mode, last sync |

## Relationships

| From | To | Type | Foreign key |
|---|---|---|---|
| employees | time_logs | 1 to many | `time_logs.employee_id` |
| employees | payroll | 1 to many | `payroll.employee_id` |
| pay_periods | payroll | 1 to many | `payroll.period_id` |
| pay_rules | payroll | 1 to many | `payroll.rule_id` |
| users | payroll (computes) | 0..1 to many | `payroll.computed_by` |
| users | payroll (approves) | 0..1 to many | `payroll.approved_by` |
| pay_periods | payroll_reports | 1 to many | `payroll_reports.period_id` |
| users | payroll_reports | 0..1 to many | `payroll_reports.generated_by` |
| users | audit_log | 0..1 to many | `audit_log.user_id` |

`payroll` has a unique rule on (`employee_id`, `period_id`), so an employee is paid once per period.

## User credentials (for the project submission)

These accounts are created automatically the first time the app starts on an empty database.

| Role | Email | Password | Can do |
|---|---|---|---|
| Owner | `owner@iptas.app` | `Owner@2026` | Everything, including approving payroll and settings |
| Payroll Administrator | `admin@iptas.app` | `Admin@2026` | Manage employees, sync time logs, compute payroll, reports |

Do not put the database connection string (`DATABASE_URL`) in the submission or in this repository. It stays in `.env` and in Render's environment variables.
