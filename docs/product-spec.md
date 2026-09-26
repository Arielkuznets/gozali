# Pack — Product Spec (version 1)

Sep 26, 2026 · @Ariel kuznets

## 1. Overview

Pack is an app where a small group of friends raises one shared virtual creature that lives and grows only if every one of them does a real habit every day and proves it with a photo. "Pack" is a working name.

**Audience:** people aged 15–30, starting in Israel, who want to stick to a habit (gym, studying, reading) and find it hard to do alone.

**Version 1 goals:**

- Prove that friend groups come back to the app every day: a target of 40% of packs active after 14 days.
- Viral loop: every new pack brings 3–5 new users through an invite link.
- An experience that feels polished and personal, not "another habit app".

**What makes the product different:**

- **One creature shared by the pack**, not a personal creature per user.
- **Fed only by real-world habits.** Taps inside the app don't keep it alive.
- **One habit per pack**, so everyone does the same thing and can connect around it.
- **Gentle punishment:** the creature gets weaker and "runs away", but it never dies, and there is always a way to bring it back.

## 2. Core concepts

| Term | Definition |
| --- | --- |
| Pack | 2–8 users with one shared habit and one creature |
| Critter | The pack's shared character, with health, mood and a growth stage |
| Feed | A daily photo proving that a user did the habit |
| Successful day | A day on which every member fed, used a rest day or used a joker |
| Rest day | A day on which a member doesn't have to feed; a weekly quota set by the pack |
| Joker | A one-time day off, one per member per month |
| Pack streak | The number of successful days in a row |
| Running away | The state the creature enters when its health reaches 0 |
| Day close | A server process that runs at midnight in the pack's time zone and computes the result |

## 3. Packs

Each pack is an independent unit with one habit, one creature and its own rules; a user can be in up to 3 packs on the free version.

**Creating a pack:**

1. Pack name (up to 30 characters).
2. Category: Gym, Study, Reading, Running, Water, or Custom (free text up to 40 characters, for example "Meditate 10 min").
3. Rest days per week: 0–4. Default by category: Gym 3, Running 3, Study 1, Reading 0, Water 0, Custom 1.
4. Choosing an egg: one of 3 creature species.
5. A unique invite link is created, with a share button ready for WhatsApp.

**Joining:**

- Invite link (deep link). If the app is installed, a "Join pack" screen opens; if not, it goes to the store, and after installing and signing up the user joins the pack directly (deferred deep link).
- Maximum 8 members. A full pack shows a matching message.
- Someone who joins in the middle of the day starts counting only from the next day.

**Permissions:**

- **The pack creator is the admin:** changes the name, rest days and the creature's name, and removes members.
- A change to rest days takes effect from the start of next week.
- **Leaving:** any member can leave. If the admin leaves, admin passes to the longest-standing member.
- A pack with no members is deleted after 30 days.

**Week:** starts on Sunday by default; the admin can change it to Monday.

## 4. The critter

The critter is the heart of the product: its state reflects the pack's commitment in real time, and it has a personality that makes people want to take care of it.

**Hatching:** after the pack is created an egg is shown, which hatches with an animation when the second member joins. The pack chooses its name (any member can suggest, the admin approves).

**Three creature species in version 1**, each with a different personality expressed in its look, movement and lines:

| Species | Personality | Example line when hungry |
| --- | --- | --- |
| Blob | Lazy and sleepy, complains in a cute way | "I was napping but also... starving?" |
| Spark | Dramatic and easily offended | "Wow. Nobody fed me. I see how it is." |
| Mossy | Nerdy and calm, loves facts | "Fun fact: I haven't eaten in 14 hours." |

**Health:** 0–100. Starts at 70.

**States:**

| State | Health range | How it looks |
| --- | --- | --- |
| Thriving | 85–100 | Bouncing, sparkling eyes |
| Happy | 60–84 | Calm, smiling |
| Hungry | 40–59 | Looking at the plate, rumbling belly |
| Weak | 20–39 | Lying down, faded colors |
| Sick | 1–19 | Blanket and thermometer |
| Ran away | 0 | The creature is gone; a note is left: "Gone to find food" |

In addition, during the day its mood changes by how many members have already fed: the more have fed, the happier it is.

**Growth:** experience points (XP) come from successful days.

