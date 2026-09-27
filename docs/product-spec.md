# Gozali — Product Spec (version 3.1)

Sep 26, 2026 · @Ariel kuznets

> Version 3.1: the app has a name, Gozali. Version 3 closed all the open decisions from version 2 (details and reasoning in [decisions.md](decisions.md)), expanded version 1 and added widgets for the home screen and the lock screen. The list of changes is in section 18.

## 1. Overview

Gozali ("my little chick" in Hebrew) is an app where a small group of friends raises one shared virtual creature that lives and grows only if every one of them does a real habit every day and proves it with a photo. The name tells the story: a creature that hatches from an egg, and the pack raises it together. Inside the app, a group is called a Pack.

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
| Day | From 03:00 to 03:00 in the pack's time zone. A day is named by the date it started, so a feed at 01:30 at night counts for the previous day |
| Counted member | A member who has already fed at least once, and is not paused or asleep. Only counted members affect the creature |
| Allowed misses | 0 in a pack of 2–4 counted members, and 1 in a pack of 5–8 |
| Successful day | A day on which at least one member fed, and the number of misses didn't go over the allowed number |
| Neutral day | A day with no feeds, on which the number of misses didn't go over the allowed number (for example when everyone rests or is paused) |
| Failed day | A day on which the number of misses went over the allowed number |
| Rest day | A day on which a member doesn't have to feed; a weekly quota set by the pack |
| Joker | A one-time day off, one per member per month |
| Pause | A planned absence (vacation, reserve duty) the member turns on; while paused they are not counted |
| Sleep | An automatic state for a member who stopped feeding; they are not counted until their next feed |
| Pack streak | The number of successful days in a row; a neutral day neither adds to it nor breaks it |
| Running away | The state the creature enters when its health reaches 0 |
| Grace window | One hour after the day ends (until 04:00), during which feeds captured offline are still accepted |
| Day close | A server process that computes the result of each day, after the day ends and after the grace window |
| Achievement | A pack goal (for example a 14-day streak) that unlocks an item for the wardrobe |
| Wardrobe | The items the pack unlocked, which can be put on the creature |
| Widget | A view of the creature and the day's status on the home screen or the lock screen |

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
- **QR code:** the invite link is also available as a QR code in the pack settings, for inviting face to face.
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

In practice not every day is successful. When every member is covered on about 90% of days, about 73% of days are successful in a pack of 3 (Kid after about 10 days), and about 92% in a pack of 5 thanks to the allowed miss (Kid after about 8 days). The thresholds are calibrated in the simulator (section 5).

Every stage change gets an animation and a celebratory notification to the whole pack.

**Fitting the category:** from the Kid stage, the creature gets an item that fits the habit: a small dumbbell for Gym, glasses for Reading, headphones for Study, running shoes for Running, a bottle for Water.

**Pack memory:** events leave a permanent mark on the creature: a medal after 30 successful days in a row, a small bandage after it came back from running away, a holiday hat on holidays.

**Achievements and wardrobe:** achievements are pack goals. Every achievement shows on the critter profile and unlocks one item for the pack's wardrobe. Any member can dress the creature from the wardrobe, one item per slot (head, neck, background), and the change shows in the feed ("Noa put a scarf on Pixel"). The category item and the permanent marks don't take a slot; on holidays the holiday hat temporarily replaces the head item.

| Achievement | Condition | Item |
| --- | --- | --- |
| Hello world | Hatching | Scarf (neck) |
| One week strong | A 7-day streak | Beanie (head) |
| Two weeks strong | A 14-day streak | Flower crown (head) |
| Unbreakable | A 30-day streak | Cape (neck) |
| Full house | A day on which every counted member fed, in a pack of at least 4 | Bow tie (neck) |
| Early birds | 5 successful days on which everyone who fed did it before 12:00 (at least 2 feeders) | Sun hat (head) |
| Night owls | 5 feeds between 23:00 and 03:00 | Headlamp (head) |
| Comeback | Coming back from running away | Sunrise background |
| Century | 100 counted feeds in the pack | Park background |
| Full pack | 8 members in the pack | Party background |
| Grown up | The Adult stage | Space background |
| Legend | The Legend stage | Halo (head) |

**Live behaviors (no effect on health):**

- Blinking, yawning and breathing when idle.
- Follows your finger with its eyes when you touch the screen.
- Petting: reacts with an animation and a line.
- Sleeps at night (22:00–07:00 by the device clock) with a nightcap.
- Reacts to being fed: an eating animation with the photo that was taken.

## 5. Game rules

Every day ends at 03:00 in the pack's time zone and closes after a one-hour grace window, and the result is set by the number of members who missed. All the numbers here are initial, and are calibrated first in the simulator and then in user testing; they are defined as constants in the game-engine module and are not scattered through the code.

