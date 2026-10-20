# Option B — current layout, fixed components

Branch: `ui/option-b-components`. Not pushed to `main`, not merged — ready for review.
10 commits, one per phase (see `git log main..HEAD`). `npm run build` and
`tsc -p tsconfig.app.json --noEmit` are clean after every commit, not just at
the end.

No layout moved. Every change below is either a token value, a shared
component's own styling, or a page swapping a hand-rolled bit of markup for
the shared component that already existed for it.

## Phase 0 — design tokens

Replaced the navy/slate palette in `src/index.css` and `tailwind.config.ts`
with the Option B tokens (teal primary at `#077A84`, `heading` ink instead of
navy, five status tones — success/warning/destructive/info/neutral — each
with a DEFAULT + soft `-bg` + `-border`). Page background and sidebar
gradient left untouched, as instructed. Self-hosted Inter via
`@fontsource-variable/inter`, removed the unused `@fontsource/geist-sans`.
Brought `src/design-system/tokens.ts` (0 importers before this branch) and
`src/lib/design-tokens.ts` / `statusColors.ts` (also unused/stale) in line
with the same values, so there's one source of truth instead of several that
disagreed.

## Phase 1 — type scale

- `html { font-size: 13px }` → `15px`.
- `text-xs` and `text-sm` pinned to literal `12px`/`13px` in
  `tailwind.config.ts` (not `rem`), so neither can drift below the 12px
  floor regardless of the root size, and so the exact caption/label steps
  are hit rather than approximated.
- **364/364** `text-[10px]` (142) and `text-[11px]` (222) replaced with
  `text-xs`. Remaining stray sizes (`text-[9px]`, `[12px]`, `[13px]`,
  `[15px]`) mapped to the nearest scale step.
- New fixed-px `.ic-text-title/section/body/label/caption` utility classes
  for the exact spec'd sizes, independent of root rem scaling.
- `PageHeader`'s `<h1>` now uses `.ic-text-title` — normalizes 97 of 136
  pages' page title in one place. The remaining hand-rolled `<h1>`s were
  reviewed individually: genuine page titles (Dashboard, ResetPassword,
  ExpenseDetail) got the same treatment; a patient/record "name" used as an
  `<h1>` inside a card, and a waiting-room TV display heading, were left
  alone — different UI role, not a page title.

