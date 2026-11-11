# KTEQ Website — Claude Code Project Context

## What This Is

This is the source code for kteq.org, the website for KTEQ-FM 91.3, a student-run college radio station at South Dakota Mines in Rapid City, SD. The station has been on the air since 1971 and is currently running a "(Re)Discover KTEQ" 55th anniversary campaign leading to a grand reopening in September 2026.

## Stack

- **Vite + Vue 3** (Composition API, `<script setup>` syntax)
- **Vue Router** with hash history (`/#/path`) for GitHub Pages compatibility
- **Pinia** for state management
- **Tailwind CSS v4** (using `@theme` directive in `src/assets/css/main.css`)
- **TypeScript**
- **Deployed to GitHub Pages** via GitHub Actions on push to main

There is no backend server. All content is stored as JSON files in `content/` and imported at build time. The admin panel writes to these files via the GitHub Contents API.

## Key Architecture Decisions

### The repo is the database
All content lives in `content/*.json`. The Vue admin panel at `/#/admin` reads and writes these files through the GitHub API using a Personal Access Token. Saves commit directly to the repo, triggering a GitHub Pages rebuild (~60 seconds).

### Persistent audio player
The player lives in `App.vue` outside `<RouterView>` so the audio stream survives navigation. The `Audio` element is a singleton managed by the `player` Pinia store — never re-instantiated.

### Stream sources
`content/settings.json` holds two streams and a manual switch:

- `streams.aiir` — Aiir Streaming (hosted Icecast), `https://stream.aiir.com/0gmznstk33kuv`. The normal source. Always store this base address; Aiir redirects it to a tokenized address that expires within minutes.
- `streams.local` — the station's own Icecast via the Cloudflare Worker (`https://kteq-proxy.kteq.workers.dev`). Backup only.
- `streamSource` — `"aiir"` or `"local"`, switched by hand in Admin → Settings.
- `metadataUrl` — the Worker's `/metadata` route. The player calls it with `?source=aiir|local` so titles come from the same stream the listener hears.

There is deliberately no automatic failover: the two streams run at different delays. `activeStream()` in `src/stores/player.ts` is the single place that picks the URL. The Worker source is in `worker/` and deploys separately through Cloudflare, not with the site.

### Campaign phase system
A `campaignPhase` value in `content/settings.json` drives conditional rendering across the site. "(Re)Discover KTEQ" is the internal campaign name; the public-facing messaging differs per phase:

- `"rediscover"` (current) — "Still Here. Still Weird." Summer 2026. Social media handles chronological anniversary storytelling; the website invites alumni to share memories. Primary CTA is a bot-proofed mailto link.
- `"kteqlive"` — "Welcome Back!" Late August through homecoming. Welcomes students back to campus, previews return to live broadcasts, countdown to Sept 25 reopening.
- `"kteq100"` — "Black Hills Alternative Radio." Post-campaign standard ops. By now, collected history content is built out so "Explore Our History" is a real CTA. Named for KTEQ's 100th anniversary (2071) as the long-term horizon.

The CTA system supports three action types: `'play'` (starts the stream), `'mailto'` (opens email), and route-based links. See `src/composables/useCampaignPhase.ts` for the full implementation, documentation, and the bot-proofed mailto assembly.

### No Aiir API integration yet
The station uses Aiir/PlayoutONE Pro for automation and scheduling, but the website currently does NOT connect to Aiir's APIs. Schedule and show data is maintained manually in JSON. This may change in the future when the Aiir Platform CMS subscription question is resolved. The "now on air" display is schedule-based (looks up current show from schedule.json by day/time).

### GitHub target
Repository: `KTEQFM/kteq-webapp` on github.com, in the university's GitHub Enterprise account (SSO). The `useGitHub` composable at `src/composables/useGitHub.ts` has `OWNER` and `REPO` constants. The previous version of the site is `radonjaws/kteq-web55`, which serves kteq.org until the custom domain moves here.

## Brand & Design

### Colors
The brand yellow is `#FCEB00` — defined as `--color-kteq-yellow` in `src/assets/css/main.css` under the `@theme` block. ALL color values are defined there as CSS custom properties and used via Tailwind classes (`text-kteq-yellow`, `bg-kteq-dark`, etc.). Never hardcode hex values in components.

