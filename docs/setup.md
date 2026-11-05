# Setting up the cloud

Everything runs locally without accounts (see the README). This is the one-time setup for the real project: Supabase, EAS builds, sign-in providers and the gozali.app site. Values in `<angle brackets>` come from the accounts; secrets are never committed.

## 1. Supabase

1. Create a project (a region close to the users, for example Frankfurt), and keep the database password in a password manager.
2. Link and push the schema:

   ```sh
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```

3. Deploy the functions. They import `packages/game-engine` and `packages/critter-art` from outside `supabase/functions` (decisions D13 and D16). The deploy bundles them (confirmed on the first deploy), and `npm run functions:bundle` checks the same bundling in CI.

   ```sh
   npx supabase functions deploy close-days send-push widget-state on-report delete-account
   ```

4. Secrets for the functions. `CRON_SECRET` is any long random string; `EXPO_ACCESS_TOKEN` is optional (Expo push security). `RESEND_API_KEY` and `REPORT_EMAIL` send report alerts. Until a domain is verified in Resend they go out from Resend's test sender, which delivers only to the Resend account's own address, so `REPORT_EMAIL` has to be that address. Without the key or the address a report reaches only the function log, and on-report answers 503, which the owners' daily summary counts as a server error. A report whose email fails isn't sent again; its id is in the function's answer, in `service_errors`.

   ```sh
   npx supabase secrets set CRON_SECRET=<random> EXPO_ACCESS_TOKEN=<token> RESEND_API_KEY=<key> REPORT_EMAIL=<the Resend account's email>
   ```

   Once a domain is verified in Resend, set the sender at it, and `REPORT_EMAIL` can be any address. Not before: Resend refuses a sender at a domain it hasn't verified, and every report email is lost.

   ```sh
   npx supabase secrets set REPORT_EMAIL_FROM="Gozali <reports@<verified domain>>"
   ```

   Check them with `npx supabase secrets list`: `REPORT_EMAIL_FROM` is there only once the domain is verified, and `npx supabase secrets unset REPORT_EMAIL_FROM` takes away one set too soon. Then report a photo from the app and see that the email arrives. `HEARTBEAT_URL` is optional: an outside check that mails you when the pushes stop (section 5).

5. Let pg_cron reach the functions: in the SQL editor, with the same `CRON_SECRET`:

   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1', 'functions_url');
   select vault.create_secret('<random>', 'cron_secret');
   ```

   The schedules (close-days every 15 minutes, send-push every minute, evening reminders every 5 minutes) are already in the migrations; they do nothing until these two secrets exist.

6. Auth → URL configuration: site URL `gozali://`, redirect URL `gozali://auth/callback`.
7. Auth → providers:
   - **Apple:** an App ID with Sign in with Apple (bundle id `app.gozali`), and the bundle id in the provider's client IDs: that is all the native sign-in on iPhones needs. Signing in with Apple in the browser (on Android, and as the fallback on iPhones) also needs a Services ID and a secret, see section 8.
   - **Google:** the app signs in with Google through the browser, so one OAuth client of type Web application is enough (Google Cloud → APIs & Services → Credentials, in the Google Cloud project Firebase creates). Its authorized redirect URI is `https://<project-ref>.supabase.co/auth/v1/callback`; paste its client ID and secret into the Google provider. The app shows its Google button only while this provider is on (it reads the project's public auth settings), so turning it on needs no new build.
8. The email code template (`supabase/templates/sign_in_code.html`) is only for the development login, but the Email provider stays on in production while App Review's demo account is in use. Demo Friend has no Apple ID: it signs in with an email and a password, and that is how its photos are posted (docs/store-listing.md, Notes for Apple's review). Once the app is approved and Demo Friend is deleted, nothing uses the provider, and it can go off.
9. Storage settings: turn off the connection via the S3 protocol. Nothing uses it, and its multipart uploads go around the upload limits (spec section 14); `config.toml` has it off for the local stack.

## 2. EAS builds

