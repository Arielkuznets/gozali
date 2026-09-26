# Pack — Product Spec (version 2)

Sep 26, 2026 · @Ariel kuznets

> Version 2 fixes logic bugs and contradictions between sections of version 1. The list of changes is in section 18, and the decisions that are still open are in section 17.

## 1. Overview

Pack is an app where a small group of friends raises one shared virtual creature that lives and grows only if every one of them does a real habit every day and proves it with a photo. "Pack" is a working name.

**Audience:** people aged 15–30, starting in Israel, who want to stick to a habit (gym, studying, reading) and find it hard to do alone.

**Version 1 goals:**

- Prove that friend groups come back to the app every day: a target of 40% of packs active after 14 days. **Active pack:** at least 2 members, and at least half of the members, fed 3 times or more in the last 7 days.
- Viral loop: every new pack brings 3–5 new users through an invite link, **and invited users open new packs of their own**. The second metric (the share of invited users who opened a pack of their own within 30 days) is the one that shows real virality; the first only measures pack size.
- An experience that feels polished and personal, not "another habit app".

**What makes the product different:**

- **Fed only by real-world habits.** Taps inside the app don't keep it alive. This is the main difference, because a shared creature by itself already exists (for example in Pengu, where you feed with taps and mini-games).
- **One creature shared by the pack**, not a personal creature per user (as in Finch).
- **One habit per pack**, so everyone does the same thing and can connect around it.
- **Gentle punishment:** the creature gets weaker and "runs away", but it never dies, and there is always a way to bring it back.

**Closest in mechanics:** Habitica, where a boss hurts the whole party when someone misses. Worth learning from their experience with collective punishment.

## 2. Core concepts

| Term | Definition |
| --- | --- |
| Pack | 2–8 users with one shared habit and one creature |
| Critter | The pack's shared character, with health, mood and a growth stage |
| Feed | A daily photo proving that a user did the habit |
| Counted member | A member who has already fed at least once, and is not paused or asleep. Only counted members affect the creature |
| Successful day | A day on which every counted member fed, rested or used a joker, and at least one of them actually fed |
| Neutral day | A day with no misses and no feeds (for example when everyone rests or is paused). Nothing changes |
| Rest day | A day on which a member doesn't have to feed; a weekly quota set by the pack |
| Joker | A one-time day off, one per member per month |
| Pause | A planned absence (vacation, reserve duty) the member turns on; while paused they are not counted |
| Sleep | An automatic state for a member who stopped feeding; they are not counted until their next feed |
| Pack streak | The number of successful days in a row; a neutral day neither adds to it nor breaks it |
| Running away | The state the creature enters when its health reaches 0 |
| Grace window | One hour after the day ends, during which feeds captured offline are still accepted |
| Day close | A server process that computes the result of each day, after the day ends in the pack's time zone and after the grace window |

## 3. Packs

Each pack is an independent unit with one habit, one creature and its own rules; a user can be in up to 3 packs on the free version.

**Creating a pack:**

1. Pack name (up to 30 characters).
2. Category: Gym, Study, Reading, Running, Water, or Custom (free text up to 40 characters, for example "Meditate 10 min").
3. Rest days per week: 0–4. Default by category: Gym 3, Running 3, Study 1, Reading 0, Water 0, Custom 1.
4. Choosing an egg and a color: one of 3 creature species, and one of 6 colors that fit the palette.
5. A unique invite link is created, with a share button ready for WhatsApp.

**Joining:**

- **Invite link.** If the app is installed, the link opens the Join pack screen. If not, the landing page shows the invite code, copies it to the clipboard when the download button is tapped, and sends to the store. After installing and signing up:
  - **Android:** the code arrives through Google Play (Install Referrer), and the user joins automatically.
  - **iOS:** a "Have an invite code?" screen appears with a paste button or manual typing. On iOS there is no fully automatic join without a paid service, and that is a conscious trade-off.
- Maximum 8 members. A full pack shows a matching message. The limit is enforced in the database, so two people joining at the same moment can't go over it.
- **A new member counts only from the day of their first feed.** Until then they appear in the members row as not started yet, they can be nudged, and they don't affect the creature. That way a member who joined and never started doesn't hurt the pack.

**Permissions:**

