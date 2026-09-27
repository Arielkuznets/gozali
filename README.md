# Gozali

Gozali (Hebrew for "my little chick") is a mobile app where a small group of friends raises one shared virtual creature. The creature only stays alive if every member does a real-world habit each day and proves it with a photo.

## Docs

- [Product spec](docs/product-spec.md)
- [Decision log](docs/decisions.md)
- [Simulation results](docs/simulation.md)
- [Cloud setup](docs/setup.md): Supabase, EAS builds, sign-in providers and the gozali.app site
- [Privacy policy](docs/legal/privacy-policy.md) and [terms of use](docs/legal/terms-of-use.md) (drafts for the pilot)

## Code

- [`apps/mobile`](apps/mobile) – the Expo app (iOS and Android).
- [`supabase`](supabase) – database schema (migrations), row level security and database tests.
- [`packages/game-engine`](packages/game-engine) – the game rules as a dependency-free TypeScript module. Node 24+ runs it directly, with no build step.
- [`web`](web) – the gozali.app site: landing and invite pages, privacy and terms; `node web/build.mjs` builds it into `web/dist`.
- [`packages/critter-art`](packages/critter-art) – the temporary critter, drawn as SVG markup from its state (species, stage, health, outfit, night).

## Development

npm workspaces; run `npm install` once at the root.

```sh
npm run typecheck   # every workspace
```

```sh
npx supabase start     # local Supabase in Docker
npm run db:test        # pgTAP tests in supabase/tests
npm run db:types       # regenerate apps/mobile/src/lib/database.types.ts
npm run smoke:packs    # pack flow against local Supabase (needs SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY)
npm run smoke:critter  # a critter change reaches pack members live, and only them (same keys)
npm run smoke:feeds    # upload, feed, live update and photo access for members only (same keys)
npm run smoke:day-close  # six days closed by the real close-days code: hatching, joker, sleep (same keys)
npm run smoke:push       # friend-fed merging, "last one", the critter's lines and dead tokens, with a stand-in for Expo Push
npm run smoke:widgets    # the widget token and endpoint (needs `npx supabase functions serve`)
npm run smoke:delete-account  # account deletion end to end (needs `npx supabase functions serve`)
```

```sh
# The scheduled functions locally: put CRON_SECRET=<any value> in supabase/functions/.env, then
npx supabase functions serve
curl -X POST -H "x-cron-secret: <value>" http://127.0.0.1:54321/functions/v1/close-days
curl -X POST -H "x-cron-secret: <value>" http://127.0.0.1:54321/functions/v1/send-push
```

```sh
cd packages/game-engine
npm test            # unit tests (node:test)
npm run typecheck   # tsc, fetched on demand
npm run sim         # simulator, see docs/simulation.md
```

```sh
cd packages/critter-art
npm test                           # every combination renders valid SVG
npm run preview -- critters.html   # contact sheet of all states, stages and items
npm run icons                      # redraw the app icons in apps/mobile/assets/images from the critter
npm run holidays                   # regenerate the holiday-hat dates from the Hebrew calendar
```
