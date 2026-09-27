# Decision log

Each entry: what was decided, what the options were, and why. Decisions D1–D11 were made on Sep 26, 2026 and are the basis for version 3.1 of the [product spec](product-spec.md).

## D1 · Success model: an allowed miss in packs of 5 or more

- **Decided:** a day is successful when at least one member fed and the misses didn't go over the allowed number: 0 in a pack of 2–4 counted members, 1 in a pack of 5–8. Every miss always costs 8 health, even on a successful day.
- **Options:** "all or nothing"; an allowed miss in large packs; partial XP by the share of members who fed.
- **Why:** with "all or nothing", the chance of a successful day drops exponentially with pack size, while the penalty grows linearly. In a pack of 8 where every member is covered on 90% of days, health drops by 2.1 a day on average, and Kid arrives only after about 16 days. With an allowed miss, such a pack gains health at any size and reaches Kid after 8–11 days, and packs of 2–4 are not affected. Partial XP was rejected because it blurs the moment of "we did it today".

## D2 · Version 1 scope: full and expanded

- **Decided:** everything in the spec goes into version 1, plus widgets, achievements and a wardrobe, a focus timer, the Me screen, QR invites, Onboarding and accessibility.
- **Options:** a narrowed pilot (one species, no items and no story) or a full version.
- **Why:** a product decision: a rich first version, not a thin one. The temporary character makes it possible to build all the features before the final illustration is ready.

## D3 · Architecture: rules as a pure module, actions as Postgres functions

- **Decided:** the game rules are in a pure TypeScript module with no dependencies (`packages/game-engine`). User actions are Postgres functions called through RPC. The day close is an Edge Function that runs the module and applies the result through one Postgres function (`apply_day_result`).
- **Options:** everything in PL/pgSQL; an Edge Function with a direct connection to Postgres; the combination.
- **Why:** supabase-js doesn't support a transaction across several operations, so every atomic write has to run inside Postgres. The rules themselves stay in TypeScript, so the same code serves the server, the tests and the simulator.

## D4 · A dependency-free module that runs directly in Node

- **Decided:** game-engine is written in TypeScript using only syntax that can simply be erased (no enum and no namespace), with `.ts` extensions in imports. The tests run with `node --test` and the simulator with `node`, with no build step.
- **Why:** Node 24 runs TypeScript directly, Deno (Edge Functions) imports it as is, and Metro in the app compiles it. With no dependencies there is nothing to break between the environments.

## D5 · A pilot on iOS and Android

- **Decided:** 5–6 packs, at least half of them not close friends of the developer, on both platforms, for at least two weeks.
- **Why:** almost every friend group has Android users. Google Play requires a closed test of 12 testers for 14 days before publishing from a new personal account anyway. 3 packs of friends are a small and biased sample.

## D6 · The day ends at 03:00

- **Decided:** the day ends at 03:00 in the pack's time zone, and the grace window lasts until 04:00.
- **Options:** midnight or 03:00.
- **Why:** the audience works out and studies late. The cost is that after midnight "today" doesn't match the calendar date, so the pack screen has a countdown to the end of the day.

## D7 · Language

- **Decided:** an English pilot, a public launch in English and Hebrew.
- **Why:** the first audience is Israeli and starts at age 15. The creatures' humor is rewritten in Hebrew, not translated.

## D8 · Transparency

- **Decided:** the names of those who missed appear only in the members row and on the monthly board. Notifications don't say who missed. 🤨 is shown as a number without names.
- **Why:** seeing who missed is the shared accountability itself. A "suspicious" reaction with a visible name can turn into a tool for bullying, especially at 15.

## D9 · Widgets in version 1

- **Decided:** home screen widgets on iOS and Android (small, medium, large) and a lock screen widget on iOS. On iOS: WidgetKit in SwiftUI through `@bacons/apple-targets`; on Android: `react-native-android-widget`.
- **Options:** the official `expo-widgets` (widgets as React components through `@expo/ui`).
- **Why:** `expo-widgets` is currently iOS only, in alpha and without image support, and the creature is an image. The widget shows no photos or names of members, because the home screen and the lock screen are visible to others.

## D10 · Additions to version 1

- **Decided:** achievements that unlock items for the wardrobe (with no payment), a focus timer for Study and Reading, the Me screen, QR invites, Onboarding and accessibility.
- **Left for later versions:** feeding from the health app (it contradicts the photo proof and needs a lot of native code), on-device photo checks, and a paid shop and Gozali+ (monetization only after retention is proven).
- **Why:** the wardrobe is built now so that paid items can go into it later with no change in structure.

## D11 · Name: Gozali

- **Decided:** Gozali ("my little chick" in Hebrew). Pack stays the name of a group inside the app, and the future subscription is called Gozali+.
- **Options checked:** Hatchmates, Bondling and Pactling (too advanced in English); SquadPet, YallaPet and FriendsPet (too generic); Blobbo. Many short, cute names (Zuzu, Munchi, Nomi, Buba, Feedo and more) are already taken.
- **Why:** short, easy to say in Hebrew and in English, and it tells the story: a creature that hatches from an egg and the pack raises it together. On Sep 26, 2026 there was no app with this name on the App Store (US and Israel), and the gozali.app domain was free. There is an app called Gozal for service providers, in a different field. This is not a trademark search.

## D12 · The temporary critter is drawn in code

- **Decided:** until the illustrated critter exists, the critter is SVG markup generated from its state by a pure TypeScript package (`packages/critter-art`). The app shows it with `react-native-svg` inside one `Critter` component, which adds the idle motion (breathing, blinking, a bounce when thriving, a wobble when the egg cracks) and petting.
- **Options:** fixed image files per species, stage and state; or drawing with react-native-svg components directly.
- **Why:** 3 species × 5 stages × 6 states × 6 colors × the wardrobe is too many image files, and layers in code cover every combination. Markup (rather than components) is plain text, so the same function can feed the Android widget (which takes SVG), images for the iOS widget, and a contact sheet for review, and Node tests every combination without a device. When the Rive character arrives, only the `Critter` component changes.

## D13 · Running the day close

- **Decided:** the close-days Edge Function runs the game engine; the database gathers each day's input (`day_close_input`) and applies each result (`apply_day_result`) in one transaction. pg_cron calls the function every 15 minutes through pg_net; the function's address and a shared secret sit in Vault, and the function checks the secret instead of a user token.
- **Options:** the whole close in plpgsql; a scheduler outside Supabase (for example GitHub Actions).
- **Why:** the rules stay in one TypeScript module shared with the tests and the simulator (D3), while the queries that collect a day's facts stay in SQL, next to the data and covered by pgTAP. The function imports the engine from `packages/game-engine` directly, so there is no copy to drift; that works in local serving, and the first cloud deploy has to confirm it (the fallback is a copy in `supabase/functions/_shared` checked by a test). Keeping the secrets in Vault keeps them out of migrations and the public repo.
