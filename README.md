# SchoolVerse

Interactive IT management for schools and IT support companies: map buildings, rooms, devices and network infrastructure, manage equipment, track faults and simulate outages.

**Status: Phase 1 of 6** — foundation, authentication, organisations & roles, school management, buildings/floors/rooms and a live dashboard. See the [roadmap](#roadmap).

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router, Server Components, Server Actions), React 19, TypeScript |
| Styling | Tailwind CSS 3, Radix primitives, Lucide icons, Framer Motion, next-themes |
| Data | PostgreSQL + Prisma ORM, committed SQL migrations |
| Auth | Custom, server-side sessions (bcrypt passwords, HMAC-hashed session tokens, httpOnly cookies) |
| Validation | Zod on every server action |
| Hosting | Render (web service + managed PostgreSQL) via `render.yaml` |

The floor builder is a hand-built isometric SVG renderer (`src/components/map`) — no canvas library needed, server-renderable previews, crisp at any zoom. Later phases add React Flow (network diagrams), S3-compatible private storage, QR generation and CSV/PDF export.

## Run it locally

Prerequisites: Node.js 20.11+ and PostgreSQL 14+.

```bash
# 1. Create a database and user (adjust to taste)
psql -U postgres -c "CREATE USER schoolverse WITH PASSWORD 'schoolverse' CREATEDB;"
psql -U postgres -c "CREATE DATABASE schoolverse OWNER schoolverse;"

# 2. Install and configure
npm install
cp .env.example .env
# edit .env: set AUTH_SECRET to a long random string:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 3. Create the schema and load the demo school
npx prisma migrate deploy
npm run db:seed

# 4. Start
npm run dev
```

Open http://localhost:3000, then either **Create a free workspace** or **Explore the demo school**.

Useful scripts:

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run typecheck` | TypeScript check |
| `npm run db:migrate` | Create a new migration after editing `prisma/schema.prisma` |
| `npm run db:deploy` | Apply committed migrations |
| `npm run db:seed` | Rebuild the demo workspace (touches demo data only) |

`npm run build` also applies migrations and loads the demo, so hosts that only run build + start (e.g. Hostinger) are set up automatically. If anything is misconfigured, open `/api/health` — it lists what's wrong without revealing secrets.
| `npm run db:studio` | Browse the database |
| `npm run user:reset-link -- email` | Print a one-time password reset link (account recovery without email) |

## Deploy to Render

1. Push this repository to GitHub.
2. In Render choose **New → Blueprint** and select the repo. `render.yaml` creates a PostgreSQL database and a Node web service, wires `DATABASE_URL`, and generates `AUTH_SECRET`.
3. Set `APP_URL` to the service's public URL (e.g. `https://schoolverse.onrender.com`) — it's used for invitation and QR links.
4. Deploy. The start command runs `prisma migrate deploy` before starting Next.js, so migrations apply automatically on every release. `/api/health` is the health check.
5. Load the demo once from the service's **Shell** tab: `npm run db:seed`.

Environment variables are documented in `.env.example`.

## Email (password resets and invitations)

SchoolVerse sends two emails: password reset links (single use, 30 minutes) and team invitations (7 days). It uses [Resend](https://resend.com)'s HTTP API; SMTP works as a fallback.

1. Create a Resend account and verify a sending domain (a subdomain such as `mail.yourdomain.co.uk` is recommended).
2. Add the DNS records Resend shows you (MX and TXT on `send.<subdomain>`, TXT on `resend._domainkey.<subdomain>`), then click **Verify**.
3. Create an API key with sending access.
4. Set `RESEND_API_KEY` and `EMAIL_FROM` (an address on the verified domain) in the host's environment variables and redeploy.
5. Open `/api/health`: `emailProvider` should say `resend`.

Without email configured, admins can still create reset links (Team page) and copy invitation links by hand.

## Architecture

```
prisma/
  schema.prisma          Data model for all phases (tenancy, estate, assets, faults, network, simulation, audit)
  migrations/            Committed SQL migrations
  seed.ts                Fictional demo workspace
src/
  middleware.ts          Edge redirect for signed-out visitors (UX only; not a security boundary)
  actions/               Server actions — every one validates input and calls authorize()
  app/
    page.tsx             Public landing page
    (auth)/              Login, registration
    (app)/               Authenticated app: dashboard, schools, team
    invite/[token]/      Accept invitations
    api/health/          Health check
  components/            UI (ui/ primitives, app shell, dashboard, schools, team)
  lib/
    auth/                Sessions, password hashing, RBAC matrix, request auth context
    tenant.ts            Organisation-scoped lookups
    stats.ts             Live dashboard queries
    validation.ts        Zod schemas
```

### Security model

- **Authentication.** Passwords are hashed with bcrypt (cost 12). Sessions are random 256-bit tokens; the database stores only an HMAC-SHA256 of each token keyed by `AUTH_SECRET`, so a database leak can't be replayed. Cookies are `httpOnly`, `SameSite=Lax` and `Secure` in production. Sign-in and sign-up are rate-limited, and unknown emails take the same time to reject as wrong passwords.
- **Tenancy.** Every customer record belongs to an organisation. Server code never loads tenant data by id alone: lookups go through `src/lib/tenant.ts` (or include `organisationId` in the `where`), so an id from another workspace resolves to "not found".
- **Authorisation.** `src/lib/auth/rbac.ts` holds the permission matrix (Owner, Admin, Technician, Viewer). Every server action calls `authorize(permission)`, which re-reads the user's membership on each request — removing someone takes effect immediately. Admins can't create, demote or remove owners; a workspace always keeps one owner.
- **Demo.** Visitors share a read-only Viewer account in an isolated demo organisation that can't sign in with a password.
- **Audit.** Significant changes are written to `AuditLog` and shown in the dashboard's activity feed.
- **Headers.** `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a narrowed permissions policy are sent on every response. Server Actions get Next.js's built-in Origin check against CSRF.

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Architecture, auth, organisations & roles, invitations, schools, buildings/floors/rooms, live dashboard, demo seed, Render deployment | **Done** |
| 2 | Asset register: CRUD, search & filters, moves, CSV template/import/export, server cabinets with rack positions, photos (private storage) | All done except photos |
| 3 | Interactive floor plans: 3D (isometric) floor builder, drag/resize rooms, equipment on floors, cable runs (Cat5e/6/6a/7, fibre SM/MM, coax) with lengths, Wi-Fi access points with coverage, cabinets with rack views, layer toggles, uploaded plan images | All done except plan image upload |
| 4 | QR labels, scan-to-record, faults & maintenance workflows | |
| 5 | Network diagrams (React Flow) and the What Breaks If? simulator | |
| 6 | Reports (assets, warranties, faults, infrastructure, simulations) and polish | |

The schema already contains the tables later phases use, so they add features without reshaping existing data.
