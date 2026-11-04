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

Start a pack for a habit you share (the gym, running, walking, yoga, meditation, reading, studying, a language, music practice, or anything you choose) and invite 1 to 7 friends. Pick one of six critters, each with its own personality: lazy Mochi, dramatic Kit, cheerful Axo, calm Ribbit, nerdy Hoot or shy Bun.

**Feed it with a photo.** Every day you do your habit, take a photo in the app. That photo is what feeds your critter. Your friends see it in the pack feed and can react.

**Do it together.** Your critter grows from an egg to a legend when the pack keeps going. Rest days, a monthly joker and pauses for trips keep it fair when life happens, and a member who disappears falls asleep instead of dragging everyone down.

**It never dies.** If nobody feeds it, it goes off to find food. Three good days in a row bring it back, with a little bandage.

**Keep the streak.** Every good day earns the pack coins, and a longer streak earns more. Spend them on hats, scarves and backgrounds in the outfit shop, and unlock special items with achievements.

Also inside:
- Home and lock screen widgets that show your critter and how many of you fed today.
- A focus timer for study, reading, meditation, language and music packs.
- A weekly recap you can share as a story, with only your own photos.
- Gentle reminders in your critter's voice, never more than a few a day, and never at night.

Photos are seen only by your pack, unless one is reported and the developer has to look at it. They are deleted after 30 days, or 8 weeks after their week if they're in a weekly recap. No ads, no tracking.

## Keywords (App Store, 100 characters)

`habit,tracker,friends,pet,streak,accountability,gym,reading,study,routine,group,goals,virtual pet`

## Categories and age

- **Category:** Health & Fitness; secondary: Lifestyle (App Store). Google Play: Health & Fitness.
- **Age:** the app is for 13 and over (users confirm it in the profile setup). In Apple's questionnaire, answer that the app has user-generated content (photos and captions) that members of a pack see, with reporting and blocking; expect a 13+ rating. In Google Play's content rating, answer that users share photos with each other and can interact.

## Privacy answers

What the app collects (see docs/legal/privacy-policy.md), including what Expo's code in the app sends to Expo: the push token and the update check on every start. No tracking and no ads.

| Data | App Store label | Google Play data safety | Purpose |
| --- | --- | --- | --- |
| Email address (from Apple or Google sign-in) | Contact info, linked to the user | Personal info: email, collected | Account |
| Display name and profile photo | Contact info: name; User content: photos, linked | Personal info: name; Photos, collected, shared with pack members | App functionality |
| Feed photos and captions | User content: photos, other user content, linked | Photos; other user-generated content, shared with pack members | App functionality |
| Reactions, nudges, name suggestions, reports and blocks | User content: other, linked | Other user-generated content | App functionality |
| Focus session lengths, rest days, jokers, pauses and outfit changes | Usage data: product interaction, linked | App activity: other actions | App functionality |
| User ID | Identifiers: user ID, linked | Personal info: user IDs | App functionality |
| Push token and widget token | Identifiers: device ID, linked | Device or other IDs | App functionality |
| Time zone, language and reminder settings | Other data, linked | Personal info: other info (time zone and language); App activity: other actions (reminder settings) | App functionality |
| Error reports (the error, stack trace, the screen, the app version, iPhone or Android, whether the app crashed, and on a sign-in report the system name and version) | Diagnostics: crash data, other diagnostic data, linked | App info and performance: crash logs, diagnostics, collected | App functionality; on Google Play also Analytics |
| Network address and user agent of each signed-in phone (kept by the sign-in service until that phone signs out or the account is deleted) | Other data, linked | Device or other IDs, collected | App functionality |
| Scrambled network address when a sign-in fails (a keyed hash kept apart from the report, used for an hour, deleted within about a day) | Other data, not linked | Device or other IDs, collected | App functionality; on Google Play: fraud prevention, security and compliance |
| Update check that Expo's code sends to Expo each time the app starts: the network address, a random id kept for the installation, the app version and system, and an error that stopped the app while it was starting (Expo counts installations and failures per update for the developer) | Other data; Identifiers: device ID; Diagnostics: crash data (each already declared above, so the App Store answers don't change) | Device or other IDs; App info and performance: crash logs, collected (both already above) | App functionality; on Google Play also Analytics |

Data is encrypted in transit, and users can delete their account inside the app (Settings → Delete account). That removes the account and its data right away, apart from what the privacy policy lists: copies in the daily backups on the developer's computer, outside the EU, for about 14 days (the 14 newest are kept), the account id in the packs' past results, the name or account id in records of notifications sent to others for up to 30 days, the sign-in service's security log, and report emails. Photos are deleted after 30 days (a photo in a weekly recap collage 8 weeks after that week). A reported photo reaches the developer by email, through a link that works for 7 days.

