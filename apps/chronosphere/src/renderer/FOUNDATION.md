# Renderer foundation — contract sheet

For the three screen agents (LIBRARY → `library/`, DETAIL → `detail/`, FLOWS → `flows/`).
Replace your stub files; everything else here is owned by the foundation. Copy strings come
VERBATIM from `design-reference/app/copy.md`; layout ground truth is `screens.md`; binding
reconciliation decisions are in the build brief. TS strict + `exactOptionalPropertyTypes` are on.

## Files

```
api/client.ts        typed API client (never throws; ApiResult<T>)
lib/types.ts         DiskRow / DiskSubRow / DiskCounts / InstallState / TidyProposal
lib/reconcile.ts     buildDiskRows · archiveInstallState · diskHashSet · buildTidyProposals (pure, tested)
lib/format.ts        string patterns (meta lines, stars, KB, dates, chips)
state/store.tsx      StoreProvider + useStore()/useAppState()/useActions()
styles/app.css       every component class + tokens + keyframes (inventory below)
components/          TitleBar · StatusBar · ToastLayer · ActivityDrawer (shell — done)
App.tsx              shell composition, narrow mode (<1120px), global keyboard
```

## Store

`const { state, actions, api } = useStore()` — or `useAppState()` / `useActions()`.
`api` is the shared `ApiClient` (see `api/client.ts`) already wired to settings/token/connection.

### State shape (see `state/store.tsx` for full types)

- `phase: 'booting' | 'onboarding' | 'library'` · `bootError: string | null`
- `settings: ChronoSettings | null` (from `src/ipc.ts`; `easterEggs` defaults OFF)
- `connection: 'online' | 'offline'` · `authMode: 'unknown' | 'discord' | 'dev' | 'unreachable'`
- `session: { signedIn, handle, checking }`
- `archive: { items: MapCardDto[], total, page, loading, loadingMore, endReached, error, filters }`
  — `filters: { q, type, minPlayers(2|4|6|8|null), theater, team, size, sort }`
- `disk: { files: ScannedFile[], annotations: Map<hash, HashAnnotation>, rows: DiskRow[],`
  `counts: DiskCounts, hashes: Set<hash>, scanning, scanProgress: {done,total}|null, scanError,`
  `filters: { q, status: DiskStatusFilter, sort: DiskSort }, openGroups: Set<rowKey>, newFound }`
- `selection: { target: {pane,id}|null, multi: {pane,id}[], focusedPane }`
  — archive ids = `card.slug`; disk ids = `DiskRow.key` / `DiskSubRow.key`
- `detail: { tier, tab, detail: MapDetailDto|null, detailLoading, reviews: ReviewsBlockDto|null,`
  `reviewsLoading, reviewsSort }`
- `chronoshift: { running, items: ChronoshiftItem[], summary: BatchSummary|null }`
  — item: `{ key, slug, name, fileName, versionId, status: pending|downloading|verifying|done|failed, pct, error, verdict }`
- `contribute: { open, step: select|signin|consent|uploading|summary, checked: Set<hash>, uploads: ContributeUpload[] }`
  — upload: `{ contentHash, name, fileName, status, pct, resultStatus, resultMessage, error }`
- `tidy: { open, proposals: TidyProposal[], applying }`
- `reviewModal: { open, slug, mapName, step: signin|compose|submitting|success, rating, text, error }`
- `settingsModalOpen` · `activityDrawerOpen` · `toasts: ToastItem[]` · `activity: ActivityEntry[]`
- `nudgesDismissed: Set<contentHash>` · `storage: { quarantine: QuarantineSummary[], renderCacheBytes } | null`

### Actions (all on `useActions()`; async ones return Promises)

