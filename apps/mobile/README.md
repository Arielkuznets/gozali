# Gozali mobile app

Expo SDK 57 with Expo Router and TypeScript. Routes live in `src/app`, everything else in `src/`.

## Setup

1. Copy `.env.example` to `.env` and fill in the Supabase URL and publishable key.
2. Install from the repository root: `npm install`.
3. Add packages with `npx expo install <package>`, so versions match the SDK.

## Commands

```sh
npm run start       # dev server for a development build
npm run typecheck   # tsc
npm run lint        # expo lint
```

The app needs a development build (Sign in with Apple and later Rive and widgets are native code), built with EAS: `npx eas-cli build --profile development`.
