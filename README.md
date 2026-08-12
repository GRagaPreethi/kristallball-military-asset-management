# Kristallball Military Asset Management System

Kristallball Asset Operations is a production-ready React/Express/PostgreSQL system for tracking military equipment, ammunition, purchases, transfers, assignments, expenditures, inventory posture, role-based access, and audit history across multiple bases.

## Capabilities

- Multi-base inventory calculated from purchase and movement history
- Purchases, transfers, assignments, and expenditures with stock validation
- Transactional transfer processing with rollback and audit logging
- Role-based access for administrators, base commanders, and logistics officers
- Dashboard metrics, inventory views, movement records, and audit trail
- PostgreSQL persistence through Drizzle ORM
- OpenAPI contract with generated React Query hooks and Zod schemas
- Seeded demo data for local verification

## Repository layout

```text
artifacts/
  api-server/       Express API, authentication, RBAC, seed logic, and routes
  kristallball/     React/Vite frontend
lib/
  api-client-react/ Generated React Query API client
  api-spec/         OpenAPI contract and code generation
  api-zod/          Generated request/response schemas
  db/               PostgreSQL pool, Drizzle schema, and database commands
scripts/            Workspace utility scripts
```

## Requirements

- Node.js 24 or a compatible current Node.js runtime
- pnpm
- PostgreSQL

Install dependencies from the workspace root:

```bash
pnpm install --frozen-lockfile
```

## Environment variables

Copy the relevant example file before running a service:

```bash
cp .env.example .env
```

The real `.env` file is intentionally excluded from the submission package. Configure these values through the deployment platform’s environment-variable or secrets manager instead of committing them.

| Variable | Required | Used by | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | API and database tooling | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | API server | Long, random secret used to sign 8-hour JWT sessions |
| `PORT` | Yes | API and Vite services | Listening port for the current process; use `8080` for the API and `19373` for the frontend in the included Replit artifact configuration |
| `BASE_PATH` | Yes for Vite services | Frontend build/dev servers | Vite base path; use `/` for Kristallball and `/__mockup` for the component preview server |
| `NODE_ENV` | No, recommended | API server and build tooling | Use `development` locally and `production` for deployment |
| `LOG_LEVEL` | No | API server | Pino log level; defaults to `info` |
| `REPL_ID` | No | Vite development tooling | Replit runtime identifier; only needed for optional Replit development plugins |

`DATABASE_URL` and `SESSION_SECRET` are sensitive. Never place their real values in source control, a ZIP submission, screenshots, or logs. The application uses `SESSION_SECRET`; `JWT_SECRET` is not a current application variable.

The service-specific examples are also included at:

- `artifacts/api-server/.env.example`
- `artifacts/kristallball/.env.example`
- `lib/db/.env.example`

## Run and verify

The managed Replit artifact configuration starts the API and frontend with the correct service ports. For direct local commands, use the corresponding environment values:

```bash
# API server
PORT=8080 NODE_ENV=development pnpm --filter @workspace/api-server run dev

# Frontend
PORT=19373 BASE_PATH=/ pnpm --filter @workspace/kristallball run dev
```

The API seeds demo data at startup. The database schema can be pushed in a development database with:

```bash
pnpm --filter @workspace/db run push
```

Useful checks:

```bash
pnpm run typecheck
PORT=19373 BASE_PATH=/ pnpm --filter @workspace/kristallball run build
```

Demo accounts created by the seed script:

- `admin_user` — `ADMIN`
- `commander_alpha` — `BASE_COMMANDER`
- `logistics_officer` — `LOGISTICS_OFFICER`

Use credentials supplied through a secure local setup or deployment environment; do not commit passwords.

## Deployment configuration

The included `.replit-artifact/artifact.toml` files define the existing API and static frontend services. Keep those files and their configured paths, ports, build commands, and rewrites intact when deploying. The frontend uses relative `/api` requests through the configured Replit routing.

## Security notes

- Authentication is enforced by the API, not only by frontend navigation.
- Base-scoped roles are restricted server-side.
- Passwords are hashed with bcrypt.
- Transfers validate available stock inside a PostgreSQL transaction.
- Inventory is derived from immutable movement records rather than stored balance fields.
- Mutations and authentication events are recorded in the audit log.