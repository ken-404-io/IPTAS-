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

## Connecting Clockify
Log in as the Owner → **Settings** → paste the Clockify API key (Clockify → Profile settings → API).
Employees are matched to Clockify users by tracker user ID or by email address.