Full palette:
- `kteq-black` (#0a0a0a) — primary background
- `kteq-void` (#111111) — section/card alternate background
- `kteq-dark` (#1a1a1a) — card/panel backgrounds
- `kteq-gray` (#2a2a2a) — borders, subtle dividers
- `kteq-muted` (#6b6b6b) — secondary text
- `kteq-light` (#d4d4d4) — primary text
- `kteq-white` (#f0f0f0) — headings, emphasis
- `kteq-yellow` (#FCEB00) — primary accent, CTAs, links
- `kteq-yellow-bright` (#FDEF4D) — hover states
- `kteq-yellow-dim` (#C4B800) — muted accent
- `kteq-red` (#e63946) — on-air indicator, errors
- `kteq-green` (#2ec466) — success states

### Typography
- Display/headings: `font-display` → Space Grotesk
- Body: `font-body` → DM Sans
- Mono/technical: `font-mono` → JetBrains Mono
- Loaded from Google Fonts in `index.html`

### Design Tone
Dark theme. The station identity is scrappy, independent, not corporate. Design should feel intentional but not overly polished — think college radio, underground culture, the kind of station that hosted Green Day before anyone knew who they were. Yellow on black is the signature look.

### Interactive States
Links and interactive elements use `kteq-yellow` by default and should shift to `kteq-yellow-bright` on hover. The transition should be `transition-colors` with Tailwind's default duration (150ms). Cards and bordered elements use `border-kteq-gray/30` at rest and `border-kteq-yellow/30` on hover for a subtle yellow warmth effect.

## File Layout

```
content/                 ← "the database" — JSON content files
  settings.json          ← stream URL, campaign phase, banner, socials
  schedule.json          ← weekly programming grid by day
  shows.json             ← show directory
  djs.json               ← DJ profiles
  timeline.json          ← 55th anniversary timeline entries
  posts/*.json           ← blog posts, one file per post

src/
  App.vue                ← root: header + router-view + player + footer
  main.ts                ← app bootstrap
  assets/css/main.css    ← Tailwind v4 @theme, base styles, animations
  router/index.ts        ← all routes + admin guard
  stores/
    player.ts            ← audio playback singleton
    content.ts           ← all JSON content loaded at build time
  composables/
    useNowOnAir.ts       ← schedule-based current show lookup
    useCampaignPhase.ts  ← phase logic, hero config, countdown
    useGitHub.ts         ← GitHub Contents API CRUD for admin
  components/
    player/AudioPlayer.vue      ← persistent bottom bar
    common/SiteHeader.vue       ← nav + listen button
    common/SiteFooter.vue       ← links, FCC info, social
    common/AnnouncementBanner.vue
    campaign/CampaignHero.vue   ← phase-aware homepage hero
    schedule/                   ← (empty, grid is in SchedulePage for now)
    timeline/                   ← (empty, timeline is in HistoryPage for now)
    blog/                       ← (empty, blog components are in pages for now)
    admin/                      ← (empty, admin editor components to be built)
  pages/
    HomePage.vue         ← campaign hero + on air now + recent content
    ListenPage.vue       ← big play button + now on air + other listening options
    SchedulePage.vue     ← weekly grid with mobile day-tab view
    ShowsPage.vue        ← show directory
    ShowDetailPage.vue   ← individual show page
    DjsPage.vue          ← DJ directory
    DjDetailPage.vue     ← individual DJ profile
    HistoryPage.vue      ← interactive vertical timeline
    BlogPage.vue         ← blog listing
    BlogPostPage.vue     ← individual post with Markdown rendering
    DonatePage.vue       ← fundraising page with CARA link
    admin/
      AdminLogin.vue     ← PAT entry, token verification
      AdminDashboard.vue ← section links
      Admin*.vue         ← editor stubs (to be built out)
```

## What Needs Work

### Priority 1: Visual Polish
- Hover states throughout — ensure all interactive elements have visible hover feedback using the `kteq-yellow-bright` / `border-kteq-yellow/30` patterns
- Page transitions (Vue Router transition wrapper)
- The schedule grid needs better visual weight for the "on air now" slot
- Mobile responsiveness pass — especially the schedule grid and timeline
- The listen page big play button could use more visual presence
- Consistent spacing between sections across all pages

### Priority 2: Admin Panel Editors
The admin section at `/#/admin` has a working login flow (GitHub PAT verification) and dashboard, but the individual editors are stubs. Each needs a form UI that loads content via `useGitHub().getContent()`, presents editable fields, and saves via `useGitHub().save()`. Build in this order:

1. **Settings editor** (`AdminSettings.vue`) — campaign phase dropdown, stream URL, banner text, social links. Simplest CRUD, good starting point.
2. **Shows editor** (`AdminShows.vue`) — list existing shows, add/edit/deactivate. Form fields matching the show schema in shows.json.
3. **DJs editor** (`AdminDjs.vue`) — same pattern as shows. Include cross-reference UI for linking DJs to shows.
4. **Schedule editor** (`AdminSchedule.vue`) — visual grid or list editor for time slots per day. Dropdown to select show slug. This is the most complex editor.
5. **Timeline editor** (`AdminTimeline.vue`) — list entries, add/edit. Year, title, description, category dropdown, image path.
6. **Blog post editor** (`AdminPosts.vue` / `AdminPostEdit.vue`) — list posts, create new, edit existing. Markdown editor with live preview for the body field.

Each admin editor page should follow the existing layout pattern: admin header bar (with "K" logo linking to `/admin`, section title, "← Dashboard" link), then content area. See `AdminDashboard.vue` for the header template.

The `useGitHub` composable (`src/composables/useGitHub.ts`) already implements:
- `getContent(path)` → returns `{ content, sha }`
- `putContent(path, content, sha, message)` → commits update
- `createContent(path, content, message)` → commits new file
- `deleteContent(path, sha, message)` → removes file
- `listContent(path)` → lists directory contents
- `save()` helper with loading/error state management

### Priority 3: Component Extraction
Some pages have components inline that should be extracted:
- Schedule grid → `components/schedule/ScheduleGrid.vue`
- Timeline → `components/timeline/Timeline.vue`, `TimelineEntry.vue`
- Blog post card → `components/blog/PostCard.vue`

### Someday / Maybe
- Icecast metadata proxy for live track info (requires Cloudflare Worker update)
- Image upload in admin panel (GitHub API base64 commit for small images)
- Search functionality across shows/posts/timeline
- RSS feed for blog posts

## Content Schemas

See `ADMIN-MANUAL.md` in the repo root for complete field documentation. The key schemas are defined in `src/stores/content.ts` as TypeScript interfaces.

## Running Locally

```bash
pnpm install
pnpm dev        # → http://localhost:5173
pnpm build      # production build to dist/
```

Admin panel testing requires a GitHub PAT with Contents read/write access to the `KTEQFM/kteq-webapp` repo, authorized for KTEQFM SSO. Enter it at `/#/admin/login`.
