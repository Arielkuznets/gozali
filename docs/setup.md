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
   - **Apple:** an App ID with Sign in with Apple (bundle id `app.gozali`), a Services ID, and a key; paste them into the Apple provider. Add the bundle id to the provider's client IDs for native sign-in.
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

   The Android fingerprint is in `eas credentials` (Android → keystore). The landing page shows a store button only for the store URLs that are set. Until the app is in the App Store, `APP_STORE_URL` can be the TestFlight invite link.
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

Is the server doing its jobs? The last closed day of every pack (a pack more than a day behind means close-days is failing for it), scheduled jobs that failed, and function calls that didn't answer 200, over the last day:

```sh
npx supabase db query --linked "select p.name, max(r.day) as last_closed from packs p left join day_results r on r.pack_id = p.id group by p.name order by 2 nulls first"
npx supabase db query --linked "select jobid, status, return_message, start_time from cron.job_run_details where status <> 'succeeded' and start_time > now() - interval '1 day'"
npx supabase db query --linked "select created, status_code, timed_out, error_msg, left(content::text, 200) from net._http_response where (status_code is distinct from 200) and created > now() - interval '1 day'"
```

Errors from members' phones (screens that failed to draw, and JavaScript errors that closed the app, sent on the next start) are kept for 30 days:

```sh
npx supabase db query --linked "select created_at, platform, app_version, screen, message from app_errors order by created_at desc limit 50"
```

A fix that touches only JavaScript reaches the installed apps without a new build or a store review, through EAS Update. Each build profile has its own channel, and the runtime version is the app version in `app.json`, so an update only goes to builds of that version:

```sh
cd apps/mobile
eas update --channel production --message "Fix the monthly board"
```

A change to native code (a new native package, app.json plugins, the widgets) needs a new build instead, and a new `version` in `app.json` first, so updates for the old builds and the new ones stay apart. (A fingerprint of the native code would do this by itself, but it came out different on Windows and on the EAS servers and failed the build.)