Google Play's form also asks for a web link where people can ask for their account to be deleted, and a page that only sends them back to the app doesn't count. Give `https://gozali.app/support`: its "Deleting your account" line tells someone without the app to write to hello@gozali.app from the address they signed in with, or to give their Hide My Email address, and the developer confirms through that address and deletes the account within 30 days of the answer (docs/setup.md, section 5).

## Notes for Apple's review

To paste into App Store Connect → App Review Information → Notes, with the demo pack's code in place of `<invite code>`. The real code stays out of this file, because the repository is public. Notes also holds the answers to Apple's six questions of October 2026, which Apple asked to keep there for later submissions. This text replaces the answer to question 3 (how to reach the main features) and leaves the others. The field takes 4,000 bytes in all.

```text
Gozali needs an account. You get one with Sign in with Apple, which has no user name or password to give here, so please use your own Apple ID: any Apple ID works.

A new pack starts as an egg, which hatches at the end of the first day on which two members feed it and nobody misses (a feed is a photo taken in the app). With one account you can create a pack, use "Not today" (rest day, joker, pause) before that day's feed, feed it, open the pet's Profile with the monthly board and achievements, and change the settings. The Focus button (focus timer) appears on Study, Reading, Meditation, Language and Music packs.

To see a hatched pet, a friend's photos, the outfit shop and a weekly recap, tap "Join with a code" on the home screen and enter <invite code>. To hatch your own egg, a second account joins with the pack's code (Invite on the pack screen) and feeds the same day; the day closes around 04:00 in the pack's time zone.

Feed photos are taken in the app only (no gallery uploads); the photo library is only for the optional profile photo. Photos are visible only to the pack, unless one is reported. Another member's photo can be reported from its ⋯ menu, in the feed, opened full screen or in a weekly recap. Press and hold a member in the members row to report them (for a name or a profile photo) or block them. Reports and blocks reach the developer by email and are handled within 24 hours.

Captions, names (of members, packs and pets) and habit texts are checked against a list of offensive words, and text with one is refused. Users reach the developer at hello@gozali.app, shown in Me → Settings and in the terms.

Account deletion: Me → Settings → Delete account.
```

The "Sign-in required" box stays unticked, though by Apple's wording it applies: App Store Connect asks for it when an app needs a login, and guideline 2.1(a) asks for demo account details. Its fields only take a user name and a password, and Sign in with Apple has neither to give: the sheet uses the Apple ID on the device, and a demo Apple ID would stop at a code sent to the owner's phone. So the notes open by saying this. App Review has worked that way so far: the last review tried Sign in with Apple and didn't ask for an account. If Apple does ask, the answer is a demo login in the app, which doesn't exist yet.

Before submitting:

- `https://gozali.app/privacy` and `https://gozali.app/terms` open with no draft line and with the "Last updated" dates in `docs/legal`. The site goes out ahead of the build (`docs/setup.md` section 5).
- The demo pack has everything the notes promise: a hatched pet, a few days of feeds, a weekly recap, and room for one more (a pack holds 8). Use Demo Friend's pack once it has all that, or a pack from TestFlight testing. If it falls short, take what is missing out of the notes.
- Post fresh Demo Friend photos the day you submit, and keep the pack fed until the review ends. Build 4 waited 13 days for its review. A feed photo is deleted 30 days after it was posted, and the reviewer would find a line in its place. A pack of three or more that stops feeding can lose its pet within a week.
- Tell the pack a reviewer may join.

Once the app is approved, the admin removes the reviewer's account from Pack settings → Members. A removed member can't join again, so not before.

## App Store Connect, the first submission

1. App Information: name `Gozali: Habit Pet`, subtitle, category Health & Fitness (secondary Lifestyle), content rights: no third-party content, the age rating questionnaire (user-generated content: yes; everything else: no), privacy policy URL `https://gozali.app/privacy`.
2. Pricing and Availability: free, all countries.
3. App Privacy: the answers above; data is not used for tracking.
4. The 1.0 version: the five screenshots from `e2e/store/output/app-store` (6.9"), the promotional text, description and keywords above, support URL `https://gozali.app/support`, marketing URL `https://gozali.app`, copyright `2026 Ariel Kuznets`, the build (after Apple processes it), the review notes above, and the contact details.
5. Add for Review, then Submit to App Review. The encryption question is already answered in the app (`ITSAppUsesNonExemptEncryption`: no).

Once it's live: set `APP_STORE_URL` for the site (`docs/setup.md` section 3) and the store link in `app_config` (section 5).

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
