# MoneyTracker server

Deploy the repository root as one Render Web Service. The server serves the frontend and `/api/*` from the same origin, so no API URL is required.

## Required
- Node 20+
- `JWT_SECRET` (Render can generate it)
- Persistent disk mounted at `server/data` or set `DB_PATH`

## Local
```bash
npm install
npm start
```
Open `http://localhost:3000`.

The SQLite DB is created automatically, WAL is enabled, and rotating backups are written to `server/data/backups`.

## Authentication
- POST `/api/register`
- POST `/api/login`
- GET/PUT `/api/me`
- GET/POST/PUT/DELETE `/api/household/*`
- GET/PUT `/api/state`

Only the authenticated account owner can access its household. No endpoint lists all accounts.