Boot/phase: `boot()` · `enterLibrary()` · `completeOnboarding(folderPaths: string[])` · `replayOnboarding()`
Connection: `retryConnection()`
Settings: `updateSettings(patch)` · `addGameFolder(path) → {ok,reason}` · `removeGameFolder(path)` ·
`setDefaultFolder(path)` · `autoDetectFolders() → string[]` · `setApiBase(url)` ·
`loadStorageInfo()` · `clearRenderCache()` · `emptyQuarantine()` · `restoreQuarantine(id)`
Session: `checkSession()` · `checkAuthMode() → AuthMode` · `devSignIn(handle) → boolean` · `signOut()`
Archive: `loadArchive(reset)` · `loadMoreArchive()` · `setArchiveFilters(patch)` (resets paging) · `clearArchiveFilters()`
Disk: `rescan(silent=false)` (manual rescan; toast+activity unless silent) · `dismissNewFound()` ·
`setDiskFilters(patch)` · `setDiskStatusFilter(status)` (also focuses disk pane — status bar uses it) ·
`toggleGroup(rowKey)`
Selection/detail: `select(pane, id)` (clears multi, loads detail+reviews, pops collapsed dock) ·
`toggleMulti(pane,id)` · `clearMulti()` · `focusPane(pane)` · `setDetailTier(tier)` · `setDetailTab(tab)` ·
`setReviewsSort('helpful'|'newest')`
Keyboard plumbing (register, don't implement keys yourself):
`registerVisibleIds(pane, ids: string[])` — the pane's CURRENT visible order (disk: include open sub-row keys);
`registerSearchEl(pane, el|null)`; `registerPrimaryAction({label, disabled, run} | null)` — detail agent keeps
this in sync with the context action matrix so global Enter works.
Chronoshift: `chronoshift(requests: {slug,name,fileName,versionId?}[])` — single & batch; sequential; real
per-item status; ends with silent rescan, success/partial toasts, selection moves to the landed row (single).
`clearChronoshiftSummary()`
Quarantine/tidy: `removeToQuarantine(paths, displayName?)` (Undo toast + rescan) · `openTidy()` (derives
proposals) · `closeTidy()` · `applyTidy()`
Contribute: `openContribute()` (candidates pre-checked, clears banner) · `closeContribute()` ·
`setContributeStep(step)` · `toggleContributeHash(hash)` · `continueContribute()` (signin gate) ·
`startContributeUpload()` (sequential; per-item progress + per-hash results; rescan on finish)
Reviews: `openReviewModal(slug, mapName)` · `closeReviewModal()` · `setReviewModalStep(step)` ·
`setReviewDraft({rating?, text?})` · `submitReview()` (requires rating ≥ 1) · `markHelpful(reviewId)`
Tags: `teamVote(slug, value: TeamLayout) → boolean` (refreshes open detail)
Nudges: `dismissNudge(contentHash)` (persisted)
Shell: `pushToast({kind, glyph?, title, sub?, actionLabel?, onAction?}) → id` · `dismissToast(id)` ·
`addActivity(glyph, text)` · `openSettingsModal()` / `closeSettingsModal()` · `toggleActivityDrawer()` /
`closeActivityDrawer()`

### Exported selectors/helpers (`state/store.tsx`, `lib/reconcile.ts`, `lib/format.ts`)

- `findDiskRow(rows, id) → { row, sub } | null` — resolves row OR sub-row selectable ids.
- `contributeCandidates(rows)` — unknown + moderation 'unknown' (never re-offers in-review/rejected).
- `shouldNudge(row, state.nudgesDismissed)` — known + identity + not dismissed. Chip: gold `review?` pip
  (`.nudge`), title/tooltip = `You’ve got {name} installed — review it?` (verbatim), echo the sentence as a
  line in the detail panel; `actions.dismissNudge(row.contentHash)` to dismiss.
- `archiveInstallState(card, state.disk.hashes) → 'none' | 'have' | 'newer'` — drives `✓ have` / `↑ newer`.
- `buildTidyProposals(rows)` — already called by `openTidy()`.
- `FLAVOR_LINES` — `install: 'Kirov reporting.'`, `scan: 'Battle control online.'`, `broken: 'Cannot deploy here.'`.
  Voice lines render as a **suffix on the relevant toast sub** (` · line`), only when `settings.easterEggs`
  (default OFF). The store already applies them for scan/chronoshift toasts.
- format.ts: `formatKb` ("312 KB") · `formatCount` ("24,900") · `formatCompact` ("24.9k") ·
  `formatDateMonth` ("Nov 2024") · `formatRelative` ("3 days ago") · `starString` · `formatRating` ·
  `typeLabel` (shared MAP_TYPE_LABELS — "Co-op mission", never short forms) · `teamLabel` ·
  `teamChipLabel` ("likely 2v2" + '' / ' ⓘ' / ' ⓘ?') · `sizeChipLabel` ("Medium · 130×130") ·
  `playersLabel` ("4P"/"Mission") · `authorLabel` · `healthChipLabel` ("● verified") · `healthWord` ·
  `archiveMetaLine(card)` · `diskMetaLine({membership, healthVerdict, maxPlayers, theater, mod?})` ·
  `folderTail` ("…/Yuri").

## DiskRow (lib/types.ts — read it; the short version)

`{ key, kind: 'single'|'dup'|'version-group', name, primary: ScannedFile, contentHash, membership:
'known'|'update'|'unknown', moderation: ModerationStatus, health: HealthReport, annotation, identity,
updateTarget: {slug,name,canonicalVersionId,canonicalHash,...}|null, dupCount, versionCount,
subRows: DiskSubRow[], folder, folders }`

Rules encoded: known = published AND canonical · update = published, not canonical (has `updateTarget`) ·
unknown = else (moderation sub-state on `moderation`). Dup collapse: primary = shortest filename.
Version group: represented by canonical > latest > newest-mtime; membership known iff canonical on disk.
`counts`: `known+unknown+update === total` (rows counted once); `broken` = rows with broken health;
`dup` = surplus exact copies. Flag chips: `versionCount > 1` → `{n} versions` (gold `.chip-flag-gold`);
`dupCount > 1` → `⧉ ×{n}` (`.chip-flag-neutral`); `updateTarget` → `→ {canonical}` (gold);
`moderation === 'in-review'` → `in review` (neutral).

## API client (`api/client.ts`)

`api.*` returns `ApiResult<T> = {ok:true,data} | {ok:false,error:{kind,status,message}}` — never throws.
8s timeout; failures flip the store's connection state automatically.
`getStats` · `listMaps(ArchiveQuery)` (perPage 24) · `getMapDetail(slug)` · `getReviews(slug,{sort,rating})` ·
`postReview(slug,{rating,text,versionId?})` · `markHelpful(reviewId)` · `teamVote(slug,value)` ·
`annotateHashes(hashes)` · `submitMap({bytes,fileName,name,notes?})` · `getContributors(sort?)` ·
`getContributor(handle)` · `downloadUrl(slug,versionId?)` · `getSession()` · `checkAuthMode()` ·
`devSignin(handle)` · `signout()` · `discordAuthUrl()`. Helper: `base64ToBytes(base64)`.
Sign-in UX: `checkAuthMode()` → `'dev'` ⇒ show the DEV-labeled path (`devSignIn(handle)`, label it
"DEV MODE"); `'discord'` ⇒ open `api.discordAuthUrl()` externally.

## IPC additions

`window.chrono.readFileBase64(path)` — bytes of a scanned map file for contribute upload; REFUSES paths
outside the configured game folders, non-map extensions, and files > 5 MB. Everything else per `src/ipc.ts`.

## Slot components (replace these stubs)

| Stub | Renders | Notes |
|---|---|---|
| `library/ArchivePane.tsx` `ArchivePane` (no props) | left pane | register visible slugs + search el; rows draggable (below) |
| `library/DiskPane.tsx` `DiskPane` (no props) | right pane | scan strip, banner, groups; register flat visible keys + search el; drop target |
| `detail/DetailPanel.tsx` `DetailPanel` (no props) | dock AND expanded overlay | single mount inside `.app-body`; `.detail-expanded` covers it; keep `registerPrimaryAction` current |
| `flows/OnboardingFlow.tsx` `OnboardingFlow` | full-screen z-40 | finish → `completeOnboarding(paths)` |
| `flows/SettingsModal.tsx` `SettingsModal` | modal | render null unless `state.settingsModalOpen` |
| `flows/ContributeModal.tsx` `ContributeModal` | modal | render null unless `state.contribute.open` |
| `flows/TidyModal.tsx` `TidyModal` | modal | render null unless `state.tidy.open` |
| `flows/ReviewModal.tsx` `ReviewModal` | modal | render null unless `state.reviewModal.open` |
| `flows/ChronoshiftLayer.tsx` `ChronoshiftLayer` | ghost + progress chip + failure summary + swap confirm | ghost skipped under reduced motion |

## Drag-and-drop (reconciliation #3)

Archive row: `draggable` + `e.dataTransfer.setData('application/x-chronosphere-map',
JSON.stringify({slug, name, fileName}))`. Disk pane: on dragover with that type, preventDefault + add
`drop-target` class to the pane `<section>`; on drop, parse and call `actions.chronoshift([payload])`.

## Keyboard (already global — don't rebind)

Esc closes outer-first (modals → expanded → drawer → multi) · `/` focuses the focused pane's registered
search · ↑/↓ move through the registered visible ids · Enter runs the registered primary action ·
Space toggles multi on the current target. Keys are suppressed while typing (except Esc); modals suppress
list keys.

## Chronoshift wiring notes

- Install: `actions.chronoshift([{slug, name, fileName: slug + '.map'}])`. Update flow: pass the identity's
  canonical (default `versionId` omitted = canonical download). Progress is honest-coarse per item
  (pending 0 → downloading 10 → verifying 80 → done 100); overall = mean; batch failures land in
  `state.chronoshift.summary` for the flows agent's partial-failure summary (decision #4).
- Broken replace (decision #6): confirm first — `This one’s broken. There’s a verified copy — swap it?`
  (primary SWAP IT / ghost cancel) → toast `Swapping in a verified copy…` → `chronoshift`.
- `data-arc="{slug}"` on archive rows and `data-disk-head` on the disk pane header are the ghost's
  start/end rects — keep those attributes.

## CSS class inventory (styles/app.css)

Tokens: `--void --chrome --well --surface-2 --surface --raised --row-hover --chrome-hover --hairline
--row-divider --line --line-strong --text-hi --text-mid --text-low --text-faint --text-quote --accent
--accent-pressed --on-accent --accent-light --gold --green --error --error-text --discord --mono-stack`.

Frame: `.app-root` (+`.narrow`, +`.reduced-motion`) · `.app-body` (positioning context for the expanded
overlay) · `.app-main`.
Type: `.micro` `.micro-dim` `.micro-label` `.mono` `.display-title` `.h-screen`.
Buttons: `.btn` + `.btn-primary/.btn-secondary/.btn-ghost/.btn-sm/.btn-cta` · `.btn-discord` ·
`.chrome-btn` (Tidy/Rescan/Activity) · `.icon-btn` (gear) · `.dock-icon-btn` · `.link`/`.link-dim`.
Inputs: `.input` · `.search-wrap`+`.search-glyph` · `.select-wrap`+`.select`(+`.select-wide`)+`.select-chevron` ·
`.toggle`(+`.on`)+`.toggle-knob`.
Chips: `.chip` + `.chip-mem-known/-update/-unknown` · `.chip-health-verified/-heavy/-broken/-needs-mod` ·
`.chip-facet` · `.chip-team` (dashed team suggestion) · `.chip-mod` · `.chip-have`/`.chip-newer` ·
`.chip-flag-gold`/`.chip-flag-neutral` · `.tag-installed/-canonical/-latest/-superseded` (with `.chip`) ·
`.chip-folder` · `.chip-verified-badge` · `.chip-contrib-badge` · `.chip-default-target`.
Glyph colors: `.glyph-mem-*` `.glyph-health-*` `.verified-star`.
Top bar: `.titlebar .brand .brand-pip .brand-name .brand-eyebrow .titlebar-spacer .folder-btn(-label/-value/-chevron)
.conn-btn(.online/.offline) .conn-dot .sync-spinner .spin`.
Status bar: `.statusbar .statusbar-seg(.active, .seg-all/.seg-known/.seg-unknown/.seg-update/.seg-broken/.seg-dup)
.seg-label .seg-count .statusbar-spacer .statusbar-right`. Narrow tabs: `.pane-tabs .seg-tab(.active)`.
Panes: `.pane .pane-archive .pane-disk(.drop-target) .pane-header .pane-title .pane-count .pane-unit
.pane-header-spacer .pane-header-actions .filter-strip .filter-row .filter-row-spacer .sort-label
.list-scroll .list-footer .pane-state(-glyph/-title/-body) .skeleton-row .skeleton-block(.skeleton-thumb/.skeleton-line)`.
Rows: `.row(.selected, .row-arrive)` (hover/selected/have are three separable treatments) ·
`.row-thumb(.row-thumb-sm) .thumb-placeholder .row-text .row-name .row-meta .row-right .row-rating
.row-stars(.rating-value) .row-dl .glyph-col(.mem-glyph/.health-glyph) .row-check(.checked)
.chrono-btn(.newer) .group-caret(.open) .nudge .sub-row`.
Disk extras: `.scan-strip(-label) .scan-track .scan-fill .scan-pct .new-maps-banner(-text) .banner-spacer .banner-dismiss`.
Detail: `.detail-dock(.collapsed) .detail-handle(-title/-name/-spacer) .detail-body .detail-empty .detail-thumb
.detail-center .detail-name .author-chip(.gold/.unknown) .chip-row .detail-stats .detail-quote .detail-actions
.detail-batch-count .detail-batch-sub .batch-chips .batch-chip(.from-archive/.from-disk) .detail-batch-actions`.
Expanded: `.detail-expanded .expanded-header .expanded-title .expanded-main .viewer(.dragging) .viewer-canvas
.viewer-caption .zoom-bar .zoom-btn .zoom-pct .zoom-divider .zoom-reset .expanded-content .detail-tabs
.detail-tab(.active) .tab-body .stat-band .stat-num .stat-label .section-label .description-body
.verdict-banner(.verified/.broken) .verdict-glyph .verdict-title .verdict-stamp .finding-row .footnote
.summary-card(-label/-text) .review-sort-row .review-sort-opt(.active) .review-item .review-head .review-handle
.review-stars .review-when .review-text .helpful-btn(.marked) .star-input .star-btn(.lit)
.version-explainer(.latest-word/.canonical-word) .version-row(.canonical) .version-label .version-date
.version-spacer .popover` (team-vote confirm/correct).
Chronoshift: `.chrono-ghost` (set `--dx`/`--dy` inline) · `.chrono-chip(-head/-glyph/-phase/-pct/-track/-fill/-sub)`.
Toasts: `.toast-layer .toast(.ok/.err/.flavor) .toast-glyph .toast-body .toast-title .toast-sub .toast-action .toast-dismiss`.
Activity: `.drawer-scrim .activity-drawer .activity-header .activity-title .activity-list .activity-entry
.activity-glyph .activity-text .activity-time`.
Modals: `.modal-scrim .modal(.modal-settings 600 / .modal-contribute 560 / .modal-tidy 540 / .modal-review 480)
.modal-header .modal-title(.gold) .modal-close .modal-body .modal-footer .modal-footer-note .modal-footer-spacer
.settings-section(-title) .install-card .install-path .install-sub .pip-green .setting-row(-text/-title/-sub)
.consent-row .consent-glyph(.yes/.no) .note-card(.protected-word) .pick-row .pick-thumb(.pick-thumb-sm)
.progress-row(.status-ok/.status-err) .progress-track .progress-fill(.gold) .avatar-discord`.
Onboarding: `.onboarding .onb-steps .onb-step-bar(.done/.active) .onb-content .onb-card(.narrow-card/.centered)
.starfield .onb-mark(-pip) .onb-eyebrow(.gold) .onb-body .onb-body-sm .onb-nav .detected-card .detected-path
.detected-sub .onb-progress-track .onb-progress-fill .onb-progress-label`.
Error: `.boot-error(-glyph/-title/-body)`.
Keyframes: `cs-pulse cs-spin cs-toast cs-scan cs-fly cs-arrive cs-fade` (values verbatim from styles.md).
Reduced motion: OS `prefers-reduced-motion` AND `.reduced-motion` (from the Settings toggle) disable the
ghost, pulses, arrive flash, and the dock height transition.

## Copy notes (strings NOT in copy.md — designed per DESIGN.md §12, keep in voice)

- Chronoshift single failure: `Chronoshift failed.` / `{name} — {error}. Nothing was written.`
- Batch partial failure: `Chronoshifted {ok} of {n} maps.` / `{failed} failed — nothing was destroyed. See the summary.`
- No folder: `No game folder configured.` / `Add one in Settings.`
- Sign-in failure: `Sign-in failed.` · review post failure: `Review didn’t send.` · tag vote failure: `Vote didn’t send.`
- Tidy reasons when the canonical label is unknown locally: `known · superseded` (copy.md's
  `known · superseded by FINAL` needs a version label the annotate endpoint doesn't carry) and `known · broken`.
- Boot errors: `Chronosphere couldn’t start.` / `Chronosphere hit a wall.`
Everything else is verbatim copy.md. Membership counts must keep summing (`known+unknown+update = total`).
