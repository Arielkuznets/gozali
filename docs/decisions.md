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
- **Why:** 3 species × 5 stages × 6 states × 6 colors × the wardrobe is too many image files, and layers in code cover every combination. Markup (rather than components) is plain text, so the same function can feed the Android widget (which takes SVG), images for the iOS widget, and a contact sheet for review, and Node tests every combination without a device. D19 later made this drawing the final character.

## D13 · Running the day close

- **Decided:** the close-days Edge Function runs the game engine; the database gathers each day's input (`day_close_input`) and applies each result (`apply_day_result`) in one transaction. pg_cron calls the function every 15 minutes through pg_net; the function's address and a shared secret sit in Vault, and the function checks the secret instead of a user token.
- **Options:** the whole close in plpgsql; a scheduler outside Supabase (for example GitHub Actions).
- **Why:** the rules stay in one TypeScript module shared with the tests and the simulator (D3), while the queries that collect a day's facts stay in SQL, next to the data and covered by pgTAP. The function imports the engine from `packages/game-engine` directly, so there is no copy to drift; that works in local serving and in the bundler deploys use (`npm run functions:bundle`, run in CI; each function has its own `deno.json` so Deno doesn't mistake the repo's `package.json` for the function's). The first cloud deploy (September 27, 2026) confirmed that the CLI bundles and uploads them, so no copy is needed. Keeping the secrets in Vault keeps them out of migrations and the public repo.

## D14 · Feed events come from triggers

- **Decided:** the system lines in the pack feed (joined, hatched, evolved, ran away, came back, achievement, joker, dressed, named) live in a `pack_events` table that database triggers fill when the critter, the achievements, the day passes or the members change.
- **Options:** have each server function write its own events; or build the lines in the app from day results, achievements and passes.
- **Why:** a trigger fires on every path that changes the data, including the day close run by the service role and future admin fixes, so no path can forget its event. Building the lines in the app would miss changes that leave no row behind (wardrobe changes, naming) and would repeat the logic on every device. Events use the clock time, not the transaction time, so a day close that hatches the critter and unlocks an achievement lists them in order.

## D15 · Notification rules run when a row is claimed

- **Decided:** actions only queue rows; the rules of spec section 8 (preferences, quiet hours, the daily cap, and whether a reminder still makes sense) run in `claim_notifications`, in the database, at the moment a row is due. The send-push function only renders texts and talks to Expo Push.
- **Options:** filter when queueing; or apply the rules in the Edge Function.
- **Why:** most rules depend on the moment of sending, not of queueing: a reminder queued at 20:00 is pointless if the member fed at 20:03, and the daily cap depends on what already went out that day. Doing it at claim time, with `for update skip locked`, also keeps two overlapping runs from sending the same row. SQL makes each rule testable in pgTAP with a chosen clock.

## D16 · The critter in the widgets

- **Decided:** the widgets draw the critter with the same code as the app. `widget-state` renders it to PNG with resvg (WebAssembly) for the iOS widget, in a day and a night version with a versioned address so the widget can cache it; the Android widget receives the drawing input and renders the SVG itself (`SvgWidget`).
- **Options:** image files exported per species, stage, state and color with the wardrobe layered on top (spec section 10, step 4); the app saving screenshots of the critter into the App Group; drawing the critter again in SwiftUI.
- **Why:** the exported set would be hundreds of files for the temporary character, and redone for the final one. App screenshots go stale overnight, when the day close changes the critter and the app isn't running. A second drawing in Swift would drift from the app. Rendering on the server keeps one drawing, and it costs one small image per pack per change. Any change to the drawing reaches the widgets with no extra work.

## D17 · Moderation before the developer looks

- **Decided:** a blocked-word check in the database on every text members write (captions, pack, critter and member names, habit texts, name suggestions), with the list kept in a table; every report emails the developer; the third report on the same photo hides it until the developer reviews it.
- **Options:** filtering only in the app; hiding on the first report; waiting for the developer on every report.
- **Why:** the store requires filtering and fast handling of reports (spec section 11). A check in the database can't be skipped by an old app version or a crafted request, and a table lets new words go in without a release. Hiding on the first report would let one member silence another; three independent reports mean the pack agrees something is wrong, and the developer still reviews within 24 hours.

