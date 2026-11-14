# WISP Captive Portal

Self-service captive portal splash page for a WISP hotspot: pick a package, pay by M-Pesa STK Push, get connected. See [`README.md`](README.md) and `docs/` for the full design — this file is working conventions for whoever (human or Claude) edits this repo.

## Stack
Next.js (App Router, `src/`, Cache Components enabled), TypeScript (strict), Tailwind CSS v4, Zod, pnpm, Docker. Database: Postgres via Prisma for this app's own data; a second, separately-generated Prisma client reads/writes the shared FreeRADIUS/daloRADIUS MariaDB — see `docs/RADIUS-INTEGRATION.md` before touching anything under `prisma/radius/` or `src/lib/radius/`.

> This Next.js version differs from older releases. Read `node_modules/next/dist/docs/` before using unfamiliar APIs.

## Commands
- `pnpm dev` — dev server on :3000
- `pnpm check` — lint + typecheck + format check (run before every commit)
- `pnpm lint` / `pnpm typecheck` / `pnpm format` (write) / `pnpm format:check` / `pnpm build`
- `docker compose up -d db` — local Postgres only (host port 5435)
- `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:studio` — this app's own schema (`prisma/app`)
- `pnpm radius:pull` / `pnpm radius:generate` — sync `prisma/radius/schema.prisma` from the live daloRADIUS database (pull), or just regenerate the client after editing it by hand (generate). **Never** `prisma migrate` against the radius datasource — daloRADIUS's own SQL files own that schema.
- `pnpm docker:dev` — db + dev container with hot reload + a quick Cloudflare tunnel pointed at it
- `pnpm docker:prod` — db + production image + a quick Cloudflare tunnel pointed at `web-prod`
- `pnpm docker:clean` — tear down all compose services, **including volumes** (wipes the local `db` data) — `docker compose down --volumes --remove-orphans`

## Git workflow
- `master` is always releasable. Never commit feature work directly to it after the initial scaffold.
- Branch from `master`: `feat/<name>`, `fix/<name>`.
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`). Merge to `master` only after lint, typecheck and build pass.

## Conventions
- Server Components by default; add `"use client"` only for interactivity.
- Validate every external input (forms, API route bodies, env, Safaricom's callback payload) with Zod. Shared schemas live in `src/lib/schemas/`.
- **Zod is the source of truth for types** for anything with an external shape (API payloads, forms, Safaricom's callback). Prisma already generates types for the two databases — don't re-derive those with Zod, only validate the request/response boundary around them.
- **No customer accounts.** Subscribers are identified by phone number only, same guest-first philosophy as other apps in this workspace.
- Keep components small, in `src/components/<area>/` (`ui/` for primitives, `portal/` for the feature itself).
- Server-only modules (`src/lib/env.ts`, `src/lib/db/*`, `src/lib/mpesa/*`, `src/lib/radius/*`) import `server-only` and must never be imported from a `"use client"` file — see `src/lib/opnsense/logon.ts` + the `/connecting` page for the pattern of computing anything env-dependent server-side and handing the client component a plain data object instead.

## UI components (shadcn/ui)
- **Use shadcn/ui components; never build UI primitives (button, input, label, card, etc.) from scratch.** Add them with `pnpm dlx shadcn@latest add <component>`; they land in `src/components/ui/` (Radix base, `radix-nova` style, config in `components.json`).
- shadcn semantic tokens (`--background`, `--primary`, `--border`, ...) are mapped to the palette in `src/app/globals.css`. The site is dark-only (`dark` class on `<html>`). Change colours there, not per component.
- Notifications use Sonner (`toast`) for things like failed payment submission; inline messages for anything tied to a specific field or flow step.
- After `shadcn add`, check that `package.json` has no stray `cn` dependency and that components import `cn` from `@/lib/utils`.
- Icons: `lucide-react`.

## RADIUS integration — read before touching
- `src/lib/radius/provision.ts` and `src/lib/radius/cleanup.ts` write to a database this app does not own the schema of. Read `docs/RADIUS-INTEGRATION.md` in full before changing the attribute names, the username strategy (phone number, not random — see "Tracking returning subscribers"), or the delete-then-insert pattern.
- `prisma/radius/schema.prisma` is a hand-written approximation until a real daloRADIUS install exists to `prisma db pull` against. Don't "clean it up" into something that no longer matches the real FreeRADIUS SQL schema's table/column names.

## M-Pesa integration — read before touching
- `src/lib/mpesa/client.ts` implements Safaricom Daraja's OAuth + STK Push + STK Push query. Field names in requests/responses are Safaricom's and must match their docs exactly, not be "cleaned up" to local naming conventions.
- `POST /api/mpesa/callback` must stay idempotent (Safaricom retries) and must always return `{ ResultCode: 0, ResultDesc: "Accepted" }` with HTTP 200, even on our own internal errors — see the comment at the top of that route.

## Scheduled cleanup
`POST /api/radius-cleanup` (protected by `CRON_SECRET` as a bearer token) must be triggered periodically by something outside this app — a cron job, systemd timer, or your platform's scheduled-task feature — e.g.:

```bash
curl -X POST https://portal.example.com/api/radius-cleanup -H "Authorization: Bearer $CRON_SECRET"
```

Running it every few minutes is reasonable; it's cheap and idempotent.

## Formatting and tooling rules
Formatting is enforced by tooling, never by hand. Config files: `.prettierrc.json`, `.prettierignore`, `.editorconfig`, `eslint.config.mjs`.
- **No semicolons. Two-space indentation, spaces only, LF line endings, final newline.** Double quotes, trailing commas, 100-column print width. Prettier (with `prettier-plugin-tailwindcss`) is the single source of truth.
- After editing code, run `pnpm format` then `pnpm check`. Both must be clean before committing.
- No `console.log` in committed code (`console.warn` / `console.error` only — the M-Pesa callback and RADIUS provisioning paths use `console.error` deliberately for cases that need investigating but must not fail the HTTP response).
- Prettier does not format `*.md`; keep Markdown tidy by hand.

## Code quality: maintainability and readability first
- **Clear over clever.** No nested ternaries, no dense one-liners, no premature abstraction.
- **Names carry the meaning.** Descriptive, intention-revealing names. Booleans read as questions.
- **Small and single-purpose.** One job per function and per file.
- **Types.** TypeScript `strict`, no `any` (use `unknown` and narrow with Zod), no non-null `!` assertions without a reason.
- **Structure by feature.** `src/components/portal/`, `src/lib/mpesa/`, `src/lib/radius/`, `src/lib/opnsense/` — not grouped by file kind.
- **Leave it tidy.** Delete dead code rather than commenting it out. `pnpm lint` and `pnpm exec tsc --noEmit` must be clean before every commit.

## Roadmap
1. Scaffold (current): splash + package picker, M-Pesa STK Push, RADIUS provisioning, OPNsense auto-login
2. Wire up a real daloRADIUS install, replace `prisma/radius/schema.prisma` with a real `prisma db pull`
3. Admin screen for managing packages (currently seeded directly in Postgres)
4. Decide on active CoA/Disconnect enforcement (see `docs/RADIUS-INTEGRATION.md`)