- **The pack creator is the admin:** changes the name, rest days and week start, chooses the creature's name (from the suggestions, and can change it later), and removes members.
- A change to rest days takes effect from the start of next week.
- **Leaving:** any member can leave. If the admin leaves, admin passes to the longest-standing member.
- A pack with no members is deleted after 30 days.

**Week:** starts on Sunday by default; the admin can change it to Monday. The change takes effect at the end of the current week. When moving from Sunday to Monday, the Sunday in between joins the ending week (one 8-day week); when moving the other way, the current week is cut to 6 days. The rest-day quota of that week doesn't change.

## 4. The critter

The critter is the heart of the product: its state reflects the pack's commitment in real time, and it has a personality that makes people want to take care of it.

**Egg and hatching:**

- After the pack is created an egg is shown. Until the second member joins, the pack's days are not closed.
- When the second member joins, the egg starts to crack with an animation, and days start to close. While the creature is an egg, the day close doesn't change health, XP or the streak.
- **The egg hatches on the first successful day on which at least two members fed.** That day counts as a regular successful day, and the creature moves to the Baby stage.
- **Name:** after hatching, a "Name me!" card appears in the feed. Any member can suggest a name, and the admin picks one. Until then the creature is called by its species name (Blob, Spark or Mossy).

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

In addition, during the day its mood changes by how many of the counted members have already fed: the more have fed, the happier it is.

**Growth:** experience points (XP) come from successful days.

| Stage | XP needed | Roughly after (if every day is successful) |
| --- | --- | --- |
| Egg | — | Creation |
| Baby | 1 | Hatching |
| Kid | 7 | A week |
| Teen | 21 | Three weeks |
| Adult | 45 | A month and a half |
| Legend | 100 | Three months |

In practice not every day is successful. In a pack of 5 where each member is covered on 90% of days, only about 60% of days are successful, so every stage takes about 1.7 times the time in the table (Kid after about 12 days). The thresholds will be calibrated in the simulator (section 5).

Every stage change gets an animation and a celebratory notification to the whole pack.

**Fitting the category:** from the Kid stage, the creature gets an item that fits the habit: a small dumbbell for Gym, glasses for Reading, headphones for Study, running shoes for Running, a bottle for Water.

**Pack memory:** events leave a permanent mark on the creature: a medal after 30 successful days in a row, a small bandage after it came back from running away, a holiday hat on holidays. (The 30-day medal is very rare in large packs, and the simulator will check whether the bar is right.)

**Live behaviors (no effect on health):**

- Blinking, yawning and breathing when idle.
- Follows your finger with its eyes when you touch the screen.
- Petting: reacts with an animation and a line.
- Sleeps at night (22:00–07:00 by the device clock) with a nightcap.
- Reacts to being fed: an eating animation with the photo that was taken.

## 5. Game rules

Every day closes after the day ends in the pack's time zone (midnight; the hour is an open decision, section 17) and after a one-hour grace window, and the result is set by the number of members who missed. All the numbers here are initial, and are calibrated first in the simulator and then in user testing; they should be defined as constants in the code, not scattered through it.

**Day close, for every member of the pack:**

1. Left, never fed, paused or asleep: not counted at all.
2. Fed today: counts.
3. Activated a joker or declared a rest for today: counts.
4. Didn't feed and has rest days left this week: a rest day is used automatically, counts.
5. Otherwise: a miss.

**Day result:**

| State | Health | XP | Streak |
| --- | --- | --- | --- |
| Successful day: 0 misses and at least one feed | +10 (up to 100) | +1 | +1 |
| Neutral day: 0 misses and no feeds | No change | No change | No change |
| One miss or more | -8 per member who missed | No change | Resets to 0 |

Example: a pack of 5, two missed. Health drops by 16, and the streak resets.

**Pack size changes the difficulty.** Because a successful day needs everyone, the bigger the pack, the more reliable each member has to be just so health doesn't drop: about 79% in a pack of 3, 87% in a pack of 5 and 92% in a pack of 8. Whether to keep the "all or nothing" model is open (section 17).

**Running away and coming back:**

- Health 0: the creature enters the Ran away state and disappears from the screen.
- Feeding continues as usual. While it's away, health stays at 0 and no XP is added. When the pack streak reaches 3, meaning three successful days in a row after running away, the creature comes back with 40 health and a permanent bandage.
- XP and the growth stage are **not erased** by running away, so months of work are not lost.

**Rest days:**

