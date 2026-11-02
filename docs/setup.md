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

4. Secrets for the functions. `CRON_SECRET` is any long random string; `EXPO_ACCESS_TOKEN` is optional (Expo push security); `RESEND_API_KEY` and `REPORT_EMAIL` send report alerts (without them reports only reach the function log):

   ```sh
   npx supabase secrets set CRON_SECRET=<random> EXPO_ACCESS_TOKEN=<token> RESEND_API_KEY=<key> REPORT_EMAIL=<your email>
   ```

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
8. The email code template (`supabase/templates/sign_in_code.html`) is only for the development login; it can stay off in production.

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

     Repeat for `preview` and `production`.
   - Firebase → Project settings → Service accounts → Generate new private key, then `eas credentials` → Android → Push Notifications (FCM V1) and upload that key. Keep the key file out of the repo too.

## 3. gozali.app

1. Register the domain.
2. Build the site with the real values and deploy it. `web/wrangler.jsonc` serves `web/dist` as Cloudflare static assets (they read `_redirects` and `_headers`) on the gozali.app domain, which has to be in the same Cloudflare account:

   ```sh
   APP_STORE_URL=<app store link> PLAY_STORE_URL=<play store link> ANDROID_SHA256=<release key fingerprint> node web/build.mjs
   npx wrangler login
   cd web && npx wrangler deploy
   ```

   The Android fingerprint is in `eas credentials` (Android → keystore). Once the app is on Google Play, use the one under the app signing key in the Play Console's App signing page instead: Play signs what it delivers with its own key, and the upload key's fingerprint doesn't match the app on people's phones. Without a real fingerprint the build refuses to run, because the invite links would open the browser instead of the app. `node web/build.mjs --preview` needs none of these values and builds into `web/dist-preview`, which is never deployed, to look at the pages. The landing page shows a store button only for the store URLs that are set. Until the app is in the App Store, `APP_STORE_URL` can be the TestFlight invite link.
3. The site has the privacy policy (/privacy), the terms (/terms) and the support page (/support) that App Store Connect asks for. Mail to hello@gozali.app is forwarded by Cloudflare Email Routing.
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

The success numbers of spec sections 1 and 15 (active packs, active packs 14 days after they were created, pack size, and invited users who opened a pack of their own):

```sh
npx supabase db query --linked "select public.pilot_metrics()"
```

The daily summary on your phone already counts failed function calls, failed scheduled jobs, outages and packs behind on closing days. When something else broke for a while (sign-in or storage down while the functions ran), add it as an outage so the pack days it covered can't fail; days already closed stay as they were:

```sh
npx supabase db query --linked "insert into public.outages (starts_at, ends_at, note) values ('2026-10-01 08:00+03', '2026-10-01 14:00+03', 'storage down')"
```

Plan limits: the summary adds "📦 612 MB of files (free plan: 1 GB)" once this project's stored files reach 500 MB. Egress and database size can't be read that way: they show only on the organization's Usage page, so look there every week. Supabase's own notice goes to the billing email and only after a quota is passed, so make sure that is an address you read. When the line shows up, the choice is Pro or keeping less. After a move to Pro, change the line in `summaryLine` (`supabase/functions/send-push/messages.ts`) or it shows every evening.

Is the server doing its jobs? The last closed day of every pack (a pack more than a day behind means close-days is failing for it), scheduled jobs that failed, and function calls that didn't answer 200, over the last day:

```sh
npx supabase db query --linked "select p.name, max(r.day) as last_closed from packs p left join day_results r on r.pack_id = p.id group by p.name order by 2 nulls first"
npx supabase db query --linked "select jobid, status, return_message, start_time from cron.job_run_details where status <> 'succeeded' and start_time > now() - interval '1 day'"
npx supabase db query --linked "select created, status_code, timed_out, error_msg, left(content::text, 200) from net._http_response where (status_code is distinct from 200) and created > now() - interval '1 day'"
```

Errors from members' phones (screens that failed to draw, JavaScript errors that closed the app, sent on the next start, and queued feeds that were dropped or got stuck) are kept for 30 days:

```sh
npx supabase db query --linked "select created_at, platform, app_version, screen, message from app_errors order by created_at desc limit 50"
```

