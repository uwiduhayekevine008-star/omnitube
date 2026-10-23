# OmniTube

**A creator-first video and live platform.** OmniTube combines long-form playback, vertical Shorts, community posts, realtime streams, discovery, following, comments, reactions, reposts, playlists, notifications, and creator studio workflows in one React + TypeScript application backed by Supabase.

## Current architecture

- **Web:** React 19, TypeScript strict mode, Vite, Lucide icons, responsive dark UI.
- **Identity:** Supabase Auth magic links and persistent PKCE browser sessions.
- **Data:** PostgreSQL tables with owner-aware row-level security; profiles are provisioned on signup; notification and view-count triggers live in the private database schema.
- **Media:** Private Supabase Storage buckets for original video and per-video thumbnails, a public bucket for creator avatars/general assets, TUS resumable uploads for large media, RLS-authorized short-lived playback/thumbnail URLs, and an authenticated publish function.
- **Live:** LiveKit browser SDK with server-minted, room-scoped tokens. Live media requires your own LiveKit endpoint and server credentials.
- **Quality:** TypeScript typecheck and production build in GitHub Actions.

## Repository layout

\`\`\`text
src/
  App.tsx
  main.tsx
  styles.css
  lib/supabase.ts
supabase/
  config.toml
  migrations/
  functions/
    resolve-playback/
    publish-video/
    livekit-token/
.github/workflows/ci.yml
.env.example
\`\`\`

## Native mobile app (Expo)

A React Native / Expo SDK 58 app now lives at [`apps/mobile`](apps/mobile/README.md). It includes native Discover with personalized ranking and Following feed, vertical swipe Shorts, Community posts, Creator Studio with resumable uploads, LiveKit rooms/chat, creator channels and analytics, secure video playback, comments/reactions/reposts, Watch later/history, reporting, realtime/push notifications, and device privacy/playback settings.

To start the Expo project:

```bash
cd apps/mobile
npm install
cp .env.example .env.local
npm run typecheck
npm run start
```

LiveKit uses native WebRTC and requires a development client or store build rather than Expo Go. See the [mobile setup guide](apps/mobile/README.md) for Android/iOS builds, environment values, EAS setup, and provider requirements. GitHub Actions verifies TypeScript and production exports for the web and Expo Android bundle, checks Expo SDK package compatibility, and runs Expo Doctor.

## 1. Configure the app locally

Requires Node.js 22 LTS or a compatible Node.js 20.19+ release.

\`\`\`bash
git clone https://github.com/uwiduhayekevine008-star/omnitube.git
cd omnitube
npm install
cp .env.example .env.local
\`\`\`

Set your Supabase **project URL** and **publishable** API key in \`.env.local\`. The publishable key is intended for a browser app. Never put a service-role or secret key in \`VITE_*\` variables, source control, or browser code.

\`\`\`dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
VITE_LIVEKIT_URL=wss://YOUR_LIVEKIT_HOST
\`\`\`

Start the development server:

\`\`\`bash
npm run dev
\`\`\`

Run checks:

\`\`\`bash
npm run typecheck
npm run build
npm run preview
\`\`\`

A missing browser configuration produces a setup screen instead of seeding a fictional feed. Once configured, discovery reads real database records and shows an intentional empty state until creators publish content.

## 2. Database

The SQL migrations in \`supabase/migrations\` are versioned deployment artifacts. They describe profiles, videos, posts, follows, reactions, reposts, comments, video-view history, playlists, live streams, stream chat messages, notifications, reports, channel memberships, storage buckets, and RLS policies.

The schema migration has already been applied to the connected project. If applying the source migrations in another Supabase project, first configure the Supabase CLI and link the intended project; review the SQL and confirm your target before deploying any database change.

\`\`\`bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
\`\`\`

The videos bucket is **private**. Do not make original uploads public to simplify playback. The playback Edge Function checks the caller/content visibility and issues a short-lived signed URL; the publish function verifies ownership and stored-object metadata before changing a video into its published state.

## 3. Deploy the Edge Functions

Deploy the functions to the **same** project referenced by \`VITE_SUPABASE_URL\`. Use the Supabase CLI or the Edge Functions deploy action:

\`\`\`bash
npx supabase functions deploy resolve-playback --no-verify-jwt
npx supabase functions deploy publish-video
npx supabase functions deploy livekit-token
npx supabase functions deploy delete-video
npx supabase functions deploy retry-media-processing
\`\`\`

\`resolve-playback\` disables gateway-level JWT verification because it also supports anonymous playback of public videos; it manually validates signed-in identity before granting access to private media. \`publish-video\` and \`livekit-token\` require authentication.

Supabase provides server-side runtime configuration for its internal URL and service-role key. Those credentials must stay server-only. Set LiveKit credentials in Edge Function secrets, never in the web build:

\`\`\`bash
npx supabase secrets set LIVEKIT_API_KEY=YOUR_LIVEKIT_API_KEY LIVEKIT_API_SECRET=YOUR_LIVEKIT_API_SECRET
\`\`\`

Set \`VITE_LIVEKIT_URL\` to the connection URL given by your LiveKit service. A broadcast token cannot make LiveKit work without an actual LiveKit deployment and valid server credentials; the app reports this configuration requirement rather than faking a live connection.

## 4. Web deployment on Netlify

The root `netlify.toml` is configured for the Vite single-page app: `npm run build`, publish directory `dist`, Node.js 22, client-side route fallback, safe browser headers, and immutable caching for fingerprinted assets.

To enable real continuous deployment, connect this GitHub repository to a new Netlify project and use `main` as the production branch. Set these **site environment variables** in Netlify's UI before the first build:

- `VITE_SUPABASE_URL`: the URL of the authorized production Supabase project.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: that project's public `sb_publishable_...` key.

These values are public build-time configuration, not server secrets. Never put `SUPABASE_SERVICE_ROLE_KEY`, LiveKit API secrets, push provider credentials, or any privileged key in `VITE_*` variables. The Supabase URL and publishable key must belong to the same project as the deployed database schema and Edge Functions. Build output created without valid values intentionally reports an unconfigured backend instead of simulating success.

The repository is prepared for Netlify builds, but a successful deployment still requires connecting it to a Netlify site and authorizing the intended Supabase project. A Netlify site connection and a live production deploy are not inferred from the presence of `netlify.toml`.

## 5. Adaptive video delivery and media-worker operations

Newly published videos are queued in the private `media_processing_jobs` table. The worker in `services/media-worker` downloads the owner-scoped source from private storage, validates dimensions and duration with `ffprobe`, creates H.264/AAC HLS renditions with FFmpeg (360p and higher profiles when the source supports them), writes a master manifest, uploads segments/manifests to the private `omnitube-renditions` bucket, and marks the video media state `ready`. The web player uses HLS.js where native HLS is not available; Expo Video receives explicit HLS content type on native playback. Until a rendition is ready, playback authorization can return a short-lived signed URL for the original file.

Apply and review the SQL migrations before deploying the new data model or Edge Functions:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase functions deploy resolve-playback --no-verify-jwt
npx supabase functions deploy publish-video
npx supabase functions deploy livekit-token
npx supabase functions deploy delete-video
npx supabase functions deploy retry-media-processing
```

