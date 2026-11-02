# IPTAS – Integrated Automated Payroll & Time Tracking Management System

Web-based payroll system for a Canadian Shopify business with a remote team.
MIT421 – Systems Design and Implementation · Final Project · Harold A. Sarmiento

## Features (six modules)

| Module | What it does |
|---|---|
| 1. Time Tracker API Integration | Syncs employees' time logs from **Clockify** through its REST API (demo mode with sample logs when no API key is set) |
| 2. Employee Records | Add/edit employees, pay rate, hourly or fixed pay, CAD/USD, overtime and CPP/EI flags |
| 3. Salary Computation | Regular + overtime pay (weekly threshold × multiplier), CPP and EI at general rates, USD→CAD conversion; Owner approval locks the payroll |
| 4. Hours & Payroll Dashboard | Live hours, overtime and projected payroll cost; payroll history; Shopify storefront link |
| 5. Payroll Reports | Payroll Summary (PDF/Excel) and Employee Payslips (PDF) per pay period, with report history |
| 6. User Management & Security | Login with JWT and bcrypt-hashed passwords, roles (Business Owner / Administrator), lockout after 5 failed attempts, audit trail |

## Tech stack
React (Vite) · Node.js + Express · PostgreSQL · JWT + bcrypt · jsPDF + SheetJS · Jest-style tests with `node:test`

## Default accounts (created on first start)
| Role | Email | Password |
|---|---|---|
| Business Owner | owner@iptas.app | Owner@2026 |
| Administrator | admin@iptas.app | Admin@2026 |

## Run locally
```bash
cp .env.example .env          # set DATABASE_URL and JWT_SECRET
npm install
npm run build                 # builds the React front end
npm start                     # http://localhost:3000
npm test                      # salary computation unit tests
```
The database tables and starter data are created automatically on the first start.

## Deploy (Render + Neon)
1. Create a free PostgreSQL database on neon.tech and copy its connection string.
2. On render.com: **New → Web Service**, pick this repository.
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - Environment variables: `DATABASE_URL` (Neon string), `JWT_SECRET` (any long random text), optional `CLOCKIFY_API_KEY`.
3. Open the Render URL and log in with an account above.

## Connecting Clockify (real time logs)
1. In Clockify, a **workspace admin** opens Profile settings → API → Generate, and copies the key.
   (A non-admin key works too, but then only that person's own hours are synced.)
2. In IPTAS, log in as the Owner → **Settings** → paste the key → **Save key**. The key is checked before it is saved,
   and **Test connection** lists every Clockify user and the employee they are matched to.
3. Make sure each worker is an employee in IPTAS with the **same email** as in Clockify (or paste their Clockify user ID
   into "Time-tracker user ID"). Unmatched users are listed after each sync.
4. Set the **business time zone** in Settings. Hours are put on the work date in that time zone.
5. On **Time Logs**, pick the pay period and click **Sync time logs**.

How the sync behaves:
- Every page of results is fetched, so large teams and many short entries are all included.
- Entries deleted or moved in Clockify are removed on the next sync; running timers are skipped until they stop.
- Syncing again after payroll was computed clears that (unapproved) payroll so it must be recomputed with the new hours.
- Approved pay periods are locked and never change.
- **Add entry** on Time Logs records hours by hand (corrections, untracked work). Manual entries are kept on re-sync and are audit-logged.
- Workspaces on a regional Clockify server: set `CLOCKIFY_API_URL` (e.g. `https://euc1.clockify.me/api/v1`).

## Going live with real data
The first start loads sample employees, hours and payroll history for demonstration. Before running real payroll:
Owner → **Settings** → **Remove sample data**. This deletes only the sample employees and their hours and payroll,
and turns off demo mode (without a Clockify key, sync then asks you to connect Clockify instead of creating sample hours).
User accounts, pay rules and settings are kept. Change the default account passwords under **User Accounts**.