- You can declare "Resting today" in advance, if there are rest days left this week. The member's circle is shown dashed, and they don't get nudges or reminders that day.
- Someone who didn't declare and didn't feed, and has rest days left this week, gets a rest day automatically at the day close.
- If the member feeds after declaring a rest, the rest day is canceled and returns to the quota.

**Joker:**

- One per member per calendar month. Doesn't accumulate.
- Activated manually, only for the current day and before the day ends (not in the grace window). It cannot be activated retroactively.
- If the member feeds on the same day after activating a joker, the joker is canceled and returned to them.
- Members see that a joker was activated ("Noa is taking a joker today").

**Pause:**

- For a planned absence: a vacation, a flight or reserve duty. The pause starts on the day after it is turned on (for an absence today there's the joker).
- Length: 3 to 60 days. It can end early, but not before 3 days have passed.
- A new pause is possible only 30 days after the previous one ended.
- During a pause the member is not counted, and the creature is not hurt by them.
- The limit is on minimum length and on frequency, not on a short maximum length: the abuse to prevent is short, frequent pauses instead of a lazy day, not long absences like reserve duty.

**Sleep (inactive member):**

- A member with 3 misses within 7 days goes to sleep automatically: they are not counted, the creature is not hurt by them, and their circle is shown with 💤.
- They get a gentle message ("Still in? Your pack misses you") with an option to pause or leave.
- Their next feed wakes them immediately, and they count on that same day.
- That way one member who disappeared doesn't kill the creature for everyone, and nobody has to "kick out" a friend. The admin can still remove members at any moment.
- The rule counts misses within a window and not misses in a row, because rest days are used automatically: with 3 rest days a week, a member who disappeared collects at most 4 misses in a row, so a "5 in a row" rule would never have fired.

**Edge cases:**

- A new member counts from the day of their first feed.
- A feed counts by the server time relative to the pack's time zone, not by the phone clock. The only exception is an offline feed (section 6).
- The day close must be idempotent: running the same day twice doesn't change the result.
- Days close in order, because each day depends on the result of the previous one. If a close failed or was late, the next run fills in all the missing days.
- The end of the day is computed by the pack's time zone (IANA), so on a daylight saving change the day lasts 23 or 25 hours.

**Simulator:** before the pilot, a script that runs these rules over simulated packs of different sizes and reliability levels, and measures the rate of health change, the chance of running away and the time to each stage. The rules should be implemented as one pure function (previous state and the day's data in, a result out), used by both the server day close and the simulator; that depends on the decision about where the game engine runs (section 17).

## 6. Feeding and proof

A user feeds the creature with a photo taken inside the app right now; this is the only action that affects health.

**The flow:**

1. Tap Feed: on the pack card on the home screen, or on the pack screen.
2. An in-app camera opens: front or back camera by choice (not both together, so strangers at the gym aren't photographed).
3. Take the photo, then an option to retake.
4. Optional caption, up to 80 characters.
5. Send: an animation of the creature eating, the user's circle lights up for everyone in real time, and a notification is sent to the members.

**Rules:**

- **No uploads from the gallery.** Only a live photo.
- The timestamp is set on the server at the moment of upload.
- One feed per day per user per pack counts. The rule is enforced in the database, so a double tap on send can't create two counted feeds. More photos can be posted to the feed ("Post extra"), without affecting health.
- A user in several packs feeds each pack separately.
- Photos are compressed on the device before upload (maximum width 1080px, JPEG at quality 0.7).
- The caption is filtered for offensive words before it is posted (a store requirement, section 11).
- **Offline mode:** if there is no internet, the feed is queued and sent when the connection returns. If it was captured before the day ended and reached the server within the grace window, it counts for the day it was captured. This is the only case where the server trusts the phone clock, and it is a conscious trade-off: the window is limited to one hour, and the photo is visible to the members. The day close waits for the end of the grace window, so its result is final.

**No automatic photo check in version 1.** The protection against cheating is: live photos only, a timestamp, and exposure to the members in the feed. In a future version: on-device image classification (Vision on iOS, ML Kit on Android) that asks to retake the photo if it doesn't fit the category, without involving the members.

## 7. Social

The social part creates the positive pressure and the reason to open the app even after you fed.

**Pack feed:** all feeds and extra posts, newest first. Each item shows a photo, caption, name, time and reactions. System events are mixed into the feed: "Pixel evolved to Teen", "Noa is taking a joker", "Pixel ran away", and a "Name me!" card after hatching. After 30 days the photo is deleted (section 11), and the item stays without a photo.

**Reactions:** a fixed set of 5 emoji: 🔥 💪 😂 👏 🤨. One reaction per user per item, and it can be changed. 🤨 (for a suspicious photo) has **no effect at all on the creature**; it's only social pressure.

**Nudge:** next to a member who hasn't fed yet, including a member who hasn't started or is asleep, there is a button that sends them a notification: "{petName} is looking at you 👀". Limit: one nudge per day from each member to each member. You can't nudge a paused member, or a member who activated a joker or declared a rest today.

**Weekly recap:** created at the end of every week (by the pack's week start) and saved.

- How many successful days out of the days of the week, and the change in health.
- The most consistent member this week (on a tie, everyone at the top).
- A collage of up to 9 photos from the week.
- The creature in its current state.
- A share button that creates an image in story format (1080×1920) with a logo and a download link. **The story image includes only the creature, the pack's numbers and the sharing user's own photos**, with no photos of other members, because photos are visible only to pack members.

**Monthly board:** on the critter profile screen, a grid of the month: for each day, who fed, who rested or used a joker, who was paused or asleep, and who missed.

## 8. Notifications

Few notifications, and only ones that change behavior; each type can be turned off separately in settings.

| Notification | When | Default |
| --- | --- | --- |
| Friend fed | A member fed | On |
| Evening reminder | At the time the user chose (default 20:00), if they haven't fed yet. If that time is after the pack's day end (a member in another time zone), it is sent two hours before the day ends | On |
| Last one | All the other counted members already fed, and only this user hasn't | On |
| Nudge | A member nudged | On |
| Pet state | The creature moved to Weak, Sick, Ran away, or came back | On |
| Evolution | The creature hatched or moved up a stage | On |
| Still in? | The user went to sleep | On |
| Weekly recap | The weekly recap is ready | On |

**Rules:**

- No more than 6 notifications per day per user **in total, across all packs together**. When the limit is reached, only Evening reminder and Last one are sent.
- Friend fed doesn't count toward the limit, because it is merged: notifications waiting for the same user about the same pack are sent together ("3 friends fed Pixel"), after waiting up to 10 minutes.
- Reminders, Last one and nudges are not sent to someone who isn't counted today (paused, asleep) or who activated a joker or declared a rest.
- No notifications between 23:00 and 07:00 in the user's time, with no exceptions. A notification created in those hours that is still relevant in the morning (Weekly recap, Evolution, Pet state, Still in?) is sent at 07:00; the rest are dropped.
- The texts are written in the creature's voice, according to its personality.

## 9. Screens and flows

Eleven screens in version 1; the main screen is the pack screen, where the user spends most of the time.

| Screen | What's on it |
| --- | --- |
| Welcome | Creature animation, Sign in with Apple and Google buttons |
| Profile setup | Display name, profile photo (optional), age 13+ declaration and accepting the terms, notification permission request with an explanation |
| Home | The list of packs: for each pack the creature in its state, a health bar, how many members fed today (3/5) **and a direct Feed button**. A create pack button and join with a code |
| Join pack | The pack name, the habit, the creature and the members, and a join button. On the first open after installing on iOS: "Have an invite code?" with paste or typing |
| Pack | The animated creature in the center, health bar, streak, a row of member circles (colored = fed, dashed = rest or joker, 💤 = asleep or paused, gray = not yet, including someone who hasn't started), a big Feed button with "Not today" next to it (rest or joker), and the feed below |
| Camera | Capture, switch camera, retake, caption, send |
| Create pack | Four steps: name, category, rest days, egg and color, then the link sharing screen |
| Critter profile | Stage and progress to the next XP, monthly board, medals and marks |
| Weekly recap | The weekly recap and the button to share it as a story |
| Pack settings | Name, rest days, week start, members (removal for the admin), invite link, pause, joker, leave |
| Settings | Reminder time, notifications by type, language, privacy, blocked users, delete account |

Reporting and blocking are in the menu of every feed item and of every member.

**Main flows:**

1. **A new user who creates a pack:** Welcome, sign-in, Profile setup, Create pack, sharing the link on WhatsApp, the Pack screen with an egg waiting for the second member.
2. **A new invited user:** tap the link, landing page (copying the code), store, install, sign-in, Profile setup, joining (automatic on Android, pasting the code on iOS), and the egg cracking if they are the second member.
3. **Daily use:** notification or opening the app, Feed from home or from the pack screen, camera, send, animation, scrolling the feed and reactions.
4. **An evening without feeding:** a reminder in the creature's voice, opening straight to the relevant pack's camera.

**Rule of thumb:** from opening the app to a sent feed, no more than 3 taps and 10 seconds: Feed on the pack card, capture, send.

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
- **A color the pack chooses** from 6 shades that fit the palette, picked when the pack is created.

**Process:**

1. Mood board, then sketches of 2–3 directions. Choosing one.
2. Final design of the characters by a human illustrator, to keep consistency across all states and stages. Image generators are used only for exploration.
3. Animation in Rive, with one state machine per creature species. Inputs: health, stage, mood, isSleeping, and triggers for feed, pet, crack (the egg cracking) and hatch.

**In version 1, until the final design is ready:** use a simple temporary character (a basic shape with eyes) so development isn't held up, and replace it later. The code should treat the character as one component that receives state, so the replacement is a single change.

## 11. Privacy, safety and store policy

The app includes content that users upload (photos), so it must meet Apple's and Google's user-generated content requirements already in version 1, or it will be rejected in review. Apple's user-generated content guideline (1.2) requires four things: filtering, reporting with a quick response, blocking users and contact details.

**Privacy:**

- Photos are visible only to pack members. Storage in a private bucket, access only through short-lived signed links. In the app, the photo cache is keyed by the photo id, because the signed link changes every time.
- Photos are deleted automatically after 30 days, except photos that went into a weekly recap collage. The collage is stored as a list of references to photos and not as one image, so deleting an account removes them too.
- Sharing a story doesn't include photos of other members (section 7).
- No location, no contacts, no ad tracking.
- Privacy policy and terms of use available in the app and at a public link.

**Mandatory store requirements:**

- **Account deletion inside the app**, including all photos and data, also photos in weekly recaps.
- **Sign in with Apple** next to Google, to meet Apple's requirement for a privacy-preserving sign-in option.
- **Filtering:** captions are filtered for offensive words before they are posted.
- **Reporting content:** every photo has a Report option. Every report sends an email to the developer and is handled within 24 hours: hiding the item, and if needed removing the user.
- **Blocking:** a user can block another user. The blocked user's photos and reactions are hidden for them, and the blocked user can't nudge them; if they are in the same pack, leaving is offered too. In addition, anyone can leave a pack at any moment, and an admin can remove a member.
- **Terms of use** that forbid offensive content, and a way to get in touch (an email address).
- **Minimum age 13**, with a declaration at sign-up.

**Emotional safety:** the punishment is always gentle. The creature doesn't die, the texts are funny and not blaming, and there are pauses, jokers and automatic sleep so nobody feels they "ruin it" for everyone because of an illness or a life event. How much transparency to show (who missed, by name) is an open decision (section 17).

## 12. Language and localization

The interface is in English by default, with translation infrastructure from day one, so adding Hebrew later is only translation work.

- All texts in translation files (i18n), no hard-coded text in the code. Language detection with `expo-localization`.
- Components are built to support right-to-left (RTL) layout, even if Hebrew is only added later.
- The creatures' lines are written separately for each language, not translated word for word, to keep the humor and personality.
- Dates and times are shown in the user's time zone and format.

## 13. Data model

Sixteen tables in Postgres (Supabase). All access is protected with Row Level Security: a user sees only data of packs they are a member of, in any status except left (so also while paused or asleep).

| Table | Main fields |
| --- | --- |
| users | id, display\_name, avatar\_url, timezone, locale, reminder\_time, notification\_prefs (jsonb), terms\_accepted\_at, created\_at |
| packs | id, name, category, custom\_habit, rest\_days\_per\_week, week\_start, timezone, invite\_code, created\_at |
| critters | id, pack\_id, species, name, color, health, xp, stage, status (egg / active / ran\_away), streak, marks (jsonb), hatched\_at |
| pack\_members | pack\_id, user\_id, role (admin / member), status (active / sleeping / left), joined\_at |
| pauses | id, pack\_id, user\_id, starts\_on, ends\_on |
| feeds | id, pack\_id, user\_id, photo\_path, caption, day (date), is\_extra, captured\_at, created\_at, hidden\_at |
| reactions | feed\_id, user\_id, emoji, created\_at (unique key: feed\_id + user\_id) |
| day\_passes | pack\_id, user\_id, day (date), kind (joker / rest) |
| day\_results | pack\_id, day, result (success / neutral / fail), fed\_ids, rested\_ids, joker\_ids, paused\_ids, sleeping\_ids, missed\_ids, health\_before, health\_after |
| nudges | pack\_id, from\_user, to\_user, day |
| name\_suggestions | id, pack\_id, user\_id, name, created\_at |
| weekly\_recaps | pack\_id, week\_start, stats (jsonb), feed\_ids, created\_at |
| reports | id, feed\_id, reporter\_id, reason, created\_at, handled\_at |
| blocks | blocker\_id, blocked\_id, created\_at |
| notifications | id, user\_id, pack\_id, type, payload (jsonb), status (pending / sent / dropped), send\_after, created\_at, sent\_at |
| push\_tokens | user\_id, token, platform, updated\_at |

**Notes:**

- **One source of truth for each piece of data.** Values that can be derived are not stored separately, to avoid contradictions: rest days used (from day\_results and day\_passes), an active pause (from pauses), whether a member has started (from feeds), who the admin is (from pack\_members.role only), and the days toward coming back from running away (from the streak).
- The deliberate exception: `stage` is stored and not derived from XP, so recalibrating the thresholds doesn't move creatures down a stage. `health`, `streak` and `status` are stored too, and are updated only at the day close.
- day\_results is both history (for the monthly board) and protection against a double close: a unique key on pack\_id + day.
- **Rules enforced in the database, not only in code**, so two parallel requests can't get around them (race condition): one counted feed per day (a partial unique index on pack\_id + user\_id + day where is\_extra = false), one day of joker or declared rest per member per day, one joker per member per month, one nudge per day per pair, one admin per pack, and a maximum of 8 members (locking the pack row while joining).
- Every change to health, XP and the creature's state is made only on the server, in one transaction that also includes the day\_results row and the notifications it creates. The app never writes them directly. Important: supabase-js doesn't support a transaction across several operations (each call is a separate transaction), so this needs a Postgres function or a direct connection to Postgres (open decision, section 17).

## 14. Technology and architecture

Expo on the app side and Supabase on the server side, with all the game logic on the server so it's impossible to cheat from the device. No Mac needed: building and submitting are done on EAS.

**App:**

| Area | Tool |
| --- | --- |
| Base | Expo (latest SDK), TypeScript, Expo Router |
| Camera and photos | expo-camera, expo-image-manipulator (compression), expo-image (display and cache) |
| Notifications | expo-notifications + Expo Push Service |
| Animations | react-native-reanimated, Rive (@rive-app/react-native) |
| Data | @supabase/supabase-js, TanStack Query, Supabase Realtime |
| Invite links | expo-clipboard (pasting a code), expo-application (Install Referrer on Android) |
| Language | expo-localization + an i18n library |
| Haptics | expo-haptics |
| Share image | react-native-view-shot |
| Monitoring | Sentry (crashes), PostHog (analytics) |

Important: Rive and some of the modules require a **development build**, not Expo Go. You build it once on EAS and install it on the device.

**Server (Supabase):**

- **Auth:** Sign in with Apple and Google.
- **Postgres + RLS:** all the tables from section 13, including the constraints that prevent race conditions.
- **Storage:** a private bucket for photos, signed links.
- **Realtime:** updating the circles and the feed on the pack screen in real time, subject to RLS.
- **Cron:** scheduled runs of day closing, recaps and notification sending.
- **Server-side logic** (Edge Functions or Postgres functions, depending on the decision in section 17):
  - `submit-feed`: verifies pack membership, computes "the day" by the pack's time zone (including the offline rule), saves the feed (the database constraint prevents duplicates), wakes a sleeping member, and cancels a joker or declared rest for the same day.
  - `join-pack`: joining with an invite code, with locking and a check for a free spot.
  - `leave-pack`: leaving, including passing admin to the longest-standing member.
  - `nudge`, `day-pass` (joker or declaring a rest), `pause`: each with its own checks and limits.
  - `close-days`: runs every 15 minutes. **State-based, not time-based:** for every pack it closes, in order, every day that has ended (including the grace window) and has no day\_results row yet, and moves members to sleep by the rule in section 5. Idempotent. It takes "now" as a parameter, so it can be tested without waiting for midnight.
  - `weekly-recap`: creates the recap data at the end of each pack's week and saves it in weekly\_recaps.
  - `send-push`: sends the pending notifications from the notifications table through Expo Push, with the merging, limits and quiet hours from section 8. Every action that creates a notification only writes a row to the table, in the same transaction as the action itself (Outbox pattern), so there are no duplicate notifications and no lost ones.
  - `delete-account`: deletes the user, the photos and all the data. It needs service role permissions, so it must run on the server.
  - `on-report`: sends an email to the developer for every new report.

**Invite links:** a simple landing page at an address like `pack.app/i/CODE`, which opens the app if it's installed (universal link on iOS, App Link on Android). If not, the page shows the code, copies it to the clipboard when the download button is tapped (Safari allows copying to the clipboard only in response to a tap), and sends to the store. On Android the code is also passed in the referrer parameter of the Google Play link, and the app reads it after installing (`getInstallReferrerAsync` from expo-application), so joining is automatic. On iOS there is no free equivalent: on the first open, "Have an invite code?" appears with a paste button (iOS shows a confirmation dialog for pasting from another app) or manual typing. That way a paid deferred deep link service isn't needed.

**Build and distribution:** EAS Build for iPhone and Android, EAS Submit to TestFlight and the stores, EAS Update for fast JavaScript updates without a new review. On Google Play, a new personal developer account must run a closed test with at least 12 testers for 14 days in a row before publishing, and the pilot can meet that requirement (if Android is in the pilot, section 17).

## 15. Scope and build phases

Version 1 includes all of sections 3–12 of this document, with a temporary character (narrowing the scope for the pilot is an open decision, section 17); the build is split into nine phases, and each phase ends with something that can be tested on a device.

| Phase | What gets built | Done when... |
| --- | --- | --- |
| 0. Infrastructure | Expo project, Supabase, sign-in, development build | You can sign in from the device and see an empty home screen |
| 1. Packs | Creation, invite link, joining, pack settings | Two devices in the same pack |
| 2. Temporary critter | One character component that receives state (health, stage, mood) | The creature changes when values change in the database |
| 3. Feeding | Camera, compression, upload, submit-feed, eating animation, real-time update | A feed shows up for the other member |
| 4. Game engine | The rules as a function, simulator, close-days, rest days, joker, pause, sleep, running away and coming back | Unit tests pass for all the rules in section 5, and the numbers were calibrated in the simulator |
| 5. Social | Feed, reactions, nudge, monthly board, name suggestions | Full use in a real pack for a whole day |
| 6. Notifications | notifications table, send-push, all notification types and the rate limits | The evening reminder and "Last one" arrive |
| 7. Recap and sharing | weekly-recap, story image | A recap can be shared to Instagram |
| 8. Store readiness | Account deletion, filtering, reporting with an alert to the developer, blocking, privacy policy, icon, screenshots | A two-week pilot with real packs |

**Success metric before launch:** at least two thirds of the test packs still active (by the definition in section 1) after 14 days.

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

**To close before building:**

- [ ] **Success model.** Today a day is successful only when no member missed ("all or nothing"). The options:
  - (a) Keep it: the most shared responsibility, but it punishes large packs (section 5).
  - (b) In packs of 5 or more members, a day is still successful when one member missed. The miss still costs health, and in packs of 2–4 nothing changes.
  - (c) Partial XP by the share of members who fed.
  - Proposed criterion: a good pack (every member covered on about 90% of days) gains health and reaches Kid before day 14 at any size, and a weak pack (about 75%) declines. In a quick calculation, (b) meets the criterion at every size (Kid after 8–11 days), and (a) fails in packs of 7–8, where health drops even when every member is covered on 90% of days. (In a pack of 2, even a weak pack gains health under both models.) Recommendation: (b), and confirm it in the simulator.
- [ ] **Version 1 scope.** Full, as in section 15, or narrowed for the pilot. Recommendation: narrowed. Postpone until after the pilot: two of the three creature species, category items and holiday hats, name suggestions (the admin picks), changing the week start, and story sharing. These mostly save illustration and animation work, and don't change what the pilot tests.
- [ ] **Where the game engine runs.** supabase-js doesn't support transactions, so one of these is needed:
  - (a) A Postgres function (PL/pgSQL) run from cron: atomic and close to the data, but harder to test, and the simulator can't use it directly.
  - (b) An Edge Function in TypeScript with a direct connection to Postgres: the rules are in TypeScript and easy to test, but connections must be managed and runtime limits watched.
  - (c) Combined: the rules as a pure TypeScript function, shared by the server and the simulator, and one Postgres function that applies the result in a transaction.
  - Recommendation: (c).
- [ ] **Pilot makeup.** Whether Android is in the pilot, and how many packs. Recommendation: yes to Android, because almost every friend group has Android users. It needs an Android device or emulator, a Google Play account ($25), and a closed test of 12 testers for 14 days, which the pilot covers anyway. And 5–6 packs instead of 3, at least half of them not close friends of the developer.
- [ ] **End-of-day hour.** Midnight, as today, or 03:00. With a later hour, people who work out or study at night don't miss, but after midnight "today" in the app doesn't match the calendar date. Recommendation: 03:00, with a clear countdown on the pack screen.
- [ ] **Launch language.** Recommendation: an English pilot, and a public launch in English and Hebrew. The creatures' humor needs rewriting in Hebrew, not translating.
- [ ] **How much transparency.** The members row and the monthly board show by name who missed, there is 🤨 and there is "the most consistent member"; notifications don't say who missed. Where is the line between accountability and shame, when the audience starts at 15? Recommendation: keep names in the row and the board, because that is the accountability itself, and show 🤨 as a number without names.

**Can be closed later:**

- [ ] Final name for the app, and a check that the name and domain are free in the stores.
- [ ] Design direction for the characters: illustrated pastel, clay or sticker.
- [ ] Who illustrates the characters, and who animates them in Rive.
- [ ] Whether 3 free packs is right, or a different limit is better. Note: few users will reach a fourth pack, so it is a weak lever for payment; "a gift for the pack" looks stronger.

## 18. Changes from version 1

- **Neutral day:** a day with no feeds no longer counts as a successful day. Before, a pack that was fully paused earned XP and health.
- **A member counts only from their first feed**, so someone who joined and never started doesn't hurt the pack.
- **Automatic sleep** (3 misses within 7 days) instead of "5 misses in a row". The old rule never fired in packs with 3 rest days, and depended on the admin removing a member.
- **Pause:** 3–60 days, with a 30-day gap between pauses, instead of up to 14 days, which didn't fit reserve duty.
- **Grace window:** the day close waits an hour, so an offline feed doesn't arrive after the day already closed. The phone-clock exception is defined explicitly.
- **Egg and hatching:** the egg cracks when the second member joins and hatches on the first successful day with two feeders, in line with the stages table.
- **Running away:** no XP is added while away, and coming back is measured by the streak (no recovery\_days field).
- **Rest days:** you can declare "Resting today" in advance. Version 1 showed a dashed circle for rest, but the rest was only decided at the day close.
- **Joker and declared rest:** feeding on the same day cancels them and returns them to the member.
- **Joining:** automatic joining on Android through Install Referrer; on iOS a code screen with pasting, as a stated trade-off.
- **3 taps:** a direct Feed button on the pack card on the home screen.
- **Privacy:** the story doesn't include photos of other members; collages are stored as references and deleted with the account.
- **Notifications:** a daily limit per user and not per pack; no exceptions to quiet hours; a new "Still in?" notification; an evening reminder for members in another time zone; no reminders for someone who isn't counted today.
- **Screens:** Join pack and Weekly recap added; choosing a color when creating a pack; week start in settings with a transition rule; age declaration and terms in Profile setup; blocking and reporting.
- **Stores:** caption filtering, an email to the developer for every report and handling within 24 hours, blocking users, and an account deletion function on the server.
- **Data model:** 16 tables (pauses, name\_suggestions, weekly\_recaps, blocks and notifications added; jokers became day\_passes); packs.admin\_id removed, as it duplicated role; database constraints against race conditions; RLS includes paused and sleeping members.
- **Architecture:** close-days is state-based and fills in missing days; notifications through an Outbox; "now" as a parameter for tests; Realtime for the pack screen; a note about transactions in supabase-js.
- **Metrics:** a definition of an "active pack", and a virality metric based on invited users opening their own packs.
- **Process:** a simulator before the pilot, instead of calibrating only from TestFlight; the "roughly after" column in the growth table is marked as assuming 100% success.
- **Positioning:** "fed only by the real world" moved to the top of the list of differences, with a note about competitors.
