# semu

Backend API server for semu (Korean tax, HR, payroll and bookkeeping SaaS), redesigned from a static analysis of the existing web client and its support manual.

## Layout

| Path | Contents |
|---|---|
| `docs/design/` | Domain design (Korean). Start with [`docs/design/README.md`](docs/design/README.md) |
| `docs/reference/spec/` | Evidence from the analysis: endpoints, fields and rules per domain, read from the client bundle |
| `docs/reference/rules/` | Business rules of the current client, traced from the bundle and the manual (Korean). Index: [`docs/reference/rules/README.md`](docs/reference/rules/README.md) |
| `docs/reference/legacy-design/` | Design of the earlier wire-compatible implementation, kept for its rule decisions |
| `alfred-manual/` | The Alfred Business support manual converted to Markdown |
| `apps/api/` | The API server. Bounded contexts live in `apps/api/src/modules/` as modules of a modular monolith |
| `apps/api/test/fixtures/rules/` | Input → output cases for each rule, used as server test data |
| `scripts/alfred-manual/` | Crawler that produced `alfred-manual/` |

## Development

```sh
cd apps/api
pnpm install
pnpm dev        # http://localhost:3000/v1/health
pnpm typecheck
pnpm test
pnpm format     # or format:check
pnpm build
```

## Status

The server is built on Effect (`effect/http-api`), with the HTTP contract in `apps/api/src/api.ts`; persistence (SQLite + outbox, decided) is not wired yet and every repository is in memory. Open decisions are listed in `docs/design/review.md`.