A release goes out in this order:

1. `npx supabase db push`, at about :05 or :20 past the hour. Day closes run at :00, :15, :30 and :45, and a close or a settings save caught inside a migration's commit carries on with the old function.
2. `npx supabase functions deploy close-days send-push widget-state on-report delete-account`. The functions call what the migrations add, so deployed first they fail until the schema catches up.
3. The build. People get the new app last, so it finds the server it was made for.
4. The site, when `web/`, `docs/legal` or `docs/support.md` changed (section 3). Nothing else publishes them, so the live pages stay behind the repo until this runs.

A fix that touches only JavaScript reaches the installed apps without a new build or a store review, through EAS Update. Each build profile has its own channel, and the runtime version is the app version in `app.json`, so an update only goes to builds of that version:

```sh
cd apps/mobile
eas update --channel production --environment production --clear-cache --message "Fix the monthly board"
```

Both flags are required. Without `--environment` the CLI bundles `apps/mobile/.env`, which points at the local stack, and without `--clear-cache` Metro can reuse a bundle with an old `EXPO_PUBLIC_*` value inlined, because its cache doesn't look at those values. Either way every installed phone gets an app that calls `127.0.0.1`.

A change to native code (a new native package, app.json plugins, the widgets) needs a new build instead, and a new `version` in `app.json` first, so updates for the old builds and the new ones stay apart. (A fingerprint of the native code would do this by itself, but it came out different on Windows and on the EAS servers and failed the build.)

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

A run that saved its file leaves a heartbeat in the project (`heartbeats`, job `backup`), and the daily summary reads it: "💾 last backup 3 days ago" once the newest is two days old, so one missed night shows the next evening, and "💾 no backup yet" until the first one reports. `backup.log` and Task Scheduler's Last Run Result say why it stopped.

To restore after a disaster: create a new project, link it and `npx supabase db push` the schema, then `node scripts/restore.mjs "<backup file>"`, and set the Vault values and function secrets again (section 1). The restore refuses a project that already has data. A backup reads one table after another while people use the app, so a row can be in it without its parent, like a reaction to a feed posted after `feeds` was read. The restore skips such a row, and it prints how many it skipped per table and in total at the end. When the skipped row was a pack's admin, the role passes to the longest-standing member, as it does when an admin's account goes. A pack made while the backup ran can be in it without its critter, and no day of such a pack can close, so the restore leaves it out with everything it holds and prints which packs. A pack from before the backup can't lose its critter that way: the restore keeps it and prints it, and before people use the project it needs its row in `critters` back by hand, from an older backup. Accounts deleted after the backup was taken come back with it, and the privacy policy says they are deleted again: before people use the restored project, delete every account the old project no longer has, in Auth → Users, which takes its rows with it. Compare the backup's `auth.users` with the old project, or with its Auth logs, for as long as they can still be read. Try it on the local stack first: `node scripts/backup.mjs --local`, `npx supabase db reset`, then the restore with `--local`.

## 6. Sign in with Apple revocation

Apple asks apps with Sign in with Apple to revoke the user's tokens when they delete their account. The code is ready and waits for a key:

1. In Apple Developer → Certificates, IDs & Profiles → Keys, create a key with Sign in with Apple, configured for `app.gozali`, and download the `.p8` file (it can be downloaded once).
2. Put it in the function secrets, typing the values yourself (the key ID is on the key's page):

   ```sh
   npx supabase secrets set APPLE_TEAM_ID=3DYA8J45VJ APPLE_KEY_ID=<key id> APPLE_PRIVATE_KEY="$(cat AuthKey_<key id>.p8)"
   ```

3. Turn it on, so deleting an account on an iPhone asks Apple for a fresh code first:

   ```sh
   npx supabase db query --linked "update public.app_config set apple_revocation = true"
   ```

   Closing Apple's sheet keeps the account. If the sheet fails, or gives no answer for 15 seconds with the app active, the deletion goes on without the code, so that token stays unrevoked. The same goes when Apple takes more than 10 seconds to answer the server, for its two calls together, and the function's log says `apple revocation TimeoutError`. Before turning this on, try it on an iPhone: stay on the sheet past 15 seconds, then close it. The account must still be there.

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