**Left alone, with reasons:** `public/BookDemo.tsx`'s `text-[26px]/[28px]`
(public marketing hero, not the internal app's density); inline `fontSize`
values in `components/receipts/*.tsx` and `print:block`-only report
letterheads (thermal-receipt/print media — the 12px floor is an on-screen
accessibility rule).

## Phase 2 — buttons, fields, badges, chips

- **Button**: default height 44px (was 36), `sm`=40px, `icon`=44×44 (new
  `icon-sm`=40×40), 15px/600 text, `hover:bg-primary-hover`. Added a
  `loading` prop (disables + shows a spinner) instead of every call site
  hand-rolling that.
- **Input/Textarea/Select**: 44px height, white (`bg-card`) background, 15px
  text, a real disabled state (`disabled-bg` + muted text, not just
  `opacity-50`), `aria-invalid="true"` → 2px danger border.
- **New `src/components/ui/date-picker.tsx`**: shows the date via
  `formatDate` ("20 Oct 2026") in a button that opens `ui/calendar` in a
  popover — same ISO `yyyy-mm-dd` in/out as a native `<input type="date">`,
  drop-in compatible. Wired up on Dashboard's custom date range as a worked
  example; **117 of 118** native date inputs elsewhere are not yet
  converted (flagged below).
- **IcFormField**: now clones its single child to wire `aria-invalid` and
  `aria-describedby` to the error/hint automatically (previously left to
  each call site), and marks the error `role="alert"`.
- **StatusBadge**: pill shape (`rounded-full`, 13px/600, 4×10 padding) with
  a coloured dot. The 33 existing call sites that pass their own `map` keep
  their exact behavior; a call site that omits `map` now gets a sensible
  built-in status→tone table instead of defaulting to neutral.
- **FilterBar's FilterPill** (the Today/This Week/This Month chips): 40px,
  selected = primary border + `primary-soft` background + primary text,
  `aria-pressed` added.

## Phase 3 — dialogs

**Confirm dialogs.** Before touching anything, found that 48 of the app's 50
`confirm()` call sites already went through a local `useConfirmDialog()`
hook (async, non-blocking) — only 2 files
(`setup/LocationAccess.tsx`, `inventory/LabTestConsumables.tsx`) still called
the real blocking `window.confirm()`. `window.alert()` was already unused
everywhere (0 hits). Rewrote `src/components/common/ConfirmDialog.tsx`
(built earlier, used 0 times) to the spec: 44px tinted icon, 18px/600 title,
a required-reason field for voiding/cancelling money, cancel-left/
confirm-right buttons, confirm button shows a spinner and stays disabled
while an (optionally async) `onConfirm` runs, staying open on error so the
action can be retried. `useConfirmDialog()` now renders through this
component internally — all 48 existing call sites got the new look for
free, zero per-site changes. Added a second, global `useConfirm()` hook
(`ConfirmDialogProvider`, mounted once in `App.tsx`) with no per-component
JSX boilerplate, used for the 2 real `window.confirm()` replacements. The
dialog/alert-dialog/sheet/drawer overlay is now `bg-heading/45` (the exact
`rgba(20,54,60,0.45)` from the spec, since `#14363C` is the `heading` token)
everywhere, not three different grey/blur treatments.

*Known gap:* many of the 48 existing `useConfirmDialog()` call sites still
only pass `description` (no `title`), so they render a generic "Are you
sure?" instead of a specific question. Rewriting every one with a tailored
title is real per-site judgment; only the ones that were clearly about money
(voiding/cancelling bills, invoices, payroll) got a `tone="danger"` +
`reason` field added. The rest are functionally correct and visually
consistent now, just generically titled.

**Custom modals.** 36 `fixed inset-0` occurrences across 22 files
(confirmed against the spec's count). Excluding `ui/`-internal Radix
primitives and the sidebar's mobile-nav backdrop (not a content modal),
**5 converted** to real `ui/dialog.tsx` (Escape-to-close, focus trap, scroll
lock now free): `components/modals/ResponsiveModal.tsx` (shared, 0 current
callers, fixed anyway), `Invoices.tsx`, `setup/Services.tsx`,
`reports/AuditSummaryReport.tsx`, `Login.tsx` (which also lost a dead
hand-rolled focus-ring style using the pre-Option-B teal hex).
`reports/PasswordVerification.tsx` is a full-route security gate, not a
floating modal — nothing underneath to scroll-lock or focus-trap against —
so it got the one behavior that actually applies (Escape now leaves the
gate) instead of being forced into Dialog.

*Known gap:* **10 files / 26 occurrences** still hand-rolled, not yet
converted: `BillDetails.tsx` (2), `Receipts.tsx` (3), `PatientsBill.tsx`
(6), `pharmacyModule/{DispensingWorkflow,PharmacyReturns,
PrescriptionManagement}.tsx`, `inventory/{StockLocations,BatchTracking,
ItemMaster,PhysicalCounts}.tsx`. All still work; none get
Escape/focus-trap/scroll-lock yet.

## Phase 4 — toasts, loading, empty states

- **sonner**: white card + border + soft shadow, 15px title/13px muted
  description, success/info icons via the new tokens, error gets a tinted
  background+border (reads as "needs attention"), every toast has a close
  button labelled "Close message", position top-right.
- **New `src/lib/notify.ts`**: a drop-in `toast` (identical shape to
  sonner's own) whose `success` auto-closes at 4s and `error` now actually
  stays until dismissed (`duration: Infinity`) with an optional Retry
  action — plus `notify.success/error/info` for new code. Mechanically
  swapped the import in **all 133 files** that did
  `import { toast } from 'sonner'` to `from '@/lib/notify'`, so every one of
  the app's ~1300 existing `toast.success/error()` calls gets this behavior
  for free, with zero change to the calls themselves. Removed the old
  Radix-toast `<Toaster/>` from `App.tsx` — sonner only now.
- **AdvancedDataTable** (84 consuming pages): `loading` now renders 4 real
  skeleton rows shaped to the table's own columns instead of a spinner;
  added an `empty` prop rendering the shared `EmptyState` (dashed border,
  brand-teal icon, title + message + optional action), keeping the old
  `emptyMessage`/`emptyIcon` props working for the 78 call sites already
  using them.
- Consolidated two unused, divergent `EmptyState` components into one
  (`src/components/common/EmptyState`); `ui/EmptyState.tsx` now re-exports
  it. Found and fixed its two real consumers (`ListCard`,
  `AdvancedDataTable`) whose prop shape changed slightly.
- `Skeleton`'s fill now uses the dedicated `skeleton` token instead of
  generic `muted`.

*Known gap:* "spinners only inside buttons, remove the bare 'Loading...'
text" was addressed for the single highest-leverage case (AdvancedDataTable,
84 pages) and one named bug (CashierShift). The other `animate-spin` uses
(376 total, unchanged count) are page/section-level `LoadingState` spinners
that would each need a hand-built skeleton shaped to that page's own layout
— not attempted at that scale.

## Phase 5 — formatter file

New `src/lib/format.ts`: `formatDate`, `formatDateTime`, `formatMoney`,
`formatDuration`, `formatPhone` — fixed `en-GB` locale, `Intl.NumberFormat`/
`Intl.DateTimeFormat`, returns `—` for null/undefined/invalid, never throws.

**All 157/157** bare `toLocaleDateString()` calls now go through
`formatDate()`. 153 matched a clean `new Date(x).toLocaleDateString()` shape
and were replaced by script (verified against a dry-run diff before running
on the real tree, after an import-placement bug in the first script version
was caught by `tsc` and fixed); the other 4 — a nested-Date expression, two
pre-parsed-Date-variable cases, two bare "today" calls with no argument —
were fixed by hand.

*Known gap, flagged rather than rushed:* the ~280
`toFixed(2)`/`toLocaleString()` money calls (`formatMoney`) are **not**
mechanically safe to bulk-replace the way dates were — many already route
through a per-page currency-conversion helper (`amt(...)`) or a
locally-resolved currency variable, so a blind regex swap risks silently
dropping that conversion or showing the wrong currency. Left untouched.
Likewise 117 of 118 native `<input type="date">` elements (one converted in
Phase 2 as a worked example) — each needs the same per-site care as the
custom modals, not a script.

## Phase 6 — named bugs

- **`lis/LISRegistration.tsx`**: gender no longer silently defaults to
  `'Male'` (all 5 spots — the 4 named line numbers plus the edit-load
  fallback the spec didn't name but is the same bug); gets a "Select
  gender" placeholder and a required inline error
  ("Choose the patient's gender."); phone gets a loose format check when
  one is entered. Register/Update was already disabled while saving.
- **`cashier/CashierShift.tsx`**: Shift Duration no longer shows `NaNh` —
  uses `formatDuration()`, falls back to "—" / "No shift open" if
  `start_time` is missing/invalid; empty receipts list now uses
  `EmptyState`; bare "Loading..." replaced with skeleton stat cards. Close
  Shift was already shown only when a shift is open (Start Shift already
  appears in its place otherwise) — left its dialog as a real `Dialog`
  rather than forcing it into `ConfirmDialog`, since it collects an actual
  cash count, not a yes/no.
- **`Login.tsx`**: dropped the "HIPAA Compliant" badge (not applicable —
  US law), reworded "256-bit SSL" → "Encrypted connection" and added
  "Daily backups", year is now `new Date().getFullYear()`, added
  `aria-label="Show/Hide password"` to the eye toggle, dropped the same
  dead hand-rolled teal-hex focus-ring handlers found in the
  forgot-password modal (Input's own focus ring already covers it).
- **Top bar** (`components/layout/Sidebar.tsx`): the Wi-Fi icon is now a
  labelled pill — "Offline" (danger) with a tooltip explaining changes
  sync later, "Online" (success) otherwise, instead of a bare coloured
  icon. Added `aria-label`s to the help and notification buttons.
- **Brand name**: fixed the two places DHIS2 report text said
  "Intellicare" instead of "IntelliCare" (left the `.ics` calendar UID and
  a download filename's lowercase "intellicare" alone — technical
  identifiers, not text a person reads).

## Phase 7 — colour clean-up

Scripted, verified mapping from the spec's table, build+typecheck checked
after every family, not just at the end:

| Family | Token | Instances |
|---|---|---|
| red/rose | destructive (+ `-bg`/`-border`) | — |
| amber/yellow | warning | — |
| emerald/green | success | — |
| sky | info | 172 |
| red+rose+amber+yellow+emerald+green (combined) | — | 1076 |
| blue | info (6), left alone (3) | 13 reviewed individually |
| teal | primary/primary-hover/ring (brand colour, not a status) | 13 |
| slate text | foreground/muted-foreground/heading | 64 |
| slate bg/border/gradient (found along the way, not in the spec's table but still raw) | muted/border/background | 78 |

Blue was reviewed one-by-one rather than scripted (its shade pattern is far
less consistent than sky's "light bg + dark text" status shape): 6 genuine
status uses converted, 3 left alone (a chart's category-colour map, two
file-type icon colours — neither is a status indicator; the two icon ones
got inline `eslint-disable` comments explaining why).

Added an ESLint rule (`no-restricted-syntax` on `className`) banning raw
red/rose/amber/yellow/green/emerald/sky/blue/slate classes and sub-12px
arbitrary text sizes in `src/pages` and `src/components`
(`src/components/ui` exempt — that's where the tokens themselves are wired
up). Scoped to exactly the families this pass mapped, not the whole
Tailwind palette, so it catches *new* regressions without also failing on
the families below that this pass didn't touch.
`npx eslint src/pages src/components` → **0** `no-restricted-syntax` hits.
(The ~1060 pre-existing `@typescript-eslint/no-explicit-any` errors and
`react-hooks/exhaustive-deps` warnings are unrelated and unchanged —
confirmed via `git stash` before touching `eslint.config.js`.)

*Known gap, flagged not guessed at:* colour families outside the spec's
table, still raw: **purple (46), gray (84), orange (28), indigo (20),
violet (11), pink (8), cyan (1)** — 198 total. None of these appear in the
Option B conversion table, and several read as plausibly intentional
(a chart's category-colour palette, specific badge variants like
"pending_refund"/"returned" that don't map cleanly onto 5 tones) rather than
leftover raw colour — converting them needs the same one-by-one judgment
the blue cleanup got, not a blind script.

## Phase 8 — accessibility

- **AdvancedDataTable's `<th>`** (84 pages) and **TableSearch's** search box
  + clear button now carry `scope="col"`, `aria-label`, and
  `aria-label="Clear search"` — three fixes reaching nearly every table and
  every searchable table in the app from two files.
- **163 hand-rolled `<th>` tags** across 22 other files got `scope="col"`
  too, via a script that specifically skipped raw `class="..."` HTML
  template-literal strings (PDF/print table generation — confirmed by
  checking for `className=` vs bare `class=`) so those weren't mistaken for
  real JSX and left malformed. 39 such print-template `<th>`s correctly
  left untouched.
- **121 of ~124** `<Button size="icon">` elements now have `aria-label`.
  Built as a proper brace/string-aware tag-boundary scanner (a first regex
  attempt corrupted `onClick={() => ...}` arrow functions, since `=>`
  contains a literal `>` outside any `{}`-tracking — caught by `tsc`,
  rewritten correctly), which per button: reuses an existing
  `title="..."` / `title={...}` verbatim when present (this is why
  "Assign selected"/"Disable user" show up instead of a generic guess — an
  earlier version without this step mislabeled two arrow buttons
  "Previous"/"Next" from their icons when the real `title` was sitting
  right there); otherwise infers a label from the first recognized Lucide
  icon; otherwise leaves it for a by-hand fix (2 cases, both fixed
  manually). Verified by diffing 6 sample files before running on the real
  tree, then confirmed 0 remaining unlabeled icon buttons afterward.

*Known gap:* wrapping each icon button in a `Tooltip` with the same text
(the other half of this spec line) — not attempted at this scale. It's a
structural JSX-wrapping change per call site, not an attribute splice, with
real risk of the same kind of corruption the first aria-label attempt
produced, for a sighted-user-only visual nicety layered on top of a fix
that already gives screen readers full support. Text contrast (4.5:1,
including 12px captions) wasn't separately audited — the token values
(`muted-foreground` `#50646A` on white, etc.) were chosen to pass; no
systematic contrast scan was run across all 136 pages' rendered output.

## Phase 9 — verification

```
grep -rn "confirm(" src/pages src/components           → 1 hit, a code comment, not a call
grep -rn "text-\[10px\]\|text-\[11px\]"                 → 0
grep -rn "toFixed(2)"                                    → 185 (flagged gap, Phase 5)
grep -rn "toLocaleDateString()"                           → 0
```

`npm run build` and `tsc -p tsconfig.app.json --noEmit` are clean on every
commit on this branch (`tsconfig.json` itself has `"files": []` and checks
nothing — the project-reference build, `tsconfig.app.json`, is the one that
actually type-checks `src/`).

**Playwright screenshots at 1440px/390px were not taken.** The app's own
dev/prod setup needs a backend (`src/server`, Postgres) and there's already
a running `intellicare-app` + `intellicare-db` container pair on this
machine from outside this session — rebuilding/restarting them to serve
this branch risked disrupting whatever they're currently being used for,
and docker-compose's own project doesn't recognize them as its containers
(`docker compose ps` → empty), so bringing up a *second* instance would
have meant either a port/name conflict or guessing at `.env` database
credentials this session is blocked from reading. Given that, verification
leaned entirely on `npm run build` + `tsc --noEmit` after every single
change (not just at phase boundaries) plus `npx eslint` for the new rule —
confirmed no runtime/type errors anywhere on the branch, but a human should
still open the five listed pages and eyeball them before merging, since no
automated check here actually rendered the app.

## Summary of what's fully done vs. flagged

**Fully done:** tokens (Phase 0), type scale (Phase 1), buttons/fields/
badges/chips (Phase 2), the confirm-dialog system and window.confirm()
removal (Phase 3's dialog half), toast system + AdvancedDataTable loading/
empty (Phase 4), `formatDate()` everywhere (Phase 5's date half), all 6
named bugs (Phase 6), the spec's 5 named colour families + slate + the
brand-colour teal leftover (Phase 7's core), the ESLint guard rail
(Phase 7.3), table header scope + search labelling + icon-button
aria-labels (Phase 8's non-Tooltip half).

**Partially done / flagged, not guessed at:** 5 of 15 custom modals
converted to Dialog (10 remain functional but without
Escape/focus-trap/scroll-lock); `formatMoney()` built but not rolled out to
~280 call sites; `DatePicker` built but applied to 1 of 118 native date
inputs; 198 raw colour classes outside the spec's named families;
Tooltip-wrapping for icon buttons; a systematic contrast audit; live
screenshots.
