# MoneyTracker optional backend

The frontend remains fully local/offline-first. This folder provides an optional real multi-device backend using SQLite.

## Run

1. `cd server`
2. `npm install`
3. Set `JWT_SECRET` to a long random value.
4. `npm start`

The server creates `moneytracker.db` next to `server.js`.

Endpoints:
- `POST /api/register` — create account
- `POST /api/login` — receive JWT
- `GET /api/state` — load the user's app state
- `PUT /api/state` — save the user's app state
- `GET /api/me`
- `GET /api/health`

For production, use HTTPS, a real secret, rate limiting, backups, and a managed database if the project grows. Do not expose the SQLite file publicly.
