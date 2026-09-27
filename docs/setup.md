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

3. Deploy the functions. They import `packages/game-engine` and `packages/critter-art` from outside `supabase/functions` (decisions D13 and D16); if the deploy can't bundle them, copy the packages into `supabase/functions/_shared` and point the imports there.

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
   - **Google:** OAuth client IDs for iOS, Android and Web in Google Cloud; paste the Web client into the provider and add the others as authorized client IDs.
8. The email code template (`supabase/templates/sign_in_code.html`) is only for the development login; it can stay off in production.

## 2. EAS builds

1. `npm install -g eas-cli`, `eas login`, then in `apps/mobile`: `eas init`. This writes the project id into `app.json`, which push tokens need.
2. Put the Apple Team ID in `app.json` → `expo.ios.appleTeamId` (the widget target needs it).
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

## 3. gozali.app

1. Register the domain.
2. Build the site with the real values and deploy `web/dist` (Cloudflare Pages reads `_redirects` and `_headers`):

   ```sh
   APP_STORE_URL=<app store link> APPLE_TEAM_ID=<team id> ANDROID_SHA256=<release key fingerprint> node web/build.mjs
   ```

   The Android fingerprint is in `eas credentials` (Android → keystore). Until the app is in the App Store, `APP_STORE_URL` can be the TestFlight invite link.
3. Check `https://gozali.app/.well-known/apple-app-site-association` and `https://gozali.app/.well-known/assetlinks.json` load, then an invite link opens the installed app.

## 4. Before the pilot

- Phase 1 and 2 checks on two phones: sign in with Apple and Google, create a pack, join it from the other phone.
- The widgets on both platforms (they have only been built by EAS, never tried by hand).
- A day close on the cloud: the next morning, `select * from day_results order by closed_at desc` shows the night's results.
- Google Play closed testing needs at least 12 testers for 14 days in a row before publishing.