**Day close, for every member of the pack:**

1. Left, never fed, paused or asleep: not counted at all.
2. Fed today: counts.
3. Activated a joker or declared a rest for today: counts.
4. Didn't feed and has rest days left this week: a rest day is used automatically, counts.
5. Otherwise: a miss.

**Day result:**

| Day type | Condition | Health | XP | Streak |
| --- | --- | --- | --- | --- |
| Successful | At least one feed, and the misses didn't go over the allowed number | +10, and -8 per member who missed | +1 | +1 |
| Neutral | No feeds, and the misses didn't go over the allowed number | -8 per member who missed | No change | No change |
| Failed | The misses went over the allowed number | -8 per member who missed | No change | Resets to 0 |

**Allowed misses:** 0 in a pack of 2–4 counted members, and 1 in a pack of 5–8. Every miss always costs 8 health, even on a successful day.

The change in health is computed as one sum and then clamped to the range 0–100. For example, a successful day with one miss when health is 100: +10 -8 = +2, and health stays 100.

Examples: in a pack of 6 where one missed, the day is successful, health goes up by 2 and the streak continues. In a pack of 5 where two missed, the day fails, health drops by 16 and the streak resets. In a pack of 4 where one missed, the day fails and health drops by 8.

**Pack size and difficulty.** Without the allowed miss, large packs would be punished: a successful day would need everyone, and in a pack of 8 every member would have to be covered on 92% of days just so health doesn't drop. With the allowed miss, a pack where every member is covered on about 90% of days gains health at any size and reaches Kid after 8–11 days, and a pack where every member is covered on about 75% of days loses health at any size from 3 up. The numbers are checked in the simulator.

**Running away and coming back:**

- Health 0: the creature enters the Ran away state and disappears from the screen, and the streak resets.
- Feeding continues as usual. While it's away, health stays at 0 and no XP is added. When the pack streak reaches 3, meaning three successful days in a row after running away, the creature comes back with 40 health and a permanent bandage.
- XP and the growth stage are **not erased** by running away, so months of work are not lost.

**Rest days:**

- You can declare "Resting today" in advance, if there are rest days left this week. The member's circle is shown dashed, and they don't get nudges or reminders that day.
- Someone who didn't declare and didn't feed, and has rest days left this week, gets a rest day automatically at the day close.
- If the member feeds after declaring a rest, the rest day is canceled and returns to the quota.

**Joker:**

- One per member per calendar month. Doesn't accumulate.
- Activated manually, only for the current day and before the day ends (03:00, not in the grace window). It cannot be activated retroactively.
- If the member feeds on the same day after activating a joker, the joker is canceled and returned to them.
- Members see that a joker was activated ("Noa is taking a joker today").

**Pause:**