1. `npm install -g eas-cli`, `eas login`, then in `apps/mobile`: `eas init`. This writes the project id into `app.json`, which push tokens need.
2. The Apple Team ID is in `app.json` → `expo.ios.appleTeamId` (3DYA8J45VJ; the widget target needs it) and is the default in `web/build.mjs`.
3. Environment variables for every environment (development, preview, production):

   ```sh
   eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://<project-ref>.supabase.co --environment development
   eas env:create --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value <publishable key> --environment development
   ```

4. A development build for each platform, installed on the phones:

   ```sh
   eas build --profile development --platform ios
   eas build --profile development --platform android
   ```

   EAS creates the App Group `group.app.gozali` for the app and the widget. Then `npx expo start` in `apps/mobile` and open the build.
5. For push notifications on iOS, let EAS create the push key when it asks during the first build.
6. Push notifications on Android go through Firebase Cloud Messaging:
   - In the Firebase console, create a project and add an Android app with the package `app.gozali`. Download `google-services.json` and hand it to EAS as a file variable (`app.config.js` reads it; the file stays out of git):

     ```sh
     eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment development
     ```

     Repeat for `preview` and `production`. An Android EAS build in an environment without it stops with an error, since its phones would never get a push token.
   - Firebase → Project settings → Service accounts → Generate new private key, then `eas credentials` → Android → Push Notifications (FCM V1) and upload that key. Keep the key file out of the repo too.

## 3. gozali.app

1. Register the domain.
2. Build the site with the real values and deploy it. `web/wrangler.jsonc` serves `web/dist` as Cloudflare static assets (they read `_redirects` and `_headers`) on the gozali.app domain, which has to be in the same Cloudflare account:

   ```sh
   npx wrangler login
   APP_STORE_URL=<app store link> PLAY_STORE_URL=<play store link> ANDROID_SHA256=<release key fingerprint> node web/build.mjs && cd web && npx wrangler deploy
   ```

   The Android fingerprint is in `eas credentials` (Android → keystore). Once the app is on Google Play, use the one under the app signing key in the Play Console's App signing page instead: Play signs what it delivers with its own key, and the upload key's fingerprint doesn't match the app on people's phones. Without a real fingerprint the build refuses to run, because the invite links would open the browser instead of the app. Keep the build and the deploy on one line: after a refused build the `&&` stops there, where a separate line would publish the old `web/dist` again. `node web/build.mjs --preview` needs none of these values and builds into `web/dist-preview`, which is never deployed, to look at the pages. The landing page shows a store button only for the store URLs that are set. Until the app is in the App Store, `APP_STORE_URL` can be the TestFlight invite link.
3. The site has the privacy policy (/privacy), the terms (/terms) and the support page (/support) that App Store Connect asks for. Mail to hello@gozali.app is forwarded by Cloudflare Email Routing.

   The privacy policy says each service it names is bound to give members' data the same or equal protection as the policy does, as App Review guideline 5.1.1(i) asks. Each is bound by the data processing terms that come with the project's account there, so before the site goes out, check these are in force:

   - **Supabase:** its Data Processing Addendum, part of its Terms of Service (supabase.com/legal/dpa).
   - **Expo:** section 3.2 of its Terms of Service, under which it processes members' data as Gozali's processor, with the EU standard contractual clauses (expo.dev/terms).
   - **Apple:** the Apple Developer Program License Agreement, accepted with the developer account that holds the push key EAS made (section 2). Its push notification terms keep Apple from reading or passing on a notification's content, but for the law, security or safety.
   - **Google:** the Firebase Data Processing and Security Terms, accepted with the Firebase terms when the project was made. They cover Cloud Messaging, which carries the Android pushes under the project's key (section 2).
   - **Resend:** its Data Processing Addendum, which Resend signed and which is in force from sign-up (Settings → Documents).
   - **Cloudflare:** its Data Processing Addendum, part of the Self-Serve Subscription Agreement (cloudflare.com/cloudflare-customer-dpa).

   Sign in with Apple and with Google work under each one's own privacy policy, which the member accepted with that account. A service that would get members' data and has no such terms stays out of the app and the policy.
