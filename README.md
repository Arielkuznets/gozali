# Gozali

Gozali (Hebrew for "my little chick") is a mobile app where a small group of friends raises one shared virtual creature. The creature only stays alive if every member does a real-world habit each day and proves it with a photo.

## Docs

- [Product spec](docs/product-spec.md)
- [Decision log](docs/decisions.md)
- [Simulation results](docs/simulation.md)

## Code

- [`apps/mobile`](apps/mobile) – the Expo app (iOS and Android).
- [`supabase`](supabase) – database schema (migrations), row level security and database tests.
- [`packages/game-engine`](packages/game-engine) – the game rules as a dependency-free TypeScript module. Node 24+ runs it directly, with no build step.

## Development

npm workspaces; run `npm install` once at the root.

```sh
npm run typecheck   # every workspace
```

```sh
npx supabase start     # local Supabase in Docker
npx supabase test db   # pgTAP tests in supabase/tests
```

```sh
cd packages/game-engine
npm test            # unit tests (node:test)
npm run typecheck   # tsc, fetched on demand
npm run sim         # simulator, see docs/simulation.md
```