- For a planned absence: a vacation, a flight or reserve duty. The pause starts on the day after it is turned on (for an absence today there's the joker).
- Length: 3 to 60 days. It can end early, but not before 3 days have passed.
- A new pause is possible only 30 days after the previous one ended.
- During a pause the member is not counted, and the creature is not hurt by them.
- The limit is on minimum length and on frequency, not on a short maximum length: the abuse to prevent is short, frequent pauses instead of a lazy day, not long absences like reserve duty.

**Sleep (inactive member):**

- A member with 3 misses within 7 days goes to sleep automatically: they are not counted, the creature is not hurt by them, and their circle is shown with 💤. The count starts over every time the member wakes up.
- They get a gentle message ("Still in? Your pack misses you") with an option to pause or leave.
- Their next feed wakes them immediately, and they count on that same day.
- That way one member who disappeared doesn't kill the creature for everyone, and nobody has to "kick out" a friend. The admin can still remove members at any moment.
- The rule counts misses within a window and not misses in a row, because rest days are used automatically: with 3 rest days a week, a member who disappeared collects at most 4 misses in a row, so a "5 in a row" rule would never have fired.

**Edge cases:**

- A new member counts from the day of their first feed.
- A feed counts by the server time relative to the pack's time zone, not by the phone clock. The only exception is an offline feed (section 6).
- A feed between 00:00 and 03:00 counts for the previous day, and the pack screen shows a countdown to the end of the day.
- The day close must be idempotent: running the same day twice doesn't change the result.
- Days close in order, because each day depends on the result of the previous one. If a close failed or was late, the next run fills in all the missing days.
- The end of the day is computed by the pack's time zone (IANA), so on a daylight saving change the day lasts 23 or 25 hours.

**The rules module and the simulator:** the rules are implemented as a pure TypeScript module with no dependencies (`packages/game-engine`): the previous state and the day's data go in, a result comes out. The same module is used by the server day close, the tests and the simulator, which runs the rules over simulated packs of different sizes, categories and reliability levels, and measures the rate of successful days, average health, the chance of running away and the time to each stage. The latest results are in [simulation.md](simulation.md).

## 6. Feeding and proof

A user feeds the creature with a photo taken inside the app right now; this is the only action that affects health.

**The flow:**

1. Tap Feed: on the pack card on the home screen, on the pack screen, or on the widget.
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

**Focus timer (Study and Reading):**

- In Study and Reading packs, next to the Feed button there is also Focus: a timer of 15, 25, 45 or 60 minutes, or an open timer.
- When the time is up a local notification is sent and the camera opens, and the feed shows the length of the session ("📖 45 min").
- The timer is optional, and a photo is still required as proof. It keeps running while the app is in the background.

**No automatic photo check in version 1.** The protection against cheating is: live photos only, a timestamp, and exposure to the members in the feed. In a future version: on-device image classification (Vision on iOS, ML Kit on Android) that asks to retake the photo if it doesn't fit the category, without involving the members.

## 7. Social

The social part creates the positive pressure and the reason to open the app even after you fed.

**Pack feed:** all feeds and extra posts, newest first. Each item shows a photo, caption, name, time and reactions. System events are mixed into the feed: "Pixel evolved to Teen", "Noa is taking a joker", "Pixel ran away", achievements ("Pixel unlocked Two weeks strong"), wardrobe changes ("Noa put a scarf on Pixel"), and a "Name me!" card after hatching. After 30 days the photo is deleted (section 11), and the item stays without a photo.

**Reactions:** a fixed set of 5 emoji: 🔥 💪 😂 👏 🤨. One reaction per user per item, and it can be changed. 🤨 (for a suspicious photo) has **no effect at all on the creature**; it's only social pressure, and it is shown as a number without names, including to the person who posted. For the other reactions you can see who reacted.

**Nudge:** next to a member who hasn't fed yet, including a member who hasn't started or is asleep, there is a button that sends them a notification: "{petName} is looking at you 👀". Limit: one nudge per day from each member to each member. You can't nudge a paused member, or a member who activated a joker or declared a rest today.

**Weekly recap:** created at the end of every week (by the pack's week start) and saved.

- How many successful days out of the days of the week, and the change in health.
- The most consistent member this week (on a tie, everyone at the top).
- A collage of up to 9 photos from the week.
- The creature in its current state, and achievements unlocked this week.
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
| Evolution | The creature hatched, moved up a stage or unlocked an achievement | On |
| Still in? | The user went to sleep | On |
| Timer done | The focus timer ended (a local notification) | On |
| Weekly recap | The weekly recap is ready | On |

**Rules:**

- No more than 6 notifications per day per user **in total, across all packs together**. When the limit is reached, only Evening reminder and Last one are sent.
- Friend fed doesn't count toward the limit, because it is merged: notifications waiting for the same user about the same pack are sent together ("3 friends fed Pixel"), after waiting up to 10 minutes. Timer done doesn't count either, because the user started it.
- Reminders, Last one and nudges are not sent to someone who isn't counted today (paused, asleep) or who activated a joker or declared a rest.
- No notifications between 23:00 and 07:00 in the user's time, with no exceptions. A notification created in those hours that is still relevant in the morning (Weekly recap, Evolution, Pet state, Still in?) is sent at 07:00; the rest are dropped.
- The texts are written in the creature's voice, according to its personality.

## 9. Screens, widgets and flows

Fourteen screens in version 1, plus widgets for the home screen and the lock screen; the main screen is the pack screen, where the user spends most of the time.

| Screen | What's on it |
| --- | --- |
| Welcome | Creature animation, Sign in with Apple and Google buttons |
| Onboarding | Three cards where the creature explains the rules: feed with a photo, responsible together, and the creature never dies. Can be skipped |
| Profile setup | Display name, profile photo (optional), age 13+ declaration and accepting the terms, notification permission request with an explanation |
| Home | The list of packs: for each pack the creature in its state, a health bar, how many members fed today (3/5) **and a direct Feed button**. A create pack button and join with a code |
| Join pack | The pack name, the habit, the creature and the members, and a join button. On the first open after installing on iOS: "Have an invite code?" with paste or typing |
| Pack | The animated creature in the center, health bar, streak, a countdown to the end of the day, a row of member circles (colored = fed, dashed = rest or joker, 💤 = asleep or paused, gray = not yet, including someone who hasn't started), a big Feed button with "Not today" next to it (rest or joker) and in Study and Reading packs also Focus, and the feed below |
| Camera | Capture, switch camera, retake, caption, send |
| Focus | The running timer, the creature "studying" or "reading" next to it, pause and cancel |
| Create pack | Four steps: name, category, rest days, egg and color, then the link sharing screen |
| Critter profile | Stage and progress to the next XP, monthly board, medals and marks, achievements, and a wardrobe for dressing the creature |
| Weekly recap | The weekly recap and the button to share it as a story |
| Pack settings | Name, rest days, week start, members (removal for the admin), invite link and QR code, pause, joker, leave |
| Me | Personal stats: total feeds, current and best personal streak (days in a row without a miss in any pack), and a personal monthly board across all packs |
| Settings | Reminder time, notifications by type, language, privacy, blocked users, how to add widgets, delete account |

Reporting and blocking are in the menu of every feed item and of every member.

**Widgets:**

| Widget | Platform | What it shows | Tap |
| --- | --- | --- | --- |
| Pack, small | iOS and Android | The creature in its state, a health bar, "3/5", and a mark if the user already fed | Opens the pack's camera, or the pack screen if the user already fed |
| Pack, medium | iOS and Android | Also: the members' circles without names, the streak, and the time left until the day ends | Like the small one, and a Feed button opens the camera |
| All packs, large | iOS and Android | Up to 3 packs: for each the creature, health and "3/5" | Opens the pack that was tapped |
| Lock screen | iOS | A health ring and "3/5"; the rectangular version also shows the creature's name | Opens the pack screen |

- For single-pack widgets you choose which pack to show, in the widget settings.
- The creature in the widget is a static image by species, stage, state and color (no animation), including wardrobe items, and it sleeps at night like in the app.
- **Privacy:** the widget shows no photos and no names of members, only the creature and numbers, because the home screen and the lock screen are visible to others.
- **Updates:** right after every action in the app, at the end of the day (03:00), and from the server about every 30 minutes, subject to the operating system's refresh limits.

**Main flows:**

1. **A new user who creates a pack:** Welcome, Onboarding, sign-in, Profile setup, Create pack, sharing the link on WhatsApp, the Pack screen with an egg waiting for the second member.
2. **A new invited user:** tap the link, landing page (copying the code), store, install, Onboarding, sign-in, Profile setup, joining (automatic on Android, pasting the code on iOS), and the egg cracking if they are the second member.
3. **Daily use:** notification, widget or opening the app, Feed, camera, send, animation, scrolling the feed and reactions.
4. **An evening without feeding:** a reminder in the creature's voice, opening straight to the relevant pack's camera.
5. **Studying with the timer:** Pack, Focus, choosing a length, a notification at the end, camera, sending with the session length.

**Rule of thumb:** from opening the app to a sent feed, no more than 3 taps and 10 seconds: Feed on the pack card, capture, send. From the widget, one tap opens the camera.

## 10. Design direction

The design should feel colorful, soft and hand-drawn, and in no way generic or "AI slop"; the creature is the product, so it gets most of the attention.

**Principles:**

- **Limited palette:** 5–6 warm pastel shades and one accent. A cream background (about #FBF6EE), not white. No neon, no purple-blue gradients.
- **Soft shapes:** rounded corners, few and subtle shadows, a subtle paper texture or grain in backgrounds.
- **Typography:** a rounded font with character for headings, and a clean readable font for text. Two fonts at most.
- **Motion:** every action gets small satisfying feedback (a bounce, a light vibration). Animations are short (200–400ms) and fun.
- **Accessibility:** support for dynamic text size, a screen reader description for every state of the creature (for example "Pixel is hungry, health 45"), and information that isn't carried by color alone: the circles in the members row are also marked with an icon.

**The character:**

- **A simple silhouette** that is recognizable even at 40px.
- **Big expressive eyes**, which carry most of the emotion.
- **A small characteristic flaw** for each species, like a droopy ear or a buck tooth.
- **Alive and breathing:** idle animations (blinking, breathing), reaction to touch, and changes by time of day.
- **A color the pack chooses** from 6 shades that fit the palette, picked when the pack is created.
- **Wardrobe items** as separate layers (head, neck, background), so every item fits every species and stage.

**Process:**

1. Mood board, then sketches of 2–3 directions. Choosing one.
2. Final design of the characters by a human illustrator, to keep consistency across all states and stages. Image generators are used only for exploration.
3. Animation in Rive, with one state machine per creature species. Inputs: health, stage, mood, isSleeping, wardrobe items (head, neck, background), and triggers for feed, pet, crack (the egg cracking) and hatch.
4. Static images for widgets: for every species, stage and state an image is exported, and the color and wardrobe items are layered on top of it.

**In version 1, until the final design is ready:** use a simple temporary character (a basic shape with eyes) so development isn't held up, and replace it later, both in the app and in the widgets. The code should treat the character as one component that receives state, so the replacement is a single change. The temporary character is drawn in code as SVG (`packages/critter-art`): a pure function from state (species, color, stage, health state, mood, night, wardrobe, marks and the habit item) to SVG markup, so the same drawing serves the app and the widget images.

## 11. Privacy, safety and store policy

The app includes content that users upload (photos), so it must meet Apple's and Google's user-generated content requirements already in version 1, or it will be rejected in review. Apple's user-generated content guideline (1.2) requires four things: filtering, reporting with a quick response, blocking users and contact details.

**Privacy:**

- Photos are visible only to pack members. Storage in a private bucket, access only through short-lived signed links. In the app, the photo cache is keyed by the photo id, because the signed link changes every time.
- Photos are deleted automatically after 30 days, except photos that went into a weekly recap collage. The collage is stored as a list of references to photos and not as one image, so deleting an account removes them too.
- Sharing a story doesn't include photos of other members (section 7).
- The widgets don't show photos or names of members (section 9).
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

**Emotional safety:** the punishment is always gentle. The creature doesn't die, the texts are funny and not blaming, and there are pauses, jokers and automatic sleep so nobody feels they "ruin it" for everyone because of an illness or a life event. The names of those who missed appear only in the members row and on the monthly board, because that is the shared accountability itself; notifications don't say who missed, and 🤨 is shown as a number without names.

## 12. Language and localization

The pilot is in English, and the public launch is in English and Hebrew. The translation and RTL infrastructure exists from day one, so adding Hebrew is only translation and writing work.

- All texts in translation files (i18n), no hard-coded text in the code. Language detection with `expo-localization`, and the language can be changed in settings.
- Components are built to support right-to-left (RTL) layout, including the widgets.
- The creatures' lines are written separately for each language, not translated word for word, to keep the humor and personality.
- Dates and times are shown in the user's time zone and format.

## 13. Data model

Nineteen tables in Postgres (Supabase). All access is protected with Row Level Security: a user sees only data of packs they are a member of, in any status except left (so also while paused or asleep).

| Table | Main fields |
| --- | --- |
| profiles | id (the user in auth.users), display\_name, avatar\_path, timezone, locale, reminder\_time, notification\_prefs (jsonb), terms\_accepted\_at, created\_at |
| packs | id, name, category, custom\_habit, rest\_days\_per\_week, week\_start, timezone, invite\_code (8 characters, without characters that are easy to confuse, like 0 and O), pending\_rest\_days\_per\_week, pending\_week\_start, pending\_from (settings that apply from the next week start), created\_at |
| critters | pack\_id (key: one creature per pack), species, name, color, health, xp, stage, status (egg / active / ran\_away), streak, marks, outfit (jsonb), hatched\_at |
| pack\_members | pack\_id, user\_id, role (admin / member), status (active / sleeping / left), joined\_at, left\_at, awake\_since (the day that misses toward sleep count from; set when the member wakes up) |
| pauses | id, pack\_id, user\_id, starts\_on, ends\_on |
| feeds | id, pack\_id, user\_id, photo\_path, caption, day (date), is\_extra, focus\_minutes, captured\_at, created\_at, hidden\_at |
| reactions | feed\_id, user\_id, emoji (fire / muscle / laugh / clap / suspicious), created\_at (unique key: feed\_id + user\_id) |
| day\_passes | pack\_id, user\_id, day (date), kind (joker / rest) |
| day\_results | pack\_id, day, result (success / neutral / fail), applied, fed\_ids, rested\_ids, joker\_ids, paused\_ids, sleeping\_ids, missed\_ids, health\_before, health\_after, early\_bird, full\_house, night\_owl\_feeds, closed\_at |
| achievements | pack\_id, key, unlocked\_at |
| nudges | pack\_id, from\_user, to\_user, day |
| name\_suggestions | id, pack\_id, user\_id, name, created\_at |
| weekly\_recaps | pack\_id, week\_start, stats (jsonb), feed\_ids, created\_at |
| reports | id, feed\_id, reporter\_id, reason, created\_at, handled\_at |
| blocks | blocker\_id, blocked\_id, created\_at |
| pack\_events | id, pack\_id, kind (joined / hatched / evolved / ran\_away / returned / achievement / joker / dressed / named), actor\_id, payload (jsonb), created\_at. The system lines in the feed, written by triggers (decision D14) |
| notifications | id, user\_id, pack\_id, type, payload (jsonb), status (pending / sent / dropped), send\_after, created\_at, sent\_at |
| push\_tokens | user\_id, token, platform, updated\_at |
| widget\_tokens | id, user\_id, token\_hash, created\_at, last\_used\_at |

**Notes:**

- **One source of truth for each piece of data.** Values that can be derived are not stored separately, to avoid contradictions: rest days used (from day\_results and day\_passes), an active pause (from pauses), whether a member has started (from feeds), who the admin is (from pack\_members.role only), the days toward coming back from running away (from the streak), and the achievement counters (from feeds and day\_results).
- The deliberate exception: `stage` is stored and not derived from XP, so recalibrating the thresholds doesn't move creatures down a stage. `health`, `streak` and `status` are stored too, and are updated only at the day close.
- day\_results is both history (for the monthly board) and protection against a double close: a unique key on pack\_id + day.
- **Rules enforced in the database, not only in code**, so two parallel requests can't get around them (race condition): one counted feed per day (a partial unique index on pack\_id + user\_id + day where is\_extra = false), one day of joker or declared rest per member per day, one joker per member per month, one nudge per day per pair, one admin per pack, and a maximum of 8 members (locking the pack row while joining).
- Every change to health, XP and the creature's state is made only on the server, in one transaction that also includes the day\_results row, the achievements and the notifications it creates. The app never writes them directly. supabase-js doesn't support a transaction across several operations (each call is a separate transaction), so every user action is a Postgres function, and the day close is applied through one Postgres function (section 14).
- The widget token only allows reading the packs' state for the widget, is stored on the server only as a hash, and is deleted on sign-out or account deletion.
- **Privacy in RLS:** who reacted with 🤨 isn't exposed through the API either: the policy hides those rows, and `feed_reaction_counts` returns only numbers. Hidden items and content from blocked users never reach the app.
- The schema lives in `supabase/migrations`, and its tests (pgTAP) in `supabase/tests`.

## 14. Technology and architecture

Expo on the app side and Supabase on the server side, with all the game logic on the server so it's impossible to cheat from the device. No Mac needed: building and submitting are done on EAS.

**Division of responsibility:** the game rules are a pure TypeScript module (`packages/game-engine`) shared by the server, the tests and the simulator. User actions are Postgres functions called through RPC that run in one transaction. Scheduled jobs and external integrations are Edge Functions.

**App:**

| Area | Tool |
| --- | --- |
| Base | Expo (latest SDK), TypeScript, Expo Router |
| Game rules | packages/game-engine (TypeScript with no dependencies) |
| Camera and photos | expo-camera, expo-image-manipulator (compression), expo-image (display and cache) |
| Notifications | expo-notifications + Expo Push Service, including local notifications for the timer |
| Animations | react-native-reanimated, Rive (@rive-app/react-native) |
| Data | @supabase/supabase-js, TanStack Query, Supabase Realtime |
| Widgets | iOS: WidgetKit in SwiftUI as a separate target through @bacons/apple-targets, with an App Group and ExtensionStorage. Android: react-native-android-widget |
| Invite links | expo-clipboard (pasting a code), expo-application (Install Referrer on Android), react-native-qrcode-svg (QR) |
| Language | expo-localization + an i18n library |
| Haptics | expo-haptics |
| Share image | react-native-view-shot |
| Monitoring | Sentry (crashes), PostHog (analytics) |

Important: Rive, the widgets and some of the modules require a **development build**, not Expo Go. You build it on EAS and install it on the device.

**Server (Supabase):**

- **Auth:** Sign in with Apple and Google.
- **Postgres + RLS:** all the tables from section 13, including the constraints that prevent race conditions.
- **Storage:** a private bucket for photos, signed links.
- **Realtime:** updating the circles and the feed on the pack screen in real time, subject to RLS.
- **Cron:** scheduled runs of day closing, recaps and notification sending: pg\_cron calls the Edge Functions through pg\_net, with the function address and a shared secret kept in Vault (decision D13).
- **User actions (Postgres functions):**
  - `submit_feed`: verifies pack membership, computes "the day" by the pack's time zone (including the offline rule), saves the feed (the database constraint prevents duplicates), wakes a sleeping member, and cancels a joker or declared rest for the same day.
  - `create_pack`: creates the pack, its egg and the admin membership, with a random invite code; limited to 3 packs per user.
  - `pack_preview`: what someone sees before joining (name, habit, species and color, member count), by invite code.
  - `join_pack`: joining with an invite code, with locking and a check for a free spot.
  - `update_pack` (admin): the name changes right away; rest days and week start are stored as pending and apply from the next week start.
  - `remove_member` (admin).
  - `leave_pack`: leaving, including passing admin to the longest-standing member.
  - `use_day_pass` (joker or declaring a rest, today only) and `cancel_day_pass`; `start_pause` and `end_pause`; `my_day_status` (rest days left this week, the month's joker, today's pass, the current pause and when the next one is allowed).
  - `react` (one reaction per member per item, changeable) and `feed_reactions` (totals for a page of items, names for every emoji but 🤨).
  - `nudge`: one a day per pair, never to someone who fed, rests, is on a joker or a pause today, or who blocked the sender; writes a notification.
  - `suggest_name` (up to 3 per member, only while the hatched critter has no name) and `choose_name` (admin).
  - `dress_critter`: any member, one unlocked item per slot.
  - `my_stats`: the Me screen (total feeds, current and best personal streak, the last weeks).
- **Edge Functions:**
  - `close-days`: runs every 15 minutes. **State-based, not time-based:** for every pack it runs game-engine on every day that has ended (including the grace window) and has no day\_results row yet, in order, and applies each result through one Postgres function (`apply_day_result`). The function checks that the day isn't closed yet and that the previous day is, and writes in one transaction the day\_results row, the creature, the members' state, the achievements and the notifications. Idempotent, and it takes "now" as a parameter so it can be tested without waiting for the end of the day. The database gathers each day's input (`day_close_input`: members with their feed, pass, pause, rest days used and recent misses, the critter, and the pack totals for achievements), the function runs game-engine on it, and `apply_day_result` writes the outcome. The same run deletes photo files older than 30 days (`expired_photos`, then `forget_photos`).
  - `weekly-recap`: creates the recap data at the end of each pack's week and saves it in weekly\_recaps.
  - `send-push`: sends the pending notifications from the notifications table through Expo Push, with the merging, limits and quiet hours from section 8. Every action that creates a notification only writes a row to the table, in the same transaction as the action itself (Outbox pattern), so there are no duplicate notifications and no lost ones. The rules run in the database when rows are claimed (`claim_notifications`, decision D15): a type the member turned off is dropped; in quiet hours hatching, growth, pet state, "still in?" and the recap wait for 07:00 and the rest are dropped; reminders, "last one" and nudges are dropped once the member fed or stopped being counted; past 6 a day only the reminder and "last one" still go. A counted feed queues "friend fed" (merged per member and pack for 10 minutes) and "last one" through a trigger, and pg\_cron queues the evening reminders every 5 minutes (`queue_evening_reminders`). The function renders the texts in the critter's voice, sends in batches of 100, puts back the rows of a batch Expo didn't take, and forgets tokens Expo reports as unregistered.
  - `widget-state`: returns the user's packs state to the widget, identified by a widget token.
  - `delete-account`: deletes the user, the photos and all the data. It needs service role permissions, so it must run on the server.
  - `on-report`: sends an email to the developer for every new report.

**Invite links:** a simple landing page at an address like `gozali.app/i/CODE`, which opens the app if it's installed (universal link on iOS, App Link on Android). If not, the page shows the code, copies it to the clipboard when the download button is tapped (Safari allows copying to the clipboard only in response to a tap), and sends to the store. On Android the code is also passed in the referrer parameter of the Google Play link, and the app reads it after installing (`getInstallReferrerAsync` from expo-application), so joining is automatic. On iOS there is no free equivalent: on the first open, "Have an invite code?" appears with a paste button (iOS shows a confirmation dialog for pasting from another app) or manual typing. That way a paid deferred deep link service isn't needed.

**Widgets:** the app writes the packs' state to shared storage (an App Group on iOS, the app's storage on Android) and asks for a widget refresh after every action. In addition, the widget pulls a fresh state from `widget-state` about every 30 minutes, and schedules a refresh for the end of the day. The official `expo-widgets` was checked and not chosen: right now it is iOS only, in alpha, and without image support. The app and the widgets read the same payload: the app fetches `widget-state` with the device's widget token and hands the result to the widgets, so there is one shape and one source. The critter picture comes from the same drawing code as the app (decision D16): the iOS widget loads PNGs that `widget-state` renders, a day and a night version, and the Android widget draws the SVG on the device. Single-pack widgets choose their pack in the widget settings (an App Intent on iOS, a configuration screen on Android).

**Build and distribution:** EAS Build for iPhone and Android, EAS Submit to TestFlight and the stores, EAS Update for fast JavaScript updates without a new review. The pilot runs on TestFlight and in Google Play closed testing, which for a new personal developer account requires at least 12 testers for 14 days in a row before publishing.

## 15. Scope and build phases

Version 1 includes all of sections 3–12, including widgets, achievements and a wardrobe, a focus timer and the Me screen, with a temporary character until the final design is ready. The build is split into twelve phases, and each phase ends with something that can be tested, and from phase 1 also on an iOS device and an Android device.

| Phase | What gets built | Done when... |
| --- | --- | --- |
| 0. Game engine | game-engine: the day rules, times and time zones, achievements, tests and simulator | Tests pass for all the rules in section 5, and the simulator confirms the numbers |
| 1. Infrastructure | Expo project, Supabase, sign-in, development build for iOS and Android | You can sign in from both devices and see an empty home screen |
| 2. Packs | Creation, invite link and QR, joining, pack settings | Two devices in the same pack |
| 3. Temporary critter | One character component that receives state, including wardrobe items | The creature changes when values change in the database |
| 4. Feeding | Camera, compression, upload, submit\_feed, focus timer, real-time update | A feed shows up for the other member |
| 5. Day close | close-days, apply\_day\_result, rest days, joker, pause, sleep, running away, achievements | A day closes correctly on the server, including filling in missing days |
| 6. Social | Feed, reactions, nudge, monthly board, name suggestions, wardrobe, Me | Full use in a real pack for a whole day |
| 7. Notifications | notifications table, send-push, all notification types and the rate limits | The evening reminder and "Last one" arrive |
| 8. Widgets | iOS (home screen and lock screen) and Android, widget-state | The widget updates after a feed and at the end of the day |
| 9. Recap and sharing | weekly-recap, story image | A recap can be shared to Instagram |
| 10. Store readiness | Onboarding, account deletion, filtering, reporting with an alert to the developer, blocking, privacy policy, icon, screenshots | A two-week pilot is running |
| 11. Public launch | Hebrew and RTL, the creatures' lines in Hebrew, final design in Rive | The app is in the stores |

**Pilot:** 5–6 packs, at least half of them not close friends of the developer, on iOS and Android, for at least two weeks.

**Success metric before launch:** at least two thirds of the test packs still active (by the definition in section 1) after 14 days.

**In later versions (not in version 1):**

- Automatic feeding from the health app (steps, workouts).
- Automatic on-device photo checks.
- A paid item shop and a Gozali+ subscription (section 16).
- A Live Activity for the focus timer.
- More creature species.

## 16. Business model

The game itself is completely free, and revenue comes from cosmetic items and an optional subscription; no payment changes the rules of the game. Version 1 ships with no payments at all, and monetization comes in only after retention is proven.

**What is sold:**

- **Cosmetic items for the creature:** hats, accessories, backgrounds and homes. An item that was bought appears on the whole pack's creature, so the members see it too, and that's part of the motivation to buy. Bought items go into the same wardrobe that already exists in version 1.
- **A gift for the pack:** a member buys an item for the shared creature, with a message in the feed ("Dan got Pixel a crown").
- **Gozali+ subscription:** unlimited packs (instead of 3), more creature species, special colors, an exclusive item every month and advanced statistics. Initial test price: about $2.99 a month or $19.99 a year.

**What is not sold:**

- Jokers, revivals, health or XP. That would break the logic: someone who pays wouldn't need to work out.
- Ads. They hurt the emotional experience and bring in very little at a small scale.

**Technical:** purchases through RevenueCat, which manages In-App Purchases in both stores, the subscriptions and verification against the server.

## 17. Open decisions

All the decisions that blocked version 1 are closed; the details and reasoning are in [decisions.md](decisions.md). What's left are decisions that don't block starting the build:

- [ ] Register the gozali.app domain before the launch (it was free on Sep 26, 2026).
- [ ] Design direction for the characters: illustrated pastel, clay or sticker.
- [ ] Who illustrates the characters, and who animates them in Rive.
- [ ] Whether 3 free packs is right, or a different limit is better (before monetization). Note: few users will reach a fourth pack, so it is a weak lever for payment; "a gift for the pack" looks stronger.

## 18. Change history

### Version 3.1

- **Name:** the app is called Gozali (decision D11). Pack stays the name of a group inside the app, and the future subscription is called Gozali+.

### Version 3

- **Success model:** in packs of 5 counted members or more, one miss is allowed. Every miss always costs 8 health. A "failed day" was added, and the streak resets when the creature runs away.
- **Scope:** a full version 1, with home screen widgets (iOS and Android) and lock screen widgets (iOS), achievements and a wardrobe, a focus timer for Study and Reading, the Me screen, QR invites, Onboarding and accessibility.
- **Architecture:** the rules in a pure TypeScript module; user actions as Postgres functions; close-days applies each day through `apply_day_result`.
- **End of day:** 03:00, and the grace window until 04:00.
- **Pilot:** iOS and Android, 5–6 packs, at least half of them not close friends.
- **Language:** an English pilot, a public launch in English and Hebrew.
- **Transparency:** 🤨 is shown as a number without names.
- **Sleep:** the miss count starts over when the member wakes up.
- **Data model:** 18 tables (achievements and widget\_tokens added), a wardrobe on the creature, the timer length on the feed, and achievement facts in day\_results.
- **Phases:** the game engine first (phase 0); widget and public launch phases added.

### Version 2

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