4. Check `https://gozali.app/.well-known/apple-app-site-association` and `https://gozali.app/.well-known/assetlinks.json` load, then an invite link opens the installed app.

## 4. Before the pilot

- Phase 1 and 2 checks on two phones: sign in with Apple and Google, create a pack, join it from the other phone.
- The widgets on both platforms (they have only been built by EAS, never tried by hand).
- A day close on the cloud: the next morning, `select * from day_results order by closed_at desc` shows the night's results.
- Google Play closed testing needs at least 12 testers for 14 days in a row before publishing.

## 5. During the pilot

Alerts on your own phone: add your profile to the owners, once, and you get a push for every new sign-up and a summary of the day at 21:00 (spec section 8). Your profile id is in the Auth dashboard, or from the profile that has your push token:

```sh
npx supabase db query --linked "insert into public.app_owners (user_id) values ('<your profile id>')"
```

The row goes with the account. Deleting that account, even to try Settings → Delete account, ends every alert, and signing in again with the same Apple ID makes a new profile with a new id, so add that one. With no owner left there is nobody to tell, so the release below starts by counting the owners.

These alerts go out through send-push like every other push, so whatever stops the pushes stops them too: a `cron_secret` in the Vault that doesn't match `CRON_SECRET`, a missing `functions_url`, send-push failing, or Expo turning the pushes down. Silence then looks like a quiet day, so two checks stay off that road:

- No summary by 21:15 means something on the way is broken: run the health queries below.
- An outside check mails you within minutes. Create one on a dead-man service, for example a free check on healthchecks.io with a period of 1 minute and a grace time of 15 minutes, and give send-push its ping URL. Every run that went well pings it, a quiet one too, and a run that failed or never started doesn't, so the service hears silence and mails you. The ping carries nothing about the members, and without the secret send-push works the same and pings nothing. After setting it, the check's page shows a ping every minute.

  ```sh
  npx supabase secrets set HEARTBEAT_URL=https://hc-ping.com/<check uuid>
  ```

The success numbers of spec sections 1 and 15 (active packs, active packs 14 days after they were created, pack size, and invited users who opened a pack of their own):

```sh
npx supabase db query --linked "select public.pilot_metrics()"
```

The daily summary on your phone already counts failed function calls, failed scheduled jobs, outages and packs behind on closing days. When something else broke for a while (sign-in or storage down while the functions ran), add it as an outage so the pack days it covered can't fail; days already closed stay as they were:

```sh
npx supabase db query --linked "insert into public.outages (starts_at, ends_at, note) values ('2026-10-01 08:00+03', '2026-10-01 14:00+03', 'storage down')"
```

Plan limits: the summary adds "📦 612 MB of files (free plan: 1 GB)" once this project's stored files reach 500 MB. Egress and database size can't be read that way: they show only on the organization's Usage page, so look there every week. Supabase's own notice goes to the billing email and only after a quota is passed, so make sure that is an address you read. When the line shows up, the choice is Pro or keeping less. After a move to Pro, change the line in `summaryLine` (`supabase/functions/send-push/messages.ts`) or it shows every evening.

Is the server doing its jobs? The first query lists the packs behind on closing days, the ones the summary's ⏰ line counts, each with the first day it hasn't closed: that day should have closed over an hour ago, so close-days is failing for that pack. A pack no friend has joined yet closes no days, and neither does one everyone left, so neither is ever behind. The other two list scheduled jobs that failed and function calls that didn't answer 200, over the last day. Those calls are what the summary counts as server errors: every five minutes they are copied into `service_errors`, with the error or the start of the answer in `detail`, and kept there 30 days, while `net._http_response`, where pg_net writes the answers, keeps only 6 hours.