## D18 · How the app is tested

- **Decided:** five layers, all run in CI on every push: unit tests (the game engine, the critter drawing, and the app's logic with Jest); pgTAP tests of the database rules; smoke scripts that drive the real API, storage, realtime and Edge Functions of a local Supabase; end-to-end tests with Playwright on the web build of the app, in a phone-sized browser against that same local stack; and typechecks and lint.
- **Options:** only unit and database tests; end-to-end tests on devices with Detox or Maestro.
- **Why:** most of the product's rules live in the database and the Edge Functions, so tests have to run against a real Supabase, not mocks. The web build covers the screens and flows (create, join, feed with a fake camera, settings) in minutes on a plain CI runner, with no emulator or Mac. It doesn't cover native-only parts (widgets, push, the real camera, sign-in providers); those are checked on devices with the EAS builds.

## D19 · The final critter is drawn in code

- **Decided:** there is no illustrator and no Rive. The critter drawn in code (D12) becomes the final character, gets a full design pass in code before the launch, and is animated in the app with Reanimated.
- **Options:** a human illustrator for the characters and Rive for the animation (the plan in spec version 3.1); images from an image generator.
- **Why:** the owner's choice. The code drawing already covers every species, stage, state, color, outfit and mark, and it feeds the widgets and the story image from one function (D16). An illustrated set would have to be redrawn for every new item or state and exported for the widgets, and Rive would add a second drawing to keep in step. Design changes stay reviewable in git and testable in Node.

## D20 · Six creatures, each with its own color

- **Decided:** a pack picks one of six creatures (Mochi, Kit, Axo, Ribbit, Hoot, Bun). Each has a fixed color, its own body and faces, and its own lines. The critters table stores only the creature; the color comes from the drawing.
- **Options:** three species in six colors (spec version 3.1); letting packs pick any color for any creature.
- **Why:** the owner's choice after reviewing the designs. Six distinct characters give packs more to choose from than recolors of three, and a fixed color keeps each creature recognizable across packs, widgets and shared stories. The database migration renamed the three enum labels to three of the creatures and added three, so no stored critter or function had to be rebuilt.

## D21 · Coins and the outfit shop

- **Decided:** every successful day earns the pack coins by the streak after the day: 1, then 2 from 7 days, 3 from 14 and 5 from 30. Nothing while the critter is an egg or away. The coins belong to the pack, like the critter, and any member spends them on outfits in a shop (10 to 45 coins each). Achievements still give their item for free; the halo, the cape and the space background can only be earned. The game engine counts the coins; the database keeps the wallet, the catalog and what each pack bought.
- **Options:** coins per member; coins for every fed photo; outfits only from achievements (spec version 3.1).
- **Why:** the owner wanted outfits to cost coins that come from keeping the streak. Pack coins match the shared critter and the spec's rule that the pack succeeds or fails together; per-member coins would reward individuals and invite comparison. Tying the amount to the streak makes a long streak worth protecting without punishing a pack more when it breaks. The simulator puts a typical pack at about 8 to 17 coins a week and a very consistent one near 24, so an item takes from a few days to a few weeks. Keeping three items earn-only keeps the achievements meaningful.

## D22 · Error reports in our own database for the pilot

- **Decided:** the app reports its errors to a table in the project's database (`app_errors`, written only through `report_app_error`, at most 50 a day per member, kept 30 days): screens that fail to draw right away, and JavaScript errors that close the app on the next start. Native crashes come from TestFlight and the Google Play Console. The pilot's numbers come from `pilot_metrics`, so there is no analytics service either.
- **Options:** Sentry for crashes and PostHog for analytics (spec version 3.2); nothing until the launch.
- **Why:** it needs no new account or key, the reports stay in the EU with the rest of the data, and a few lines of SQL answer every question a pilot of 5 or 6 packs raises. Sentry adds symbolicated native stacks and alerts, which matter at the scale of a public launch; the decision is revisited then.