Run the worker as a separate long-running container on infrastructure with CPU, memory, local temporary disk, and outbound access to Supabase Storage. FFmpeg is included in its Docker image:

```bash
docker build -t omnitube-media-worker ./services/media-worker
docker run --restart unless-stopped --env-file /secure/path/omnitube-media-worker.env omnitube-media-worker
```

The environment file must be delivered by a secret manager and contain `SUPABASE_URL` and the **server-only** `SUPABASE_SERVICE_ROLE_KEY`; never commit it or place it in `VITE_*` or `EXPO_PUBLIC_*` variables. Tune the worker ID, polling interval, lease, attempt limit, source-size limit, maximum duration, and FFmpeg preset according to the actual host capacity. The worker emits structured JSON logs and retries failed jobs with bounded exponential backoff. Configure centralized logs, alerts, disk monitoring, queue-age alerts, worker replicas, resource limits, and capacity tests before public launch.

Verify a deployment with an authenticated account and a small permitted source video: the upload must appear in the private source bucket, a queue row must be created, worker logs must show a completed transcode, a private HLS manifest must be uploaded, and the public playback endpoint must return an HLS playback URL. Also test anonymous access to private media, visibility changes after ticket issuance, network failure/retry, corrupt input, worker restart, and deletion during processing. These live service checks are not performed by a source-code commit or GitHub CI alone.