```sh
npx supabase db query --linked "select p.name, t.pack_id, t.next_day from public.packs_to_close(now() - interval '1 hour') t join public.packs p on p.id = t.pack_id order by t.next_day"
npx supabase db query --linked "select jobid, status, return_message, start_time from cron.job_run_details where status <> 'succeeded' and start_time > now() - interval '1 day'"
npx supabase db query --linked "select at, status, detail from public.service_errors where at > now() - interval '1 day' order by at desc"
```

Errors from members' phones (screens that failed to draw, JavaScript errors that closed the app, sent on the next start, and queued feeds that were dropped or got stuck) are kept for 30 days:

```sh
npx supabase db query --linked "select created_at, platform, app_version, screen, message from app_errors order by created_at desc limit 50"
```

Someone without the app can ask at hello@gozali.app to have their account deleted, for a copy of their data or for a correction. The privacy policy promises each within 30 days, a deletion within 30 days of their answer to your confirmation. Only the account's own address can ask, so whatever a mail says, act on it only once that address confirms:

1. Find the account in Auth → Users by the address. An account made with Sign in with Apple and Hide My Email holds an address ending in `@privaterelay.appleid.com`, which the person reads on an iPhone under Settings → their name → Sign in with Apple → Gozali; the address they write from is nowhere in the project.
2. Write to the account's address and ask them to answer to confirm. Apple's relay passes mail on only from senders the developer registered, and bounces the rest: once, in the Apple Developer account under Certificates, Identifiers & Profiles → Services → Sign in with Apple for Email Communication → Configure, add the address you write from to Email Sources.
3. Once a deletion is confirmed, delete the files first, as the app does: in the SQL editor, `select public.account_photo_paths('<user id>')` lists the photos, each under its pack's folder in Storage → feed-photos, in a folder named for the user id. Delete them there, and the folder named for the user id in Storage → avatars.
4. Then delete the user in Auth → Users. The profile, memberships, feeds, reactions, passes and tokens go with it, and an admin's role passes to the longest-standing member who plays.

Nothing takes a deletion back: a restore goes only into an empty project.

A release goes out in this order, after a check that the alerts still reach someone: `npx supabase db query --linked "select count(*) from public.app_owners"` answers 1 or more.

1. `npx supabase functions deploy on-report`. It reads a report as the server gives it before the migrations and after them, and the one in place may not: the on-report of build 4 fails on a report about a member, which every block makes once the migrations are in, and that email is lost.
2. `npx supabase db push`, at about :05 or :20 past the hour. Day closes run at :00, :15, :30 and :45, and a close or a settings save caught inside a migration's commit carries on with the old function. A policy change in the push also locks Supabase's auth, storage and Realtime tables for a moment, so a sign-in or a token refresh just then can deadlock with it, and Postgres stops one of the two. When that is the push, it ends with `deadlock detected`: run it again. Each file goes in as one transaction, so the one that stopped left nothing behind, and the push carries on from it.
3. `npx supabase functions deploy close-days send-push widget-state delete-account`, only once `npx supabase migration list` shows every file under Remote as well as under Local. These call what the migrations add, so deployed first they fail until the schema catches up.

   Then look for packs in a zone the day close's Intl may not read: until step 2, build 4 could make one in America/Coyhaique, a `posix/` name or Factory.

   ```sh
   npx supabase db query --linked "select id, name, timezone, created_at from public.packs where timezone = 'America/Coyhaique' or timezone like 'posix/%' or timezone = 'Factory'"
   ```

   Where Intl can't read the zone, a run closes only the day the database found due, so a pack days behind catches up one day every 15 minutes. Under a name Intl reads with the same clock (America/Punta_Arenas for America/Coyhaique, the name after `posix/`, Etc/UTC for Factory) it catches up in one run: `npx supabase db query --linked "update public.packs set timezone = 'America/Punta_Arenas' where timezone = 'America/Coyhaique'"`.
