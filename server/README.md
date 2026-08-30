# MoneyTracker API

## Local
```bash
npm install
JWT_SECRET='change-me' npm start
```

The API stores data in SQLite. Set `DB_PATH` to a persistent directory in production.

## Production / Render
`render.yaml` mounts a persistent disk at `/opt/render/project/src/server/data`, so the SQLite DB survives deploys/restarts. The server automatically creates the directory, enables WAL mode and checkpoints the WAL periodically.

## Security model
- Login returns a JWT.
- Every protected request is scoped to the authenticated account's household.
- There is no endpoint that lists all registered users.
- The household state is shared by the account's devices and is saved automatically.
- Household members are names/profiles inside the account; they are not separate global users.
