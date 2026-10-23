# OmniTube Mobile (Expo)

The native Android/iOS client lives in `apps/mobile` and shares the production Supabase schema, policies, private Storage buckets, and Edge Functions with the web client.

## Requirements

- Node.js 22.13+ (Expo SDK 57 requirement)
- Android Studio + Android SDK for local Android builds, or Xcode on macOS for local iOS builds
- A physical device or emulator
- A LiveKit endpoint and server credentials only when you want real live-room broadcasts

## Install

From the repository root:

```bash
cd apps/mobile
npm install
cp .env.example .env.local
```

The example environment is prefilled with the Supabase project URL and public publishable key. Edit values in `.env.local` when using a different project.

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
EXPO_PUBLIC_LIVEKIT_URL=wss://YOUR_LIVEKIT_HOST
```

Never use a Supabase service-role key in `EXPO_PUBLIC_*`, application source, or a mobile bundle. Public mobile app settings are extractable by design.

## Start development

```bash
npm install
npm run typecheck
npx expo install --check
npm run start
```

LiveKit uses native WebRTC code and **cannot run inside Expo Go**. Build a development client after installing dependencies:

```bash
npx expo prebuild
npx expo run:android
# or, on macOS with Xcode:
npx expo run:ios
```

Then start Metro for the installed development client:

```bash
npm run start
```

## Build packages

Set up an Expo account and link the app before the first EAS build. Replace the setup marker in `app.json` with a valid EAS project ID after running `eas init`.

```bash
npx eas-cli login
npx eas-cli init
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform android --profile production
npx eas-cli build --platform ios --profile production
```

Publishing to Google Play/App Store requires the correct signing, store accounts, privacy declarations, icon/splash assets, data safety forms, and store metadata. The app source is committed; native binaries are not pre-built or published by this repository.

## Implemented mobile workflows

- Native tab navigation: Discover, Shorts, Community, Create, Live, You.
- Persistent Supabase Auth; email magic-link exchange via `omnitube://auth/callback`.
- Real discovery/trending/topic/search feeds with incremental loading.
- Vertical swipe Shorts with native video playback and secure signed playback URLs.
- Video details, reactions, creator follows, Watch later, reposts, comments and reporting.
- Community post creation, reactions, comments, sharing and moderation reports.
- Creator channels, profile editing, channel stats, and saved library.
- Native creator upload flow with resumable TUS upload, visibility/tags/category/comment options, thumbnail upload to private storage, and server-validated publishing.
- Notifications with real-time delivery and entity deep links.
- Live-stream directory, authenticated LiveKit room tokens, native track views, camera/microphone controls, and persisted real-time chat.

## Media and streaming notes

The original videos and per-video thumbnails remain private in Supabase Storage. The app requests short-lived playback URLs from the deployed playback function. Live rooms require `EXPO_PUBLIC_LIVEKIT_URL` plus `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` set as **server-side Supabase Edge Function secrets**.

The current native uploader intentionally limits files to 200 MB to avoid loading oversized mobile assets into memory. The web Creator Studio supports the larger 2 GB bucket limit. A production service operating at very large scale still needs transcoding into adaptive HLS/DASH renditions, thumbnails/poster generation, media moderation, egress/recording configuration, rate limiting, monitoring, backups, and end-to-end device testing.

## Commands

- `npm run typecheck` — TypeScript checks
- `npx expo install --check` — check installed packages against Expo SDK
- `npx expo export --platform android` — validate/export JavaScript and assets for Android
- `npx expo export --platform ios` — validate/export JavaScript and assets for iOS
- `npx expo-doctor` — diagnose project configuration and dependencies