4. The backup job, before the site. The privacy policy tells people the database is copied once a day, so the page can't go out ahead of the job. `Get-ScheduledTask -TaskName 'Gozali backup'` has to show Ready, and `~/Gozali backups` a file from the last evening. If not, register the task (Backups, below), run it once with `Start-ScheduledTask -TaskName 'Gozali backup'` and read `backup.log`. A copy goes only once 14 newer ones exist, so after a gap delete any copy older than 14 days by hand, or it stays past what the policy says.
5. The site, when `web/`, `docs/legal` or `docs/support.md` changed (section 3). Nothing else publishes them, so the live pages stay behind the repo until this runs. It comes before the build because App Review reads the privacy policy and the terms along with it, and they have to match the App Privacy answers.
6. The build. People get the new app last, so it finds the server it was made for.

A fix that touches only JavaScript reaches the installed apps without a new build or a store review, through EAS Update. Each build profile has its own channel, and the runtime version is the app version in `app.json`, so an update only goes to builds of that version:

```sh
cd apps/mobile
eas update --channel production --environment production --clear-cache --message "Fix the monthly board"
```

Both flags are required. Without `--environment` the CLI bundles `apps/mobile/.env`, which points at the local stack, and without `--clear-cache` Metro can reuse a bundle with an old `EXPO_PUBLIC_*` value inlined, because its cache doesn't look at those values. Either way every installed phone gets an app that calls `127.0.0.1`.

A change to native code (a new native package, app.json plugins, the widgets) needs a new build instead, and a new `version` in `app.json` first, so updates for the old builds and the new ones stay apart. (A fingerprint of the native code would do this by itself, but it came out different on Windows and on the EAS servers and failed the build.)

Build 5 is such a build: it patches expo-apple-authentication, expo-camera and expo-notifications, asks for permission to save to the photo library and changes the widgets, while `app.json` still says 1.0.0, as it did for build 4. Raise `version` before building it, for example to 1.0.1. Then an update made for one of them never reaches the other, and `min_version` can retire build 4 once build 5 is out. An EAS Update from this branch goes out only after step 3 of the release, since its JavaScript calls what the migrations and functions add.

Until testers install build 5, build 4 shows a generic message for two refusals of the new server: a nudge to someone in their quiet hours says "Saving didn't work", and a removed member who enters the pack's code gets "This didn't load". Say so in TestFlight's What to Test for build 5.

A bad update can be taken back, and how depends on what came before it on the branch:

- **It is the first update since a store build.** Send every phone back to the JavaScript inside its own build:

  ```sh
  cd apps/mobile
  eas update:roll-back-to-embedded --channel production --runtime-version 1.0.0 --message "Back to the store build"
  ```

  The runtime version is the `version` in `app.json` of the builds that got the update. Don't republish here: the update before it on the branch was made for an older build, and a republished update counts as the newest one, so every phone on that runtime version would load it, the new build included. `eas update:rollback` asks which of the two you want (Embedded Update here). Given the bad update's group id it republishes the group before it, so don't use that form here.
- **An update newer than the store build came before it.** Publish that one again: `eas update:republish --channel production`, or Expo's dashboard → Updates.

A store release can go out as a phased release in App Store Connect.

When a server change would break versions still installed on people's phones, raise the minimum version: older apps show "Time to update" with a button to the store instead of the app. Set the store links once the app is in the stores:

```sh
npx supabase db query --linked "update public.app_config set min_version = '1.1.0'"
npx supabase db query --linked "update public.app_config set ios_url = 'https://apps.apple.com/app/id<id>', android_url = 'https://play.google.com/store/apps/details?id=app.gozali'"
```

Crashes in native code (not JavaScript) don't reach `app_errors`: App Store Connect (TestFlight → Crashes, and Xcode → Organizer) and the Play Console (Android vitals) show them.

Backups: the free plan keeps none, so `scripts/backup.mjs` saves the data of every table and the accounts into `~/Gozali backups` as one JSON file a day (the newest 14 are kept, with a `backup.log`). It goes through the signed-in Supabase CLI, so it needs no keys and no Docker, and takes a few minutes. Photo files aren't included. The privacy policy tells users where these copies are and how long they last, so it changes with them. To run it every evening on this Windows PC (at the next start when the PC was off at 21:30, and on battery, which a scheduled task skips by default), in PowerShell:

