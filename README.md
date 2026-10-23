# OmniTube

**A creator-first video and live platform.** OmniTube combines long-form playback, vertical Shorts, community posts, realtime streams, discovery, following, comments, reactions, reposts, playlists, notifications, and creator studio workflows in one React + TypeScript application backed by Supabase.

## Current architecture

- **Web:** React 19, TypeScript strict mode, Vite, Lucide icons, responsive dark UI.
- **Identity:** Supabase Auth magic links and persistent PKCE browser sessions.
- **Data:** PostgreSQL tables with owner-aware row-level security; profiles are provisioned on signup; notification and view-count triggers live in the private database schema.
- **Media:** Private Supabase Storage bucket for original video, public bucket for thumbnails/assets, TUS resumable uploads for large media, server-authorized short-lived playback URLs, and an authenticated publish function.
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
\`\`\`

\`resolve-playback\` disables gateway-level JWT verification because it also supports anonymous playback of public videos; it manually validates signed-in identity before granting access to private media. \`publish-video\` and \`livekit-token\` require authentication.

Supabase provides server-side runtime configuration for its internal URL and service-role key. Those credentials must stay server-only. Set LiveKit credentials in Edge Function secrets, never in the web build:

\`\`\`bash
npx supabase secrets set LIVEKIT_API_KEY=YOUR_LIVEKIT_API_KEY LIVEKIT_API_SECRET=YOUR_LIVEKIT_API_SECRET
\`\`\`

Set \`VITE_LIVEKIT_URL\` to the connection URL given by your LiveKit service. A broadcast token cannot make LiveKit work without an actual LiveKit deployment and valid server credentials; the app reports this configuration requirement rather than faking a live connection.

## 4. Auth and email

Enable email OTP / magic-link sign-in in Supabase Auth. Set the Auth Site URL to your deployed site and allow your local development origin (normally \`http://localhost:5173\`) under redirect URLs. Configure sender/SMTP and rate limits appropriate for your audience. Verify the email link flow after setting up your domain.

## 5. Production-readiness checklist

Before launch, complete and verify these environment-dependent operations:

- Configure production web hosting, domain, HTTPS, CSP, security headers, and environment secrets.
- Enable and test email delivery, abuse/rate limits, CAPTCHA or bot protection, account deletion and data-export policies.
- Configure LiveKit, signaling/egress where needed, recording/replay and billing limits. LiveKit credentials are not included in this repository.
- Add a media transcoding pipeline (multi-bitrate HLS/DASH, thumbnails, moderation scans, duration/dimension checks, and safe transcoding) for large-scale adaptive streaming. Current upload flow stores original media and supports authorized playback; it is not an adaptive transcoding farm.
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
- Private media playback via short-lived signed URLs.
- Likes, creator follows, reposts, threaded-ready comments, views/watch history, Watch later playlists, community text posts, notification records, reporting schema, and channel-membership data model.
- Live rooms with LiveKit token issuance, camera/microphone controls, and a scheduled/live room data model.
- Responsive accessible UI, loading states, no-content states, errors surfaced to the user, and build verification.

## License

No open-source license has been granted by this repository yet. Add a license file before redistributing or accepting external contributions under an open-source license.