| Stage | XP needed | Roughly after |
| --- | --- | --- |
| Egg | 0 | Creation |
| Baby | 1 | The first successful day |
| Kid | 7 | A week |
| Teen | 21 | Three weeks |
| Adult | 45 | A month and a half |
| Legend | 100 | Three months |

Every stage change gets an animation and a celebratory notification to the whole pack.

**Fitting the category:** from the Kid stage, the creature gets an item that fits the habit: a small dumbbell for Gym, glasses for Reading, headphones for Study, running shoes for Running, a bottle for Water.

**Pack memory:** events leave a permanent mark on the creature: a medal after 30 successful days in a row, a small bandage after it came back from running away, a holiday hat on holidays.

**Live behaviors (no effect on health):**

- Blinking, yawning and breathing when idle.
- Follows your finger with its eyes when you touch the screen.
- Petting: reacts with an animation and a line.
- Sleeps at night (22:00–07:00) with a nightcap.
- Reacts to being fed: an eating animation with the photo that was taken.

## 5. Game rules

Every day closes at midnight in the pack's time zone, and the result is set by the number of members who missed. All the numbers here are initial and are calibrated in user testing; they should be defined as constants in the code, not scattered through it.

**Day close, for every active member of the pack:**

1. Fed today: counts.
2. Activated a joker for today: counts.
3. Paused: not counted at all.
4. Didn't feed and has rest days left this week: a rest day is used automatically, counts.
5. Otherwise: a miss.

**Day result:**

| State | Health | XP | Streak |
| --- | --- | --- | --- |
| 0 misses (successful day) | +10 (up to 100) | +1 | +1 |
| One miss or more | -8 per member who missed | No change | Resets to 0 |

Example: a pack of 5, two missed. Health drops by 16, and the streak resets.

**Running away and coming back:**

- Health 0: the creature enters the Ran away state and disappears from the screen.
- Feeding continues as usual. After 3 successful days in a row the creature comes back with 40 health and a permanent bandage.
- XP and the growth stage are **not erased** by running away, so months of work are not lost.

**Joker:**

- One per member per calendar month. Doesn't accumulate.
- Activated manually, only for the current day and before the day closes. It cannot be activated retroactively.
- Members see that a joker was activated ("Noa is taking a joker today").

**Pause:**

- For a vacation, a flight or reserve duty: up to 14 days, once every two months.
- During a pause the member is not counted, and the creature is not hurt by them.

**Inactive member:** after 5 misses in a row, the member gets a message ("Still in? Your pack misses you") with an option to pause or leave, and the admin gets an option to remove them. This prevents a situation where one member who disappeared kills the creature for everyone.

**Edge cases:**

- A new member is counted only from the day after joining.
- A feed counts by the server time relative to the pack's time zone, not by the phone clock.
- The day close must be idempotent: running the same day twice doesn't change the result.

## 6. Feeding and proof

A user feeds the creature with a photo taken inside the app right now; this is the only action that affects health.

**The flow:**