```powershell
$action = New-ScheduledTaskAction -Execute (Get-Command node).Source -Argument 'scripts\backup.mjs' -WorkingDirectory 'C:\Ariel\02_Projects\Gozali'
Register-ScheduledTask -TaskName 'Gozali backup' -Action $action -Trigger (New-ScheduledTaskTrigger -Daily -At '21:30') -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries)
```

A run that saved its file leaves a heartbeat in the project (`heartbeats`, job `backup`), and the daily summary reads it: "💾 last backup 3 days ago" once the newest is two days old, so one missed night shows the next evening, and "💾 no backup yet" until the first one reports. `backup.log` and Task Scheduler's Last Run Result say why it stopped. Only a crafted request can nest a value too deep for the file, in an account's metadata or identity: the run saves `{}` for that one value, keeps the rest of the row, and names the table, the row and the column at the end of its `saved` line.

To restore after a disaster: create a new project, link it and `npx supabase db push` the schema, then `node scripts/restore.mjs "<backup file>"`. A backup holds neither the functions nor their setup, so deploy the functions and set the function secrets, the Vault values and the Auth settings again (section 1, steps 3 to 7), the Apple key (section 6) and the Apple web provider (section 8). The `apple_revocation` and `apple_web_sign_in` switches come back as they were, so turn off any whose setup isn't back yet, or an iPhone deletes accounts without revoking them and offers a browser sign-in that can't work: `npx supabase db query --linked "update public.app_config set apple_revocation = false"` until the Apple key is back, and `npx supabase db query --linked "update public.app_config set apple_web_sign_in = false"` until the web provider is. The restore refuses a project that already has data. So a run that stops partway, because one call kept failing through nearly three minutes of tries or the window was closed, can't be run again on that project, which holds only part of the backup, for example accounts and packs with no critters. Don't use it or try to finish it: delete it, create a new one and start again from `db push` (on the local stack, `npx supabase db reset`). A backup reads one table after another while people use the app, so a row can be in it without its parent, like a reaction to a feed posted after `feeds` was read. The restore skips such a row, and it prints how many it skipped per table and in total at the end. The exception is a key the database empties when its parent goes, like the buyer of a pack's item: that row stays, with the key empty. When the skipped row was a pack's admin, the role passes on as it does when an admin's account goes: to the longest-standing member who plays. A pack made while the backup ran can be in it without its critter, and no day of such a pack can close, so the restore leaves it out with everything it holds and prints which packs. A pack from before the backup can't lose its critter that way: the restore keeps it and prints it, and before people use the project it needs its row in `critters` back by hand, from an older backup. A row the migrations seeded stays when the backup lacks it, since a migration can be newer than the backup, and the restore lists such rows at the end: delete any blocked word or shop item you had removed by hand. The privacy policy says accounts we can tell were deleted are deleted again. An account deleted while the backup ran is in it without its profile: the backup reads the accounts first and the profiles last, and a profile is made with its account and goes only with it. The restore deletes such an account, with whatever of it the backup read, and prints which. Accounts deleted after the backup finished come back with it whole: before people use the restored project, delete every account the old project no longer has, in Auth → Users, which takes its rows with it. Compare the backup's `auth.users` with the old project, or with its Auth logs, for as long as they can still be read. Nothing else records a deletion made after the backup finished, so once neither can be read those accounts stay. Try it on the local stack first: `node scripts/backup.mjs --local`, `npx supabase db reset`, then the restore with `--local`.

## 6. Sign in with Apple revocation

Apple asks apps with Sign in with Apple to revoke the user's tokens when they delete their account. The code is ready and waits for a key:

