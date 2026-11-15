# semu

Backend API server for semu (Korean tax, HR, payroll and bookkeeping SaaS), redesigned from a static analysis of the existing web client and its support manual.

## Layout

| Path | Contents |
|---|---|
| `docs/design/` | Domain design (Korean). Start with [`docs/design/README.md`](docs/design/README.md) |
| `docs/reference/spec/` | Evidence from the analysis: endpoints, fields and rules per domain, read from the client bundle |
| `docs/reference/rules/` | Business rules of the current client, traced from the bundle and the manual (Korean). Index: [`docs/reference/rules/README.md`](docs/reference/rules/README.md) |
| `apps/api/` | The API server. Bounded contexts live in `apps/api/src/modules/` as modules of a modular monolith |
| `apps/api/test/fixtures/rules/` | Input → output cases for each rule, used as server test data |

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

The server is built on Effect (`effect/http-api`), with the HTTP contract in `apps/api/src/api.ts`; data is stored in SQLite (`data/semu.sqlite`) with one transaction per request and an outbox for cross-context events. Open decisions are listed in `docs/design/review.md`.