1. Tap the Feed button on the pack screen.
2. An in-app camera opens: front or back camera by choice (not both together, so strangers at the gym aren't photographed).
3. Take the photo, then an option to retake.
4. Optional caption, up to 80 characters.
5. Send: an animation of the creature eating, the user's circle lights up for everyone, and a notification is sent to the members.

**Rules:**

- **No uploads from the gallery.** Only a live photo.
- The timestamp is set on the server at the moment of upload.
- One feed per day per user per pack counts. More photos can be posted to the feed ("Post extra"), without affecting health.
- A user in several packs feeds each pack separately.
- Photos are compressed on the device before upload (maximum width 1080px, JPEG at quality 0.7).
- **Offline mode:** if there is no internet, the feed is queued and sent when the connection returns. The feed time is the capture time, as long as it is sent up to an hour after that day closed.

**No automatic photo check in version 1.** The protection against cheating is: live photos only, a timestamp, and exposure to the members in the feed. In a future version: on-device image classification (Apple Vision) that asks to retake the photo if it doesn't fit the category, without involving the members.

## 7. Social

The social part creates the positive pressure and the reason to open the app even after you fed.

**Pack feed:** all feeds and extra posts, newest first. Each item shows a photo, caption, name, time and reactions. System events are mixed into the feed: "Pixel evolved to Teen", "Noa is taking a joker", "Pixel ran away".

**Reactions:** a fixed set of 5 emoji: 🔥 💪 😂 👏 🤨. One reaction per user per item, and it can be changed. 🤨 (for a suspicious photo) has **no effect at all on the creature**; it's only social pressure.

**Nudge:** next to a member who hasn't fed yet there is a button that sends them a notification: "{petName} is looking at you 👀". Limit: one nudge per day from each member to each member.

**Weekly recap:** created at the end of every week (by the pack's week start).

- How many successful days out of 7, and the change in health.
- The most consistent member this week.
- A collage of up to 9 photos from the week.
- The creature in its current state.
- A share button that creates an image in story format (1080×1920) with a logo and a download link.

**Monthly board:** on the critter profile screen, a grid of the month: for each day, who fed, who rested and who missed.

## 8. Notifications

Few notifications, and only ones that change behavior; each type can be turned off separately in settings.

| Notification | When | Default |
| --- | --- | --- |
| Friend fed | A member fed | On |
| Evening reminder | At the time the user chose (default 20:00), if they haven't fed yet | On |
| Last one | All the other members already fed and only you are left | On |
| Nudge | A member nudged you | On |
| Pet state | The creature moved to Weak, Sick, Ran away, or came back | On |
| Evolution | The creature moved up a stage | On |
| Weekly recap | The weekly recap is ready | On |

**Rules:** no more than 6 notifications per day per user per pack (except Friend fed, which is merged: "3 friends fed Pixel"). No notifications between 23:00 and 07:00 in the user's time, except the weekly recap. The texts are written in the creature's voice, according to its personality.

## 9. Screens and flows

Nine screens in version 1; the main screen is the pack screen, where the user spends most of the time.

| Screen | What's on it |
| --- | --- |
| Welcome | Creature animation, Sign in with Apple and Google buttons |
| Profile setup | Display name, profile photo (optional), notification permission request with an explanation |
| Home | The list of packs: for each pack the creature in its state, a health bar, and how many members fed today (3/5). A create pack button and join with a code |
| Pack | The animated creature in the center, health bar, streak, a row of member circles (colored = fed, dashed = rest or joker, gray = not yet), a big Feed button, and the feed below |
| Camera | Capture, switch camera, retake, caption, send |
| Create pack | Four steps: name, category, rest days, egg, then the link sharing screen |
| Critter profile | Stage and progress to the next XP, monthly board, medals and marks |
| Pack settings | Name, rest days, members (removal for the admin), invite link, pause, joker, leave |
| Settings | Reminder time, notifications by type, language, privacy, delete account |

**Main flows:**

1. **A new user who creates a pack:** Welcome, sign-in, Profile setup, Create pack, sharing the link on WhatsApp, the Pack screen with an egg waiting for the second member.
2. **A new invited user:** tap the link, store, install, sign-in, Profile setup, joined automatically, hatching animation if they are the second member.
3. **Daily use:** notification or opening the app, Pack, Feed, camera, send, animation, scrolling the feed and reactions.
4. **An evening without feeding:** a reminder in the creature's voice, opening straight to the relevant pack's camera.

**Rule of thumb:** from opening the app to a sent feed, no more than 3 taps and 10 seconds.

## 10. Design direction

The design should feel colorful, soft and hand-drawn, and in no way generic or "AI slop"; the creature is the product, so it gets most of the attention.

**Principles:**

- **Limited palette:** 5–6 warm pastel shades and one accent. A cream background (about #FBF6EE), not white. No neon, no purple-blue gradients.
- **Soft shapes:** rounded corners, few and subtle shadows, a subtle paper texture or grain in backgrounds.
- **Typography:** a rounded font with character for headings, and a clean readable font for text. Two fonts at most.
- **Motion:** every action gets small satisfying feedback (a bounce, a light vibration). Animations are short (200–400ms) and fun.

**The character:**

- **A simple silhouette** that is recognizable even at 40px.
- **Big expressive eyes**, which carry most of the emotion.
- **A small characteristic flaw** for each species, like a droopy ear or a buck tooth.
- **Alive and breathing:** idle animations (blinking, breathing), reaction to touch, and changes by time of day.
- **A color the pack chooses** from 6 shades that fit the palette.

**Process:**

1. Mood board, then sketches of 2–3 directions. Choosing one.
2. Final design of the characters by a human illustrator, to keep consistency across all states and stages. Image generators are used only for exploration.
3. Animation in Rive, with one state machine per creature species. Inputs: health, stage, mood, isSleeping, triggers for feed and pet.

**In version 1, until the final design is ready:** use a simple temporary character (a basic shape with eyes) so development isn't held up, and replace it later. The code should treat the character as one component that receives state, so the replacement is a single change.

## 11. Privacy, safety and store policy

The app includes content that users upload (photos), so it must meet Apple's and Google's user-generated content requirements already in version 1, or it will be rejected in review.

**Privacy:**

- Photos are visible only to pack members. Storage in a private bucket, access only through short-lived signed links.
- Photos are deleted automatically after 30 days, except the weekly recap collages.
- No location, no contacts, no ad tracking.
- Privacy policy and terms of use available in the app and at a public link.

**Mandatory store requirements:**

- **Account deletion inside the app**, including all photos and data.
- **Sign in with Apple** is mandatory when offering Google sign-in.
- **Reporting content:** every photo has a Report option, and the report is saved for review.
- **Blocking and removal:** a user can leave a pack at any moment, and an admin can remove a member.
- **Terms of use** that forbid offensive content, and a way to get in touch (an email address).
- **Minimum age 13**, with a declaration at sign-up.

**Emotional safety:** the punishment is always gentle. The creature doesn't die, the texts are funny and not blaming, and there are pauses and jokers so nobody feels they "ruin it" for everyone because of an illness or a life event.

## 12. Language and localization

The interface is in English by default, with translation infrastructure from day one, so adding Hebrew later is only translation work.

- All texts in translation files (i18n), no hard-coded text in the code. Language detection with `expo-localization`.
- Components are built to support right-to-left (RTL) layout, even if Hebrew is only added later.
- The creatures' lines are written separately for each language, not translated word for word, to keep the humor and personality.
- Dates and times are shown in the user's time zone and format.

## 13. Data model

Eleven tables in Postgres (Supabase). All access is protected with Row Level Security: a user sees only data of packs where they are an active member.

| Table | Main fields |
| --- | --- |
| users | id, display\_name, avatar\_url, timezone, locale, reminder\_time, created\_at |
| packs | id, name, category, custom\_habit, rest\_days\_per\_week, week\_start, timezone, invite\_code, admin\_id, created\_at |
| critters | id, pack\_id, species, name, color, health, xp, stage, status (active / ran\_away), streak, recovery\_days, marks (jsonb), hatched\_at |
| pack\_members | pack\_id, user\_id, role (admin / member), status (active / paused / left), paused\_until, joined\_at |
| feeds | id, pack\_id, user\_id, photo\_path, caption, day (date), is\_extra, created\_at |
| reactions | feed\_id, user\_id, emoji, created\_at (unique key: feed\_id + user\_id) |
| jokers | pack\_id, user\_id, day (date) |
| day\_results | pack\_id, day, fed\_ids, rested\_ids, joker\_ids, paused\_ids, missed\_ids, health\_before, health\_after, success |
| nudges | pack\_id, from\_user, to\_user, day |
| reports | id, feed\_id, reporter\_id, reason, created\_at, handled |
| push\_tokens | user\_id, token, platform, updated\_at |

**Notes:**

- Rest days used this week are computed from day\_results, and not stored as a separate counter, to avoid contradictions.
- day\_results is both history (for the monthly board) and protection against a double close: a unique key on pack\_id + day.
- Every change to health, XP and the creature's state is made only on the server, inside a transaction. The app never writes them directly.

## 14. Technology and architecture

Expo on the app side and Supabase on the server side, with all the game logic on the server so it's impossible to cheat from the device. No Mac needed: building and submitting are done on EAS.

**App:**

| Area | Tool |
| --- | --- |
| Base | Expo (latest SDK), TypeScript, Expo Router |
| Camera and photos | expo-camera, expo-image-manipulator (compression) |
| Notifications | expo-notifications + Expo Push Service |
| Animations | react-native-reanimated, Rive (@rive-app/react-native) |
| Data | @supabase/supabase-js, TanStack Query |
| Language | expo-localization + an i18n library |
| Haptics | expo-haptics |
| Share image | react-native-view-shot |
| Monitoring | Sentry (crashes), PostHog (analytics) |

Important: Rive and some of the modules require a **development build**, not Expo Go. You build it once on EAS and install it on the iPhone.

**Server (Supabase):**

- **Auth:** Sign in with Apple and Google.
- **Postgres + RLS:** all the tables from section 13.
- **Storage:** a private bucket for photos, signed links.
- **Edge Functions:**
  - `submit-feed`: verifies pack membership, computes "the day" by the pack's time zone, and checks that there is no counted feed yet today.
  - `join-pack`: joining with an invite code, with a check for a free spot.
  - `nudge`, `use-joker`, `pause`: each with its own checks and limits.
  - `close-days`: runs every 15 minutes (cron), and closes the day for every pack whose midnight passed since the previous run. Idempotent.
  - `weekly-recap`: creates the recap data at the end of each pack's week.
  - `send-push`: batched sending through Expo Push, with the rate limits from section 8.

**Invite links:** a simple landing page at an address like `pack.app/i/CODE`, which opens the app if it's installed (universal link) or sends to the store. On the first open after installing, the app offers "Have an invite code?" and detects a code copied to the clipboard, so a paid deferred deep link service isn't needed.

**Build and distribution:** EAS Build for iPhone and Android, EAS Submit to TestFlight and the stores, EAS Update for fast JavaScript updates without a new review.

## 15. Scope and build phases

Version 1 includes all of sections 3–12 of this document, with a temporary character; the build is split into nine phases, and each phase ends with something that can be tested on the iPhone.

| Phase | What gets built | Done when... |
| --- | --- | --- |
| 0. Infrastructure | Expo project, Supabase, sign-in, development build | You can sign in from the iPhone and see an empty home screen |
| 1. Packs | Creation, invite link, joining, pack settings | Two iPhones in the same pack |
| 2. Temporary critter | One character component that receives state (health, stage, mood) | The creature changes when values change in the database |
| 3. Feeding | Camera, compression, upload, submit-feed, eating animation | A feed shows up for the other member |
| 4. Game engine | close-days, rest days, joker, pause, running away and coming back | Unit tests pass for all the rules in section 5 |
| 5. Social | Feed, reactions, nudge, monthly board | Full use in a real pack for a whole day |
| 6. Notifications | All notification types and the rate limits | The evening reminder and "Last one" arrive |
| 7. Recap and sharing | weekly-recap, story image | A recap can be shared to Instagram |
| 8. Store readiness | Account deletion, reporting, privacy policy, icon, screenshots | TestFlight with 3 friend packs for two weeks |

**Success metric before launch:** at least 2 out of 3 test packs still active after 14 days.

**In later versions (not in version 1):**

- A widget of the creature on the home screen and the lock screen.
- Automatic feeding from the health app (steps, workouts).
- A timer for study and reading packs.
- Automatic on-device photo checks.
- A cosmetic item shop and a home for the creature.
- More creature species, and Hebrew.

## 16. Business model

The game itself is completely free, and revenue comes from cosmetic items and an optional subscription; no payment changes the rules of the game. Version 1 ships with no payments at all, and monetization comes in only after retention is proven.

**What is sold:**

- **Cosmetic items for the creature:** hats, accessories, backgrounds and homes. An item that was bought appears on the whole pack's creature, so the members see it too, and that's part of the motivation to buy.
- **A gift for the pack:** a member buys an item for the shared creature, with a message in the feed ("Dan got Pixel a crown").
- **Pack+ subscription:** unlimited packs (instead of 3), more creature species, special colors, an exclusive item every month and advanced statistics. Initial test price: about $2.99 a month or $19.99 a year.

**What is not sold:**

- Jokers, revivals, health or XP. That would break the logic: someone who pays wouldn't need to work out.
- Ads. They hurt the emotional experience and bring in very little at a small scale.

**Technical:** purchases through RevenueCat, which manages In-App Purchases in both stores, the subscriptions and verification against the server.

## 17. Open decisions

- [ ] Final name for the app, and a check that the name and domain are free in the stores.
- [ ] Design direction for the characters: illustrated pastel, clay or sticker.
- [ ] Who illustrates the characters, and who animates them in Rive.
- [ ] Calibrating the numbers in section 5 (health up and down, growth thresholds) after two weeks of TestFlight.
- [ ] Whether 3 free packs is right, or a different limit is better.
- [ ] Launch language: English only, or English and Hebrew together.