1. In Apple Developer → Certificates, IDs & Profiles → Keys, create a key with Sign in with Apple, configured for `app.gozali`, and download the `.p8` file (it can be downloaded once).
2. Put it in the function secrets, typing the values yourself (the key ID is on the key's page):

   ```sh
   npx supabase secrets set APPLE_TEAM_ID=3DYA8J45VJ APPLE_KEY_ID=<key id> APPLE_PRIVATE_KEY="$(cat AuthKey_<key id>.p8)"
   ```

3. Before turning it on, see whether the app goes inactive under Apple's sheet, on an iPhone and on an iPad with build 5 or later (build 4 has no 15-second limit and writes no such row). A sign-in left on the sheet past 15 seconds writes a row in `app_errors`, with `No answer yet, app inactive` the first time in each run of the app, or with `app active` every time. With `app active`, nothing tells that sheet from a silent Apple, and a deletion would go on with someone still on it, so leave the switch off.
4. Otherwise turn it on, so deleting an account on an iPhone or iPad asks Apple for a fresh code first:

   ```sh
   npx supabase db query --linked "update public.app_config set apple_revocation = true"
   ```

   Closing Apple's sheet keeps the account. If the sheet fails, or gives no answer for 15 seconds with the app active and the app is still active 2 seconds later, the deletion goes on without the code, so that token stays unrevoked. The same goes when Apple takes more than 10 seconds to answer the server, for its two calls together, and the function's log says `apple revocation TimeoutError`.

5. Try it right away, on the same iPhone and iPad, signed in with Apple to a test account. The app reads the switch when it starts and then every hour, and one that hasn't read it yet deletes without asking Apple, so close the app and open it again first. On each, Settings → Delete account → Delete for good, stay on Apple's sheet past 20 seconds, then close it: the account must still be there. Then delete it for real: the function's log must show no `apple revocation` line, which would say where the revocation stopped. If a check fails, turn the switch off again:

   ```sh
   npx supabase db query --linked "update public.app_config set apple_revocation = false"
   ```

## 7. Dependency warnings

`npm audit --omit=dev` lists about 20 warnings, checked on 2026-09-28:

- Almost all are in the build tools (`@expo/config-plugins`, `xcode`, and `@bacons/xcode` with an old `@xmldom/xmldom` and `uuid`). They read and write this project's own native config files while building, never input from users, so the XML injection and slow-parsing issues have no way in. Forcing newer copies breaks `@bacons/xcode` (it needs `@expo/plist` 0.0.x, which needs the old xmldom), so these wait for Expo and `@bacons/apple-targets` updates.
- One reaches the app: `decode-uri-component` through expo-router's `query-string` decodes a malformed link slowly, so a crafted link could at most make the app slow while it opens. The fixed version is ES modules only and doesn't load in `query-string` 7, so it waits for expo-router.

Run the audit again after every Expo SDK upgrade.

## 8. Sign in with Apple in the browser

On iPhones and iPads the app signs in with Apple's own sheet. Where that sheet fails (App Review once couldn't sign in on an iPad), the welcome screen can also offer Apple's sign-in page in the browser. It needs the Apple provider set up for the web:

1. Apple Developer → Certificates, IDs & Profiles → Identifiers → + → Services IDs, for example `app.gozali.web`. Turn on Sign in with Apple and configure it: primary App ID `app.gozali`, domain `<project-ref>.supabase.co`, return URL `https://<project-ref>.supabase.co/auth/v1/callback`.
2. Generate the client secret for the Services ID from a key with Sign in with Apple for `app.gozali` (the key from section 6 will do), with the tool in Supabase's guide to Apple sign-in. Apple lets a secret live six months at most, so put a reminder in the calendar to generate the next one.
3. Auth → providers → Apple: put the Services ID first in the client IDs, before `app.gozali` (the browser sign-in uses the first one, the native sign-in accepts any of them), and paste the secret into the secret key field. Continue with Apple on Android works from here on, because it always uses the browser.
4. Turn on the fallback for iPhones:

   ```sh
   npx supabase db query --linked "update public.app_config set apple_web_sign_in = true"
   ```

   The button shows only after Apple's sheet failed, was closed or gave no answer for 15 seconds, under Continue with Apple.
