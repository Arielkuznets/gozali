# Pack

A mobile app where a small group of friends raises one shared virtual creature. The creature only stays alive if every member does a real-world habit each day and proves it with a photo.

## Docs

- [Product spec](docs/product-spec.md)
- [Decision log](docs/decisions.md)
- [Simulation results](docs/simulation.md)

## Code

- [`packages/game-engine`](packages/game-engine) – the game rules as a dependency-free TypeScript module. Node 24+ runs it directly, with no build step.

## Development

```sh
cd packages/game-engine
npm test            # unit tests (node:test)
npm run typecheck   # tsc, fetched on demand
npm run sim         # simulator, see docs/simulation.md
```
