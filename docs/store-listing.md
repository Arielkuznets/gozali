# Store listing

Drafts for App Store Connect and the Google Play Console, and the answers the stores' forms ask for. Everything here describes the app as it is today; update it with the app.

## Names and short texts

| Field | Store | Limit | Text |
| --- | --- | --- | --- |
| Name | both | 30 | Gozali: Habit Pet |
| Subtitle | App Store | 30 | Raise a pet with your friends |
| Short description | Google Play | 80 | Keep your habit with friends and raise a pet together. Feed it with a photo. |
| Promotional text | App Store | 170 | Pick your critter, invite up to 7 friends, and feed it every day by doing your habit. Keep the streak going to earn coins for outfits. |

## Description (both stores)

Gozali turns a habit into a pet you raise with your friends.

Start a pack for a habit you share (the gym, running, reading, studying, drinking water, or anything you choose) and invite 1 to 7 friends. Pick one of six critters, each with its own personality: lazy Mochi, dramatic Kit, cheerful Axo, calm Ribbit, nerdy Hoot or shy Bun.

**Feed it with a photo.** Every day you do your habit, take a photo in the app. That photo is what feeds your critter. Your friends see it in the pack feed and can react.

**Do it together.** Your critter grows from an egg to a legend when the pack keeps going. Rest days, a monthly joker and pauses for trips keep it fair when life happens, and a member who disappears falls asleep instead of dragging everyone down.

**It never dies.** If nobody feeds it, it goes off to find food. Three good days in a row bring it back, with a little bandage.

**Keep the streak.** Every good day earns the pack coins, and a longer streak earns more. Spend them on hats, scarves and backgrounds in the outfit shop, and unlock special items with achievements.

Also inside:
- Home and lock screen widgets that show your critter and who fed today.
- A focus timer for studying and reading.
- A weekly recap you can share as a story, with only your own photos.
- Gentle reminders in your critter's voice, never more than a few a day, and never at night.

Photos are seen only by your pack and are deleted after 30 days. No ads, no tracking.

## Keywords (App Store, 100 characters)

`habit,tracker,friends,pet,streak,accountability,gym,reading,study,routine,group,goals,virtual pet`

## Categories and age

- **Category:** Health & Fitness; secondary: Lifestyle (App Store). Google Play: Health & Fitness.
- **Age:** the app is for 13 and over (users confirm it in the profile setup). In Apple's questionnaire, answer that the app has user-generated content (photos and captions) that members of a pack see, with reporting and blocking; expect a 13+ rating. In Google Play's content rating, answer that users share photos with each other and can interact.

## Privacy answers

What the app collects (see docs/legal/privacy-policy.md). No tracking, no ads, no analytics, no third-party SDKs that collect data.

| Data | App Store label | Google Play data safety | Purpose |
| --- | --- | --- | --- |
| Email address (from Apple or Google sign-in) | Contact info, linked to the user | Personal info: email, collected | Account |
| Display name and profile photo | Contact info: name; User content: photos, linked | Personal info: name; Photos, collected, shared with pack members | App functionality |
| Feed photos and captions | User content: photos, other user content, linked | Photos; other user-generated content, shared with pack members | App functionality |
| Reactions, nudges, name suggestions | User content: other, linked | Other user-generated content | App functionality |
| User ID | Identifiers: user ID, linked | App info: other IDs | App functionality |
| Push token and widget token | Identifiers: device ID, linked | Device or other IDs | App functionality |
| Time zone and reminder settings | Other data, linked | App info: other | App functionality |

Data is encrypted in transit, and users can delete their account and all its data inside the app (Settings → Delete account). Photos are deleted after 30 days.

## Notes for Apple's review

- Sign in with Apple works with the reviewer's own Apple ID; no demo account is needed.
- A new pack starts as an egg that hatches once two members feed it on the same day. To see a hatched critter, feeds, the shop and a recap right away, join the demo pack with the invite code in the review notes (to create before submitting: a pack with a hatched critter, some coins and a few days of feeds, made with a second test account).
- Photos are taken in the app only (no gallery uploads), are visible only to the pack, and can be reported from the ⋯ menu on each photo; members can be blocked from the members row. Reports reach the developer by email and are handled within 24 hours.
- Account deletion: Settings → Delete account.

## Screenshots

App Store needs 6.9" (1320 × 2868) or 6.7" (1290 × 2796) iPhone screenshots; Google Play needs at least two phone screenshots, no longer than twice their width. Five are made from the app itself, with sample data and a caption over each:

```sh
npm run e2e:build
npm run store:shots
```

With the local Supabase stack running (the same setup as the end-to-end tests), this writes `e2e/store/output/app-store` (1320 × 2868) and `e2e/store/output/google-play` (1080 × 2160):

1. The pack screen with a happy critter, the members row and the Feed button: "Raise a pet with your friends".
2. The pack feed with reactions: "Feed it a photo, cheer each other on".
3. Picking one of the six critters: "Six critters, six personalities".
4. The wardrobe and the outfit shop: "Keep the streak, dress it up".
5. The weekly recap: "Look back on your week together".

Two more need a real phone, taken from the first builds: the camera with the eating moment, and the widgets on a home screen ("Your pet on your home screen").