## 6. Auth and email

Enable email OTP / magic-link sign-in in Supabase Auth. Set the Auth Site URL to your deployed site and allow your local development origin (normally `http://localhost:5173`) under redirect URLs. Configure sender/SMTP and rate limits appropriate for your audience. Verify the email link flow after setting up your domain.

 Set the Auth Site URL to your deployed site and allow your local development origin (normally \`http://localhost:5173\`) under redirect URLs. Configure sender/SMTP and rate limits appropriate for your audience. Verify the email link flow after setting up your domain.

## 7. Production-readiness checklist

Before launch, complete and verify these environment-dependent operations:

- Configure production web hosting, domain, HTTPS, CSP, security headers, and environment secrets.
- Enable and test email delivery, abuse/rate limits, CAPTCHA or bot protection, account deletion and data-export policies.
- Configure LiveKit, signaling/egress where needed, recording/replay and billing limits. LiveKit credentials are not included in this repository.
- The repository now includes an HLS transcode queue, FFmpeg worker, private rendition storage, signed manifest/segment delivery, and original-file fallback during processing. Configure, deploy, and verify the worker in a real environment; add a moderation/scanning pipeline, capacity autoscaling, lifecycle cleanup for orphaned renditions, CDN strategy, and load testing before operating at global scale.
- Configure backups/PITR, retention, observability, log redaction, incident response, content moderation, copyright/takedown handling, and report-review operations.
- Add signed payment-provider webhooks before enabling paid memberships; membership records do not by themselves charge a customer or validate a payment.
- Run end-to-end security tests under anon, user A, user B, and service roles; check RLS, signed URLs, private/unlisted visibility, storage path ownership, and moderation transitions.
- Inspect Supabase Security and Performance Advisors after changes and resolve applicable warnings.

This is a real working foundation, not a claim that external streaming, transcoding, payments, email delivery, or web hosting have been provisioned by source code alone. Keep private keys out of the repository and browser.

## Security model

- All exposed app tables use row-level security.
- User-owned writes compare record ownership to \`auth.uid()\`.
- Original video files use private storage and short-lived signed playback URLs.
- Server functions independently validate the caller before accessing privileged service APIs.
- Verified/published video state is controlled by the trusted publisher function, not a browser client.
- Database trigger helpers are placed in the non-exposed \`omnitube_private\` schema and have execute privileges revoked from public roles.
- Do not trust user-editable metadata for elevated authorization and do not ship service-role keys to clients.

## Features included

- Magic-link sign-in and automatically created creator profile.
- Real discovery and trending feeds, title/description search, vertical Shorts selection, and following feed.
- Video upload form with direct TUS/resumable upload and upload progress, category, visibility, duration metadata, and optional custom thumbnail.
- Private media playback via short-lived signed URLs, owner/visibility revalidation, and private adaptive HLS renditions with original-file fallback while transcoding is pending.
- Adaptive media worker (FFmpeg/ffprobe) with bounded profile selection, duration/size validation, retryable jobs, worker leases, structured logs, and idempotent media cleanup.
- Likes, creator follows, reposts, threaded-ready comments, views/watch history, Watch later playlists, community text posts, notification records, reporting schema, and channel-membership data model.
- Live rooms with LiveKit token issuance, camera/microphone controls, and a scheduled/live room data model.
- Responsive accessible UI, loading states, no-content states, errors surfaced to the user, and build verification.

## License

No open-source license has been granted by this repository yet. Add a license file before redistributing or accepting external contributions under an open-source license.