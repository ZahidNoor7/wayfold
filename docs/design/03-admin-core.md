# 03 — Admin core: shell, Overview, Bookings, Settings & appearance

Source files (in `design-reference/`): `AdminOverview.dc.html`, `AdminBookings.dc.html`, `AdminSettings.dc.html`.
Design board size: 1440 px wide (`$preview` 1440x1300 / 1300 / 1500). The design shows one business ("Aurelia Journeys", owner "Leyla Mammadova"); in Wayfold this is one tenant's workspace dashboard.

Conventions in this doc:

- "Script" = the `class Component extends DCLogic` block of the file.
- Component classes (`btn`, `card`, `badge`, `side-link`, `tabs-list`, `sheet-right`, `dialog`, `overlay`, `toast`, `alert`, `avatar`, `select`, `input`, `textarea`, `label`, `table`, `separator`) come from a stylesheet that is **not available**. Anything said about their look is inferred from usage and marked "inferred".
- **Not in the design** marks things the brief asked about that these three files do not contain. Do not treat them as specified.

---

## 1. Admin shell

The shell markup (lines 17–56 of each file) is byte-identical across the three screens apart from which link carries `aria-current="page"`.

### 1.1 Root wrapper

```html
<div data-theme="{{uiTheme}}" data-font="{{uiFont}}" data-radius="{{uiRadius}}"
     class="{{uiDark}} min-h-screen overflow-x-clip bg-muted/40 font-sans text-foreground antialiased lg:flex">
```

- `data-theme` = `emerald | caspian | pomegranate | graphite`; `data-font` = `classic | modern | sans`; `data-radius` = `none | sm | md | lg`; class is literally `dark` or `light`.
- Page canvas is `bg-muted/40`; sidebar and cards sit on `bg-card`.
- Fonts loaded via Google Fonts: Cormorant Garamond (500, 600, italic 500), Fraunces (opsz 9–144; 500, 600, italic 500), Manrope (400–700). `font-sans` = Manrope; `font-display` = the heading font selected by `data-font`.
- Semantic colour tokens used: `background`, `foreground`, `card`, `muted`, `muted-foreground`, `primary`, `primary-foreground`, `secondary`, `accent`, `border`, `ring`, `destructive`, plus non-shadcn tokens `highlight` (gold/accent brand colour), `eyebrow` (small-caps label colour), `hero`, `hero-foreground`.

### 1.2 Desktop sidebar (`lg` and up)

`<aside class="hidden shrink-0 border-r bg-card lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:flex-col lg:overflow-y-auto">`

| Part | Markup / classes |
|---|---|
| Brand block | `flex h-20 items-center px-5`; link to Overview: `font-display text-2xl font-semibold text-primary` "Aurelia" + `text-[10px] font-semibold uppercase tracking-[0.28em] text-eyebrow` "Admin", `flex items-baseline gap-2` |
| Nav | `<nav aria-label="Admin" class="flex flex-col gap-1 px-3">` |
| Group label | `<p class="px-3 pb-1 pt-2 text-xs font-semibold text-muted-foreground">` (later groups use `pt-4`) |
| Link | `class="side-link h-11 lg:h-10"` — 24x24 stroke icon (`stroke-width="1.7"`, `fill="none"`, `currentColor`) then label, optional trailing badge with `ml-auto` |
| User block | `mt-auto flex items-center gap-3 border-t p-4`: `<span class="avatar">LM</span>`, name `block font-bold` "Leyla Mammadova", link "View website ↗" (`text-eyebrow underline-offset-4 hover:underline`, goes to the public home page) |

Nav items, in order:

| Group | Label | Target | Icon (inline SVG) | Badge |
|---|---|---|---|---|
| Business | Overview | AdminOverview | 4 rounded rectangles in a 2-column masonry (dashboard grid) | — |
| Business | Bookings | AdminBookings | calendar (rounded rect, header line, two top pins) | `badge badge-highlight` "7" (pending bookings; hard-coded) |
| Content | Packages, reviews & journey | AdminPackages | map pin (teardrop + inner circle) | — |
| Content | Discounts & offers | AdminPromotions | price tag (tag outline + hole) | `badge badge-pending` "2" (pending discount requests; hard-coded) |
| Website | Settings & appearance | AdminSettings | painter's palette (4 dots + palette outline) | — |

- Active state: `aria-current="page"` on the `side-link`; the visual treatment is in the unavailable CSS (inferred: accent/muted background + stronger text).
- Both counters are static text in the markup — they do not react to the Bookings state. They match the seed data (7 Pending bookings; 2 Pending discount requests).
- **Role indicator / "Viewing as": not in the shell and not on any of these three screens.** The user block shows only avatar initials + name, with no role label. See §6.

### 1.3 Small screens: top bar + slide-out menu (below `lg`)

Top bar: `sticky top-0 z-40 flex h-14 items-center justify-between gap-2 border-b bg-background/95 px-3 backdrop-blur lg:hidden`

- Left: hamburger `btn btn-ghost btn-icon`, `aria-label="Open navigation"`, `aria-expanded="{{navExpanded}}"`. Icon is three lines with the last one shorter (`M4 7h16M4 12h16M4 17h10`).
- Centre: brand link, "Aurelia" `font-display text-xl font-semibold text-primary` + "Admin" eyebrow.
- Right: light/dark toggle `btn btn-ghost btn-icon` (sun icon when dark, moon when light; `aria-label` "Switch to light mode" / "Switch to dark mode") and `<span class="avatar h-8 w-8 text-xs">LM</span>`.

Slide-out (rendered only while `state.nav` is true):

```html
<div class="overlay lg:hidden" onClick="toggleNav"></div>
<aside role="dialog" aria-modal="true" aria-label="Admin navigation" class="sheet-left overflow-y-auto lg:hidden">
```

- Header row `flex h-14 items-center justify-between border-b px-4`: brand (`text-2xl`) + close `btn btn-ghost btn-icon` "✕" (`aria-label="Close navigation"`).
- Same nav groups/links/badges as desktop (`<nav aria-label="Admin (mobile)">`, wrapped in `py-3`).
- Footer `mt-auto flex flex-col gap-3 border-t p-4`: a labelled **Theme** `<select class="select">` (4 theme options), then the user block (avatar, name, "View website ↗").
- Closes on overlay click or ✕. No Escape handling, no focus trap, and tapping a nav link does not explicitly close it (page navigation does).
- The desktop sidebar itself never collapses to an icon rail — it is either fully shown (`lg:flex`) or replaced by the top bar.

### 1.4 Main region and page header pattern

`<main class="min-w-0 flex-1 p-5 sm:p-8">`

Header block: `mb-6` (Overview `mb-7`) `flex flex-wrap items-end justify-between gap-4` (Overview `items-center`; Settings is a plain `mb-6` block with no right side).

- Left: a kicker line **above** the title — `text-[13px] text-muted-foreground` — then `<h1 class="font-display text-3xl font-semibold text-primary sm:text-4xl">`.

| Screen | Kicker | H1 |
|---|---|---|
| Overview | "Saturday, 14 November 2026" (static) | "Good evening, Leyla" (static) |
| Bookings | "Requests aren’t confirmed until you confirm them here." | "Bookings" |
| Settings | "Manage your profile, website content and how your site looks." | "Settings & appearance" |

- Right (Overview and Bookings only): quick appearance controls wrapped in `hidden items-center gap-2 sm:flex` — `<select id="qtheme" class="select h-10 w-40">` (sr-only label "Theme") + mode toggle `btn btn-outline btn-icon`. Overview additionally has a primary action `<a class="btn btn-default">+ New package</a>` (to AdminPackages) outside the hidden wrapper, so it stays visible on phones.
- Settings has no quick controls in the header (the page itself is the control surface).

### 1.5 Sticky elements

- Mobile top bar (`sticky top-0 z-40`), desktop sidebar (`lg:sticky lg:top-0 lg:h-screen`).
- Booking detail sheet header (`sticky top-0 z-10 ... border-b bg-background p-6`) — holds ref, guest name, status badge and close button while the sheet body scrolls.
- Settings live-preview card (`2xl:sticky 2xl:top-8`).
- **Sticky bottom action bars: not in the design.** Save buttons are inline at the end of each form; booking actions are the first row inside the sheet body.

### 1.6 Layering

`z-40` top bar; `overlay` + `sheet-left` / `sheet-right` (z-index in unavailable CSS, inferred ~50); confirmation `overlay` + `dialog` forced above the sheet with `!z-[60]`; `toast` (inferred fixed, bottom).

---

## 2. Overview (`AdminOverview.dc.html`)

Purpose: landing dashboard — headline numbers, six-month request trend, next tours, latest booking activity, newest inquiries. Read-only apart from links out. All data is static sample data in `renderVals()`.

Layout (top to bottom inside `<main>`):

1. Page header (§1.4).
2. KPI grid: `mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4` — 8 cards.
3. Row A: `mb-5 grid gap-5 xl:grid-cols-[3fr_2fr]` — chart card + "Upcoming tours" card.
4. Row B: `grid gap-5 xl:grid-cols-[3fr_2fr]` — "Recent booking activity" card + "Recent inquiries" card.

### 2.1 KPI cards

Each card is a link: `<a href class="card flex flex-col gap-2 p-5 transition-shadow hover:shadow-md">`

- Row 1: label `text-[13px] font-medium text-muted-foreground`, with a status dot on the right (`h-2 w-2 rounded-full <colour>`), `flex items-center justify-between`.
- Row 2: value `font-display text-[38px] font-semibold leading-none text-primary`.
- Row 3: trend/sub-line `text-xs font-semibold` in one of three tones: **up** `text-emerald-700 dark:text-emerald-400`, **warn** `text-amber-700 dark:text-amber-400`, **neutral** `text-muted-foreground`.

| # | Label | Value | Sub-line | Tone | Dot | Links to |
|---|---|---|---|---|---|---|
| 1 | Booking requests | `201` | ↑ 18% vs last quarter | up | `bg-highlight` | Bookings |
| 2 | Pending | `7` | 2 date clashes to resolve | warn | `bg-amber-500` | Bookings |
| 3 | Confirmed | `27` | Next: Nov 18 · Food & Wine | neutral | `bg-emerald-600` | Bookings |
| 4 | Completed tours | `940` | ↑ 14 this month | up | `bg-sky-600` | Bookings |
| 5 | Customers | `1,284` | 41 countries | neutral | `bg-primary` | Packages |
| 6 | Experiences | `9` | 8 published · 1 draft | neutral | `bg-primary` | Packages |
| 7 | Average rating | `4.9` | 386 reviews | neutral | `bg-highlight` | Packages |
| 8 | Booked value (Nov) | `$41.6k` | ↑ 9% vs October | up | `bg-highlight` | Bookings |

Value formats: plain integer, thousands-separated integer, one-decimal rating, compact currency (`$41.6k`). Values are pre-formatted strings. Deltas are free text with a leading "↑" (no down-trend example exists).

### 2.2 Chart — "Booking requests", "Last 6 months"

- Card header: `card-header flex-row flex-wrap items-center justify-between gap-3 space-y-0`; `card-title` + `card-description mt-1.5`; legend on the right (`flex gap-4 text-xs text-muted-foreground`) with `h-2.5 w-2.5 rounded-sm` swatches: **Confirmed** = `bg-primary`, **Requests** = `bg-highlight`.
- Type: grouped vertical bar chart, two series per month. **Pure CSS/flex — no SVG, no canvas, no chart library.**
- Plot: `<div role="img" aria-label="Requests rose from 21 in June to 44 in November; confirmations from 16 to 31" class="flex h-56 items-end gap-3 border-b pb-7 sm:gap-5">`. The bottom border is the only axis line; there is no y-axis, gridlines or value labels.
- Per month: `relative flex h-full flex-1 items-end justify-center gap-1` containing two bars `w-1/3 max-w-6 origin-bottom animate-grow rounded-t-md` (Requests `bg-highlight` first, Confirmed `bg-primary` second) and an x label `absolute -bottom-6 text-xs text-muted-foreground`.
- Bar height = `value / 48 * 100%` (fixed max of 48). Hover value via native `title` ("21 requests", "16 confirmed").
- Data `[month, requests, confirmed]`: Jun 21/16, Jul 29/22, Aug 35/27, Sep 32/24, Oct 40/29, Nov 44/31.
- Motion: `animate-grow` with per-month `animation-delay: i * 0.06s` (see §8).

### 2.3 Upcoming tours

`card` → `card-header` (`card-title`) → `card-content flex flex-col gap-4`. Row: `flex items-center gap-3`:

- Date tile `w-12 shrink-0 rounded-md border py-1 text-center`: month `block text-[11px] font-bold uppercase text-eyebrow`, day `block font-display text-[22px] font-semibold leading-none`.
- Text: title `block truncate text-sm font-semibold`, sub `text-[13px] text-muted-foreground`.

Items: Nov 18 "Baku Food & Wine Evening" / "Priya Raman · 2 guests"; Nov 21 "Icherisheher & Flame Towers" / "Claire Dubois · 4 guests"; Dec 03 "Fire & Stone: Gobustan" / "Omar Haddad · 3 guests"; Apr 18 "Silk Road to Sheki" / "Group departure · 6 of 8 booked". Rows are not links.

### 2.4 Recent booking activity

`card overflow-hidden`; header `flex items-center justify-between p-5 pb-3 sm:p-6 sm:pb-3` with `card-title` + `<a class="btn btn-ghost btn-sm">View all</a>` (to Bookings).

- `md` and up: `hidden overflow-x-auto md:block` → `<table class="table min-w-[600px]">`, columns **Reference** (`pl-6 font-semibold`, link `text-primary underline-offset-4 hover:underline`), **Guest**, **Tour** (`text-muted-foreground`), **Date** (`whitespace-nowrap text-muted-foreground`), **Status** (`pr-6`, badge).
- Below `md`: `<ul class="divide-y md:hidden">`; each item is a link `flex flex-col gap-1 px-5 py-3.5 hover:bg-muted/50`: line 1 guest (`font-bold`) + status badge; line 2 tour `text-[13px] text-muted-foreground`; line 3 `{ref} · {date}` `text-xs text-muted-foreground`.
- 5 rows (see §7.6). Every row links to the Bookings list, not to a specific booking.

### 2.5 Recent inquiries

`card`; header `card-header flex-row items-center justify-between space-y-0` with `card-title` + `<span class="badge badge-pending">3 new</span>`. Body `card-content flex flex-col divide-y`; item `py-3.5 first:pt-0`:

- `flex justify-between gap-2 text-sm`: `<strong>` name + `text-xs text-muted-foreground` relative time.
- Message `mb-2 mt-1 text-[13px] leading-relaxed text-muted-foreground`.
- Actions `flex gap-2`: `btn btn-outline btn-sm` "WhatsApp" (`https://wa.me/<digits>`), `btn btn-ghost btn-sm` "Email" (`mailto:`).

### 2.6 Quick actions

Only: "+ New package" (header), "View all" (bookings card), KPI cards as navigation, WhatsApp/Email per inquiry, theme select and mode toggle. **No dedicated quick-actions panel and no generic activity feed in the design.**

---

## 3. Bookings (`AdminBookings.dc.html`)

Purpose: triage booking requests — filter, find scheduling conflicts, open a booking, confirm / decline / cancel / complete / reopen, change the tour date, keep internal notes, contact the guest.

### 3.1 Layout

1. Page header (§1.4).
2. Toolbar `mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between`: status tabs (left), search + tour filter (right, `flex flex-col gap-2 sm:flex-row`).
3. Conflict banner (conditional).
4. List card `card overflow-hidden`: table (`md`+) or stacked list (below `md`), empty state, footer line.
5. Overlays: detail sheet, two alert dialogs, toast.

### 3.2 Status tabs

`<div role="tablist" aria-label="Status" class="tabs-list no-scrollbar max-w-full justify-start overflow-x-auto">`; each `<button role="tab" aria-selected class="tabs-trigger">{label} <span class="rounded-full bg-muted-foreground/15 px-1.5 text-xs">{n}</span></button>`.

- Tabs: **All, Pending, Confirmed, Completed, Cancelled**. Default `All`.
- Count `n` is computed after search and tour filter but **before** the conflicts-only filter. Seed counts: All 13, Pending 7, Confirmed 3, Completed 2, Cancelled 1.
- The tab strip scrolls horizontally on narrow screens with the scrollbar hidden.

### 3.3 Search and filter

- Search: `<label class="relative flex-1 md:w-72 md:flex-none">` with sr-only label "Search bookings", magnifier icon `pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground`, `<input class="input pl-9" type="search" placeholder="Search name, reference, tour…">`. Matches case-insensitive substring of `ref + name + tour + country` concatenated. Filters on every keystroke (no debounce).
- Tour filter: `<select class="select sm:w-44" aria-label="Filter by tour">` — "All tours" + the distinct tour names present in the data.
- **Not in the design:** column sorting, date-range filter, pagination, row checkboxes, bulk actions, export/CSV, calendar or availability view. Rows render in array order (seed order: pending newest-last, then confirmed, completed, cancelled).

### 3.4 Conflict banner

Shown when at least one booking has a clash:

`<div role="alert" class="alert alert-destructive mb-4 flex flex-wrap items-center justify-between gap-3">`

- Left: warning-triangle icon (`size-5`) + `font-semibold` text: "`{n} scheduling conflict needs|conflicts need` your attention — overlapping or over-capacity requests for the same date."
- Right: toggle `btn btn-outline btn-sm bg-background text-foreground` with `aria-pressed`; label "Show conflicts only" / "Show all bookings".
- `n` counts **bookings** that have a clash (4 in the seed data = two clashing pairs).

### 3.5 Table (`md` and up)

`<div class="hidden overflow-x-auto md:block"><table class="table min-w-[860px]">`; the whole `<tr class="cursor-pointer">` opens the sheet.

| Column | Cell |
|---|---|
| Reference | `pl-6 font-bold text-primary` — `AJ-SHE-4821` |
| Guest | name `block font-semibold`; below `text-xs text-muted-foreground` "`{country}` · requested `{req}`" |
| Tour | `text-muted-foreground` |
| Tour date | `whitespace-nowrap` — `18 Apr 2027` + muted " · 14:00" when a time exists |
| Guests | "2 adults", "1 adult", "2 adults, 3 children", "…, 1 child" |
| Est. value | `font-semibold` discounted total (e.g. `$1,173`); when a discount applies, the undiscounted amount on a second line `block text-xs font-normal text-muted-foreground line-through` |
| Status | `flex flex-wrap items-center gap-1.5`: status badge, plus `badge badge-cancelled` "⚠ Clash" (`title="Scheduling conflict"`) when clashing |
| (sr-only "Open") | `pr-6 text-right` — `btn btn-outline btn-sm` "Open", `aria-label="Open {ref}"`; stops propagation |

### 3.6 Stacked cards (below `md`)

`<ul class="divide-y md:hidden">`; each item is a full-width `<button class="flex w-full flex-col gap-1.5 p-4 text-left hover:bg-muted/50">`:

1. `flex w-full items-center justify-between gap-2`: name `font-bold` — right: `badge badge-cancelled` "⚠" (icon only, when clashing) + status badge.
2. Tour `text-sm text-muted-foreground`.
3. `flex w-full justify-between text-[13px]`: "`{date} · {guests}`" — value `font-semibold`.

Reference, country, requested-at, time and the struck-through base price are **not** shown in the stacked layout.

### 3.7 Empty state and footer

- Empty (no rows after filters): `<div class="p-14 text-center">` — "No bookings match" (`font-bold`) / "Try another status, tour or search term." (`text-sm text-muted-foreground`). No icon or reset button.
- Footer, always shown: `border-t px-6 py-3 text-[13px] text-muted-foreground` — "`{n}` shown · select a booking to view details and take action".

### 3.8 Status badges

| Status | Class | Used for |
|---|---|---|
| Pending | `badge badge-pending` | new request awaiting decision |
| Confirmed | `badge badge-confirmed` | accepted |
| Completed | `badge badge-completed` | tour delivered |
| Cancelled | `badge badge-cancelled` | declined **or** cancelled (one status for both) |
| (flag) Clash | `badge badge-cancelled` "⚠ Clash" / "⚠" | scheduling-conflict marker; reuses the cancelled variant |

Colours are in the unavailable CSS. Inferred from the matching KPI dots: pending = amber, confirmed = emerald, completed = sky, cancelled = red/destructive. Other variants seen across these files: `badge-highlight`, `badge-default`, `badge-secondary`, `badge-outline`.

### 3.9 Detail side panel

Opens when a row is selected (`state.sel = ref`; also resets `draftDate` to the booking date and clears `draftNote` / `dateWarn`).

```html
<div class="overlay" onClick="close"></div>
<aside role="dialog" aria-modal="true" aria-label="Booking {ref}" class="sheet-right overflow-y-auto sm:max-w-[520px]">
```

Full width on phones, max 520 px from `sm`. Closes on overlay click or ✕. Content, in order:

1. **Sticky header** `sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-background p-6`: kicker "`{ref}` · requested `{req}`" (`text-[13px] text-muted-foreground`); `<h2 class="my-1 font-display text-3xl font-semibold text-primary">` guest name; status badge; close `btn btn-outline btn-icon` "✕" (`aria-label="Close details"`).
2. Body `flex flex-col gap-6 p-6`:
   1. **Action row** `flex flex-wrap gap-2` (buttons conditional on status, §3.10).
   2. **Conflict alert** (when clashing) `alert alert-destructive`: "⚠ Scheduling conflict" (`font-bold`), bulleted list of clash messages (`mt-1 list-disc pl-5`), then "Suggest another date to the guest, or decline, to avoid a double booking."
   3. **Contact** `section[aria-label=Contact]` `flex flex-col gap-2 rounded-lg bg-muted/60 p-4 text-sm`: label/value rows (`flex justify-between gap-3`, label muted, value `font-semibold`) for **Email**, **Phone**, **Prefers** (WhatsApp | Email); then `mt-1 flex gap-2`: `btn btn-default btn-sm` "WhatsApp" → `https://wa.me/<phone digits>`, `btn btn-outline btn-sm` "Email guest" → `mailto:{email}?subject=Your Aurelia Journeys request {ref}`.
   4. **Trip details**: heading `mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground`; `<dl class="grid grid-cols-[130px_1fr] gap-x-4 gap-y-2.5 text-sm">` (dt muted): Tour (`font-semibold`), Date & time, Alternative date, Travellers, Language, Pickup, Discount (`font-semibold` label + "Manage" link `text-xs text-primary` to AdminPromotions), Estimated value (`font-bold`), Guest notes (`leading-relaxed`).
   5. `<div class="separator">`.
   6. **Tour date editor**: `label` "Tour date"; `flex gap-2`: `<input class="input" type="date">` + `btn btn-outline h-11 shrink-0` "Update date" / "Save anyway".
   7. **Date clash warning** (conditional) `<p role="alert" class="alert alert-destructive -mt-3 text-[13px]">`: "**This date would cause a clash:** `{messages joined by " · "}`. Click “Save anyway” only if you’ve agreed it with both guests."
   8. **Internal notes**: label "Internal notes · only visible to you"; `<textarea class="textarea" rows="3">` with placeholder "e.g. Vegetarian; asked about the halva class; hold 2 rooms at the caravanserai"; `btn btn-default self-start` "Save note".
   9. **Log** `flex flex-col gap-3`: entries `border-l-2 pl-3 text-[13px]` — timestamp `text-muted-foreground`, text `mt-0.5 leading-relaxed`. Newest first. Notes and status/date audit entries share this one list; entries have no author.

### 3.10 Actions

| Action | Visible when | Button | Guard / dialog | Result |
|---|---|---|---|---|
| Confirm booking | status = Pending | `btn btn-default` "✓ Confirm booking" | If the booking has a clash → alert dialog "Confirm despite a scheduling clash?" (below) | status → Confirmed; toast "`{ref}` confirmed — remember to message `{first name}`"; log "Booking confirmed." or "Booking confirmed despite a scheduling clash." |
| Mark completed | status = Confirmed | `btn btn-secondary` "Mark completed" | none (no check that the tour date has passed) | status → Completed; toast "`{ref}` marked as completed"; log "Tour completed." |
| Decline request | status = Pending | `btn btn-outline text-destructive hover:text-destructive` "Decline request" | cancel alert dialog | status → Cancelled; toast "`{ref}` declined"; log "Request declined." |
| Cancel booking | status = Confirmed | same button, label "Cancel booking" | cancel alert dialog | status → Cancelled; toast "`{ref}` cancelled"; log "Booking cancelled." |
| Reopen as pending | status = Cancelled | `btn btn-outline` "Reopen as pending" | none | status → Pending; toast "`{ref}` reopened"; log "Reopened as pending." |
| Update date (reschedule) | any status | "Update date" | Empty date → toast "Choose a date first". If the new date clashes: first click only shows the inline warning and relabels the button "Save anyway"; second click saves. Editing the input clears the warning. | `date` updated; toast "Tour date updated to `{d Mon yyyy}`"; log "Date changed to `{date}`." or "…`{date}` (clash acknowledged)." |
| Save note | any status | "Save note" | Blank → toast "Write a note first" | prepends `{at, text}` to log; toast "Note saved"; textarea cleared |
| WhatsApp / Email guest | any status | links | none | opens `wa.me` / `mailto:` — no in-app messaging |

Dialogs (both `role="alertdialog" aria-modal="true" class="dialog !z-[60]"` over `overlay !z-[60]`; overlay click does **not** dismiss; buttons right-aligned `flex justify-end gap-2`):

- **Cancel / decline** (`aria-label="Confirm"`): title `text-lg font-bold` "`Decline request|Cancel booking` `{ref}`?"; body `mt-2 text-sm text-muted-foreground` "`{name}` will need to be told personally. You can reopen it later."; buttons `btn btn-outline` "Keep booking", `btn btn-destructive` "`Decline request|Cancel booking`".
- **Confirm despite clash** (`aria-label="Confirm despite clash"`): title "Confirm despite a scheduling clash?"; bulleted clash messages; "Confirming will double-book this date. Usually it’s better to offer `{first name}` another date."; buttons `btn btn-outline` "Go back", `btn btn-destructive` "Confirm anyway".

After any action the sheet stays open and re-renders with the new status and log entry. Nothing notifies the guest automatically — the copy explicitly tells the admin to message them.

**Not in the design:** payment status or any payment field, "mark paid", refunds, deposits, assigning a guide, editing guests/tour/time, deleting a booking, in-app messaging, a dedicated note list separate from the audit log.

### 3.11 Booking status machine (as implemented)

```
Pending   --Confirm booking (extra "Confirm anyway" dialog if clashing)-->  Confirmed
Pending   --Decline request (dialog)----------------------------------->  Cancelled
Confirmed --Mark completed (no dialog)--------------------------------->  Completed   (terminal)
Confirmed --Cancel booking (dialog)------------------------------------>  Cancelled
Cancelled --Reopen as pending (no dialog)------------------------------>  Pending
```

| From | To | Trigger |
|---|---|---|
| Pending | Confirmed | Confirm booking |
| Pending | Cancelled | Decline request |
| Confirmed | Completed | Mark completed |
| Confirmed | Cancelled | Cancel booking |
| Cancelled | Pending | Reopen as pending |
| Completed | — | terminal (no actions) |

Not allowed: Confirmed → Pending, Completed → anything, Cancelled → Confirmed directly. "Declined" and "Cancelled" are the same stored status; only the log text differs. Date change and notes are allowed in every status, including Completed and Cancelled.

**Payment status: none.** There is no payment entity, field, badge or transition anywhere in these files. The only money figure is the computed "Est. value".

### 3.12 Conflict / double-booking rules (`clashes(b, items)`)

- Skipped (returns none) when the booking is Cancelled or Completed. Only compares against other bookings of the **same tour name** that are neither Cancelled nor Completed.
- Tour definition is looked up by name in `tours()`; unknown tours fall back to `{kind:'dep', cap:8, len:3}`.
- `kind: 'private'`: clash when date spans overlap (`[date, date + len − 1]`). Message: "Overlaps `{name}`’s private tour (`{start}` – `{end}`, `{status lowercase}`)". One message per overlapping booking.
- `kind: 'day'`: same `date` **and** same `time`; `kind: 'dep'`: same `date` only. Sum `ad + ch` across them including this booking; clash when the sum exceeds `cap` (default 8). Message: "Over capacity: `{seats}` of `{cap}` seats on `{date}`[ at `{time}`] with `{name} ({status}, {seats})`, …".
- Seed clashes: Marco Rossi (5, Pending) + Claire Dubois (4, Confirmed) on Icherisheher 21 Nov 2026 14:00 = 9 of 8; Thomas Becker (14–21 Jun 2027) overlaps Rachel Green (16–23 Jun 2027) on Private Grand Azerbaijan.
- Clashes are warnings, never hard blocks: both confirming and rescheduling can be forced.

### 3.13 Estimated value

Per booking: `base = ad * price + ch * price / 2` (children half price). If the tour maps to a promo tour id, `quote(tid, ad, ch, {email, date})` picks the single largest applicable discount (active campaigns matching tour / visibility / min guests / min children / book-ahead, personal discounts for that email, approved discount requests) and `total = base − amount`. Label: "`{name}` · `{15% off | $300 off}` (−`$207`)" or "None".

Seed results: Eleanor $1,173 (was $1,380), Thomas $4,312 (was $4,900), Henrik $1,224 (was $1,440), Kenji $600, Marco $600, Rachel $4,600 (was $4,900), Omar/Lankaran $1,764 (was $1,960), Priya $150 (was $170), Claire $480, Omar/Fire $495, Fatima $1,512 (was $1,680), Maria $152 (was $165), David $1,173 (was $1,380).

Promo data is read from `localStorage['aj-promo']` (falling back to built-in defaults) and updated live through a `storage` listener and `BroadcastChannel('aj-promo')`, so edits on the Discounts screen change Bookings values without reload. The value is **recomputed on every render from today's promotions** — it is not stored on the booking, so Completed/Cancelled bookings also change when a campaign changes.

### 3.14 Availability engine present in the script but not rendered

The script also carries `tours()`, `dayInfo()`, `slotInfo()`, `guideBusy()`, `nextAvail()` and `calCells()` (the customer booking calendar logic: day states `open | limited | full | hold | closed | past`, Sunday day off, guide-away rules, per-slot capacity) plus `serverSubmitRequest()` / `serverDecide()` (discount-request validation). **None of it is used by the Bookings markup** — only `tours()` is read, by `clashes()`. There is no calendar view on this screen. Document these with the public Booking and Promotions screens.

---

## 4. Settings & appearance (`AdminSettings.dc.html`)

Purpose: tenant branding (theme, colour scheme, corners, heading font) with a live preview, plus profile, contact/social and SEO/homepage content.

### 4.1 Section tabs

`<div role="tablist" aria-label="Settings sections" class="tabs-list no-scrollbar mb-6 max-w-full justify-start overflow-x-auto">` with `tabs-trigger` buttons:

| id | Label |
|---|---|
| `appearance` (default) | Appearance |
| `profile` | Profile |
| `contact` | Contact & social |
| `seo` | SEO & homepage |

Only one section is rendered at a time. Design-tool prop `startSection` selects the initial one. The tab is not reflected in the URL.

**Not in the design:** notification settings, booking rules (lead time, capacity, cancellation policy), team/members, billing, domain, currency/timezone/locale. (Discount-request settings such as `notify` and `responseDays` live on the Discounts screen, not here.)

### 4.2 Appearance

Wrapper: `grid gap-6 2xl:grid-cols-[1fr_420px]` — controls column (`flex flex-col gap-6`) + live preview aside. Below `2xl` the preview stacks under the controls.

All pickers are `role="radiogroup"` containers (labelled by the card title) of `<button role="radio" aria-checked>` options. Every pick applies immediately, persists, and shows a toast. There is no Save button in this section.

**Theme** — card title "Theme", description "Your brand colours across the public website and this dashboard. Changes apply instantly." Grid `grid gap-4 sm:grid-cols-2`. Option button: `group flex flex-col gap-3 rounded-xl border-2 border-border p-3 text-left transition-all hover:border-ring aria-checked:border-primary aria-checked:shadow-md`.

- Mini preview, self-themed: `<div data-theme="{id}" class="{dark|light} overflow-hidden rounded-lg border bg-background">` — a hero strip `flex h-14 items-end bg-hero p-3` with "Aurelia **Journeys**" (`font-display text-lg leading-none text-hero-foreground`, second word `text-highlight`), then a swatch row `flex items-center gap-2 p-3`: `h-7 flex-1 rounded-md bg-primary`, `h-7 w-10 rounded-md bg-highlight`, `h-7 w-10 rounded-md bg-secondary`, `h-7 w-10 rounded-md border bg-card`. Each mini preview follows the current light/dark mode. This requires theme tokens to be scoped by a nested `[data-theme]` attribute, not only on the root.
- Caption row: name `block font-bold` + description `text-xs text-muted-foreground`; radio indicator `flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-primary` with inner `h-2.5 w-2.5 rounded-full bg-primary` when selected.

| Theme id | Name | Description |
|---|---|---|
| `emerald` (default) | Emerald & Gold | Deep emerald, ivory and champagne |
| `caspian` | Caspian Blue | Sea blue, sand and copper |
| `pomegranate` | Pomegranate | Garnet red, cream and saffron |
| `graphite` | Graphite | Neutral shadcn zinc with amber |

Toast: "`{name}` theme applied to your website".

**Colour scheme** — description "Light, dark, or follow each visitor’s device setting." Grid `grid grid-cols-3 gap-3`; option `flex flex-col items-center gap-2 rounded-lg border-2 border-border p-4 text-sm font-semibold transition-all hover:border-ring aria-checked:border-primary aria-checked:bg-accent` with a `size-5` stroke icon.

| Mode id | Label | Icon |
|---|---|---|
| `light` (default) | Light | sun |
| `dark` | Dark | crescent moon |
| `system` | System | monitor |

Toast: "`{label}` colour scheme applied". `system` resolves through `matchMedia('(prefers-color-scheme: dark)')` and re-renders on change.

**Corner style** — description "Buttons, cards and inputs." Grid `grid grid-cols-4 gap-2`; option `flex flex-col items-center gap-2 rounded-lg border-2 border-border p-3 text-xs font-semibold aria-checked:border-primary aria-checked:bg-accent`; glyph is a corner bracket `h-7 w-9 border-2 border-l-primary border-t-primary border-b-transparent border-r-transparent` with inline `border-top-left-radius`.

| Radius id | Label | Glyph radius |
|---|---|---|
| `none` | Sharp | 2px |
| `sm` | Subtle | 6px |
| `md` (default) | Soft | 12px |
| `lg` | Round | 20px |

Toast: "`{label}` corners applied". The px values are the picker glyph's radius; the real `--radius` each id maps to is in the unavailable CSS.

**Heading font** — description "Body text stays Manrope." Grid `grid grid-cols-3 gap-2`; option shows `<span data-font="{id}" class="font-display text-3xl leading-none">Aa</span>` (nested `data-font` scoping) + `text-xs font-semibold` label.

| Font id | Label | Font family |
|---|---|---|
| `classic` (default) | Classic | Cormorant Garamond (inferred) |
| `modern` | Modern | Fraunces (inferred) |
| `sans` | Sans | Manrope (inferred) |

Toast: "`{label}` headings applied". The id → family mapping is inferred from the three families the page loads; the rule itself is in the unavailable CSS.

Corner style and Heading font sit side by side: `grid gap-6 md:grid-cols-2`.

**Footer actions** `flex flex-wrap gap-2`: `btn btn-default` "Preview website ↗" (to the public home page) and `btn btn-outline` "Reset to default" → saves `{theme:'emerald', mode:'light', radius:'md', font:'classic'}`, toast "Appearance reset to default". No confirmation dialog.

**Live preview** — `<aside class="card h-fit overflow-hidden 2xl:sticky 2xl:top-8" aria-label="Live preview">`. It is not separately themed; it inherits the page root, which has already changed.

1. Header `flex items-center justify-between border-b px-5 py-3`: "Live preview" (`text-sm font-semibold`) + `badge badge-outline` "`{theme name}` · `{Light|Dark|System}`".
2. Hero `relative h-48 overflow-hidden bg-hero`: photo `absolute inset-0 h-full w-full object-cover opacity-60`; text `relative flex h-full flex-col justify-end p-5 text-hero-foreground`: eyebrow `text-[10px] font-semibold uppercase tracking-[0.24em] text-highlight` "Private journeys · Azerbaijan"; headline `font-display text-3xl leading-none` "Discover the world *through local eyes.*" (`<em class="text-highlight">`).
3. Body `flex flex-col gap-4 bg-background p-5`:
   - Buttons `btn btn-highlight btn-sm rounded-full` "Book a Tour", `btn btn-default btn-sm rounded-full` "Explore", `btn btn-outline btn-sm rounded-full` "Contact" (non-interactive `<span>`s; `rounded-full` means they do not reflect the corner setting).
   - Tour card `card overflow-hidden`: image `h-28 w-full object-cover`; `flex flex-col gap-1 p-4`: "Sheki" / "★ 4.9", title `font-display text-xl font-semibold text-primary` "Silk Road to Sheki", "3 days · from **$690**".
   - Badges: `badge-default` "Featured", `badge-secondary` "Cultural", `badge-pending` "Pending", `badge-confirmed` "Confirmed".
   - Field: `label` "Email" + `<input class="input" placeholder="name@example.com">`.

### 4.3 Theme persistence and broadcast

Identical code in all three scripts (and the rest of the site), so every open page stays in sync.

- State shape (`ui`): `{ theme: 'emerald'|'caspian'|'pomegranate'|'graphite', mode: 'light'|'dark'|'system', radius: 'none'|'sm'|'md'|'lg', font: 'classic'|'modern'|'sans' }`. Default `{ theme:'emerald', mode:'light', radius:'md', font:'classic' }`.
- **Write** (`saveUi(patch)`): merge defaults ← current ← patch, then
  1. `localStorage.setItem('aj-ui', JSON.stringify(ui))`
  2. `new BroadcastChannel('aj-ui').postMessage(ui)` then close
  3. `setState({ ui })`
- **Read**: on mount, `localStorage.getItem('aj-ui')`, merged over defaults.
- **Listen**: `window` `storage` event (reloads when `e.key === 'aj-ui'` or key is empty); a long-lived `BroadcastChannel('aj-ui')` whose `onmessage` applies `m.data` (the full `ui` object) over defaults; `matchMedia('(prefers-color-scheme: dark)')` `change` → re-render. All wrapped in try/catch; listeners removed on unmount.
- **Apply**: root gets `data-theme`, `data-font`, `data-radius` and class `dark`/`light`.
- Payload = the whole 4-key object, not a diff. No versioning.
- Quick controls: header/sheet theme `<select>` → `saveUi({theme})`; sun/moon toggle → `saveUi({mode: currentlyDark ? 'light' : 'dark'})` — it flips on the *effective* darkness, so toggling while on `system` replaces `system` with an explicit value. Quick controls show no toast.
- Design-tool overrides: props `theme` (`admin | emerald | caspian | pomegranate | graphite`) and `mode` (`admin | light | dark | system`); `admin` means "use the stored choice". Canvas-only; not a product feature.
- Applied after mount, so a first paint in the default theme is possible. No server persistence in the design.

### 4.4 Profile

`<form class="flex max-w-4xl flex-col gap-6">` → one `card`: title "Profile", description "Shown on the About page and homepage introduction." Fields are `<label class="flex flex-col gap-2"><span class="label">…</span><control/></label>`.

| Field | Control | State key | Seed value |
|---|---|---|---|
| Photo | `avatar h-16 w-16 text-lg` "LM" + `<label class="btn btn-outline cursor-pointer">Change photo<input type="file" accept="image/*" class="sr-only">` | — | — |
| Logo | `btn btn-outline` label "Upload logo" + hidden file input | — | — |
| Full name | `input` | `name` | Leyla Mammadova |
| Brand name | `input` | `brand` | Aurelia Journeys |
| Languages | `input` (comma-separated text) | `langs` | Azerbaijani, English, Russian, Turkish |
| Years of experience | `input type="number"` | `years` | 12 |
| About section | `textarea rows="4"` | `about` | (bio paragraph) |
| Experience & qualifications · one per line | `textarea rows="3"` | `quals` | 3 newline-separated lines |

Row grouping: photo/logo `flex flex-wrap items-center gap-4`; name+brand and languages+years in `grid gap-4 sm:grid-cols-2`. Then `btn btn-default` "Save changes". File inputs have no handler or preview.

### 4.5 Contact & social

Card title "Contact & social", description "Used in the header, footer, contact page and WhatsApp buttons." Two rows of `grid gap-4 sm:grid-cols-3`:

| Field | Control | Key | Seed |
|---|---|---|---|
| Email | `input type="email"` | `email` | hello@aureliajourneys.az |
| WhatsApp number | `input` | `wa` | +994 50 123 45 67 |
| Working hours | `input` | `hours` | Mon–Sat 9:00–19:00 AZT |
| Instagram | `input` | `ig` | @aureliajourneys |
| YouTube | `input` | `yt` | youtube.com/@aureliajourneys |
| Facebook | `input` | `fb` | facebook.com/aureliajourneys |

Then "Save changes".

### 4.6 SEO & homepage

Card title "SEO, homepage & footer", description "How your site appears in search and what visitors see first."

| Field | Control | Key | Seed |
|---|---|---|---|
| SEO title · `{len}` / 60 | `input` | `seoT` | Aurelia Journeys — Private Tours in Azerbaijan |
| SEO description · `{len}` / 160 | `textarea rows="2"` | `seoD` | Small-group and private journeys through Baku, Sheki, Gobustan and Khinalug, guided by licensed guide Leyla Mammadova. |
| Search preview | `rounded-lg border bg-muted/40 p-4`: "Search preview" (`text-xs text-muted-foreground`); title `mt-1 text-[17px] text-sky-700 dark:text-sky-400`; domain `text-xs text-emerald-700 dark:text-emerald-400` "aureliajourneys.az"; description `mt-0.5 text-[13px] text-muted-foreground` — live-bound | — | — |
| Homepage headline | `input` | `hero` | Discover the world through local eyes. |
| Homepage featured tours | `select` | `featMode` | `manual` — options `manual` "Packages marked “Featured”", `popular` "Most popular automatically", `rated` "Highest rated automatically" |
| Footer description | `textarea rows="2"` | `footer` | Private and small-group journeys across Azerbaijan. |

Headline + featured select share `grid gap-4 sm:grid-cols-2`. Counters are informational: nothing blocks or warns past 60/160.

### 4.7 Save behaviour

All three "Save changes" buttons call the same handler: toast "Saved — changes are live on your website". There is **no validation, no dirty state, no disabled/loading state, no error path and no persistence** (unlike appearance, the `st` object is not written to storage). Appearance changes save instantly with their own toasts.

---

## 5. Component and variant inventory

| Design class | Variants seen here | Where |
|---|---|---|
| `btn` | `btn-default`, `btn-outline`, `btn-ghost`, `btn-secondary`, `btn-destructive`, `btn-highlight` (preview only); sizes `btn-sm`, `btn-icon` | everywhere |
| `badge` | `badge-pending`, `badge-confirmed`, `badge-completed`, `badge-cancelled`, `badge-highlight`, `badge-default`, `badge-secondary`, `badge-outline` | nav counters, statuses, preview |
| `card` | `card-header`, `card-title`, `card-description`, `card-content` | all screens |
| `tabs-list` / `tabs-trigger` | `aria-selected` | booking status, settings sections |
| `table` | plain | overview, bookings |
| `sheet-left` / `sheet-right` + `overlay` | — | mobile nav / booking detail |
| `dialog` + `overlay` | `role="alertdialog"` | cancel, confirm-despite-clash |
| `alert` | `alert-destructive` | conflict banner, sheet conflict, date warning |
| `toast` | single style, emerald dot | bookings, settings |
| `avatar` | default, `h-8 w-8 text-xs`, `h-16 w-16 text-lg` | shell, profile |
| `input`, `textarea`, `select`, `label`, `separator` | — | forms |
| `side-link` | `aria-current="page"` | nav |

Matching names confirmed to exist in the `@shadcn` registry (via the shadcn MCP registry listing, names only — APIs not reviewed here): `sidebar`, `sheet`, `alert-dialog`, `dialog`, `tabs`, `table`, `badge`, `button`, `card`, `alert`, `avatar`, `input`, `textarea`, `select`, `native-select`, `label`, `separator`, `radio-group`, `toggle-group`, `sonner`, `empty`, `skeleton`, `chart`. Status and `highlight` badge/button variants are custom and must be added.

---

## 6. Roles and permissions

- **None of these three screens has a role indicator, a "Viewing as" control, or any role-based hiding/disabling.** Every action on Bookings and every field on Settings is available to the single visible user, "Leyla Mammadova" (shown without a role label).
- The only role model in the admin design is on the Discounts screen (`AdminPromotions.dc.html`, outside this doc's scope): a header select "Viewing as" with `owner` = "Leyla Mammadova · Owner" and `assistant` = "Kamran Huseynov · Assistant", driving a page-local `viewOnly = role !== 'owner'`. That `role` lives in that page's component state only — it is not persisted, not in the shell, and not shared with other pages.
- The Bookings script carries a copy of the discount-decision rule: `serverDecide()` returns `403 "Only owners can approve or reject discount requests."` when `dec.role !== 'owner'`. It is unused on this screen.
- The one access-flavoured label here is "Internal notes · only visible to you" — worded for a single user; the design does not say whether assistants see or write notes.
- Consequence: the owner/assistant matrix for Overview, Bookings and Settings is **undefined by the design** and needs a product decision (suggested defaults in §9).

---

## 7. Data shapes

### 7.1 Booking (`state.items[]`, built by `B(ref, name, country, tour, date, ad, ch, price, status, req, extra)`)

| Field | Type | Example | Notes |
|---|---|---|---|
| `ref` | string | `'AJ-SHE-4821'` | `AJ-<3-letter tour code>-<4 digits>`; used as the id |
| `name` | string | `'Eleanor Whitfield'` | guest; no separate customer id |
| `country` | string | `'United Kingdom'` | |
| `tour` | string | `'Silk Road to Sheki'` | tour **name** (not id); joined to tours by name |
| `date` | string (ISO date) | `'2027-04-18'` | tour start date |
| `ad` | number | `2` | adults |
| `ch` | number | `0` | children (half price) |
| `price` | number | `690` | per-adult price, USD |
| `status` | `'Pending' \| 'Confirmed' \| 'Completed' \| 'Cancelled'` | `'Pending'` | Title-case strings |
| `req` | string | `'26 h ago'`, `'Nov 2'` | pre-formatted "requested" label, not a timestamp |
| `notes` | string | `'None'` | guest's notes |
| `alt` | string | `'—'` or `'2027-05-09'` | alternative date |
| `lang` | string | `'English'` | tour language |
| `pickup` | string | `'Hotel in Baku'`, `'Fairmont Baku'` | |
| `time` | string | `''` or `'14:00'` | slot for day tours |
| `method` | `'WhatsApp' \| 'Email'` | `'WhatsApp'` | preferred contact |
| `email` | string | `'eleanor@example.com'` | default: first name + `@example.com` |
| `phone` | string | `'+44 7700 900821'` | placeholder: fixed prefix + last 3 ref digits |
| `log` | `{ at: string, text: string }[]` | `[{ at:'Nov 3, 10:12', text:'Confirmed by WhatsApp. No pork.' }]` | newest first; notes + audit entries |

Derived per render: `dateL` ("18 Apr 2027"), `timeL` (" · 14:00" or ""), `pax` ("2 adults, 3 children"), `cls` (badge class), `valueL`, `baseL`, `discL`, `hasDisc`, `clash: string[]`, `hasClash`, `open()`.
Selected booking adds: `alt` (formatted), `wa`, `mail`, `canConfirm`, `canComplete`, `canCancel`, `canReopen`, `cancelLabel` ("Decline request" | "Cancel booking"), `first` (first name).

Seed set: 13 bookings — 7 Pending, 3 Confirmed, 2 Completed, 1 Cancelled — across 7 tour names; "Omar Haddad" appears on two bookings.

### 7.2 Customer and payment

No customer object and no payment object exist. Guest data is denormalised onto the booking (`name`, `country`, `email`, `phone`, `method`). No payment fields.

### 7.3 Bookings page state

`{ q:'', tab:'All', tourF:'all', sel: null | ref, draftDate:'', draftNote:'', toast:'', confirm:false, confirmClash:false, dateWarn:'', onlyClash:false, items: Booking[], ui?, promo?, nav? }`

### 7.4 Tour definition (`tours()`, used here only for clash checks)

`{ name, kind: 'day'|'dep'|'private', cap?: number, len?: number (days), price, meta, img, slots?: string[] (day), deps?: { [isoDate]: seatsTaken } (scheduled departures), weekly?: number (weekday index), full?: string[], booked?: [startIso, endIso, 'booked'|'hold'][] (private) }`

Example: `old: { name:'Icherisheher & Flame Towers', kind:'day', cap:8, price:120, meta:'Historical · 6 hours', img:'oldcity', slots:['09:00','14:00','18:00'] }`. Six tours are defined here (`sheki, khin, grand, fire, old, food`); `promoTours()` lists nine `{ n, p }` entries (adds `wine, lank, bespoke`), so "Lankaran Tea & Hirkan Forest" has a price but no capacity definition.

### 7.5 Promotions data (read-only on this screen; full detail belongs to the Discounts doc)

- `settings`: `{ requestsEnabled: true, maxRequestPct: 30, notify: 'email+whatsapp', responseDays: 2, stacking: 'best' }`
- `campaigns[]`: `{ id:'c1', name, code:''|'WELCOMEBACK', type:'percent'|'fixed', value, tours: string[] | ['all'], start, end (ISO), visibility:'public'|'private', assigned: string[] (emails), minGuests, minChildren, bookAhead (days), active: boolean, uses, blurb }`; derived status `Inactive | Expired | Scheduled | Active`.
- `manual[]` (personal discounts): `{ id:'m1', name, email, booking, tour:'any'|tourId, type, value, expiry, note, by, at, usedBy }`
- `requests[]`: `{ id:'DR-1046', name, email, phone, tour, booking, guests, type, value, reason, status:'Pending'|'Approved'|'Rejected', at, decision: null | { type?, value?, note?, reason?, by, at, notified } }`
- `log[]`: `{ at:'2026-11-15 10:20', who, what, kind:'request'|'approve'|'reject'|'campaign'|'manual'|'used' }`
- Quote result: `{ base, best: { source, label, type, value, amount, id } | null, amount, total, others, all }`

### 7.6 Overview objects

| Object | Shape | Example |
|---|---|---|
| KPI | `{ label, v, trend, tc, dot, href }` (all strings; `tc`/`dot` are class strings) | `{ label:'Pending', v:'7', trend:'2 date clashes to resolve', tc:<warn classes>, dot:'h-2 w-2 rounded-full bg-amber-500', href:'AdminBookings.dc.html' }` |
| Chart row (source) | `[month, requests, confirmed]` | `['Nov', 44, 31]` |
| Chart bar (derived) | `{ m, r, c, d, rt, ct }` | `{ m:'Nov', r:'91.66…%', c:'64.58…%', d:'0.3s', rt:'44 requests', ct:'31 confirmed' }` |
| Upcoming tour | `{ mo, d, t, who }` | `{ mo:'Nov', d:'18', t:'Baku Food & Wine Evening', who:'Priya Raman · 2 guests' }` |
| Recent booking | `{ ref, guest, tour, date, status, cls }` | `{ ref:'AJ-SHE-4821', guest:'Eleanor Whitfield', tour:'Silk Road to Sheki', date:'Apr 18, 2027', status:'Pending' }` |
| Inquiry | `{ name, when, msg, wa, mail }` | `{ name:'Kenji Watanabe', when:'2 h ago', msg:'Is Khinalug possible in late March for a photography group of five?', wa:'https://wa.me/819012345678', mail:'mailto:kenji@example.com' }` |

Recent bookings: AJ-SHE-4821 Pending, AJ-GRA-3307 Pending, AJ-FOO-1194 Confirmed, AJ-OLD-7720 Confirmed, AJ-LAN-5512 Completed. Inquiries: Kenji Watanabe (2 h ago), Rachel Green (Yesterday), Ahmed Siddiqui (Nov 12). There is no separate "activity item" type on Overview.

### 7.7 Settings objects

- `ui` — §4.3.
- `st` (all strings): `{ name, brand, langs, years, about, quals, email, wa, hours, ig, yt, fb, seoT, seoD, hero, featMode: 'manual'|'popular'|'rated', footer }` — seeds in §4.4–4.6.
- Page state: `{ sec: 'appearance'|'profile'|'contact'|'seo', toast: '', st, ui?, nav? }`.
- `img()` — map of 8 image keys (`baku, oldcity, gobustan, yanardag, sheki, khinalug, caspian, lankaran`) to blob URLs; the preview uses `oldcity` and `sheki`.

---

## 8. Motion, toasts, empty and loading states

| Element | Motion | Trigger |
|---|---|---|
| Chart bars | `animate-grow` + `origin-bottom`, staggered `animation-delay` 0s, 0.06s … 0.30s per month (both bars of a month share the delay). Keyframes not available; inferred scaleY 0 → 1 | on mount |
| KPI cards | `transition-shadow hover:shadow-md` | hover |
| Theme / mode option cards | `transition-all`; `hover:border-ring`; selected `aria-checked:border-primary` (+ `shadow-md` for themes, `bg-accent` for others) | hover / select |
| List rows | `hover:bg-muted/50` | hover |
| Links | `underline-offset-4 hover:underline` | hover |
| Mobile top bar | `backdrop-blur` over `bg-background/95` | static |
| Sheets / dialogs / toast | mount/unmount via conditional render; any enter animation lives in the unavailable CSS. No exit animation is possible as built (node is removed immediately) | open / close |

No reduced-motion handling is visible in the markup.

Toasts: `<div role="status" class="toast"><span class="h-2 w-2 rounded-full bg-emerald-500"></span>{message}</div>` — one at a time, replaced by the next, auto-dismiss after **3000 ms**, no close button, no action, no variants. The same green-dot style is used for validation nudges ("Choose a date first", "Write a note first"). Overview has no toast. Full message list: §3.10, §4.2, §4.7.

Empty states: only the bookings list ("No bookings match"). No empty states are designed for Overview cards, the log (renders nothing), inquiries or upcoming tours.

Loading / skeleton / error states: **none in the design.** All data is synchronous in-memory.

---

## 9. Implementation notes for multi-tenant mapping

### 9.1 Becomes tenant data (DB)

| Design source | Wayfold tenant field(s) |
|---|---|
| `ui.theme`, `ui.radius`, `ui.font` | tenant branding: `theme_id`, `radius_id`, `heading_font_id` — rendered server-side as `data-theme` / `data-radius` / `data-font` on the tenant's public site and workspace so there is no flash |
| `ui.mode` | tenant **default** colour scheme (`light | dark | system`) for the public site. The design also lets the admin's personal sun/moon toggle write this same value; split it: tenant default (DB) vs per-user dashboard preference (cookie or user profile) |
| Brand wordmark "Aurelia" + "Admin", preview "Aurelia Journeys" | tenant `brand_name` (and a short wordmark); "Admin" eyebrow is product chrome |
| Logo upload, profile photo | tenant `logo_url`; owner/guide `photo_url` (file storage, per-tenant path) |
| `st.name`, `langs`, `years`, `about`, `quals` | guide profile (tenant-level, or per member if a tenant has several guides); `langs` and `quals` should be arrays |
| `st.email`, `wa`, `hours`, `ig`, `yt`, `fb` | tenant contact + social links |
| `st.seoT`, `seoD`, `hero`, `featMode`, `footer` | tenant site content / SEO settings |
| Search-preview domain `aureliajourneys.az` | tenant domain / subdomain |
| "View website ↗", "Preview website ↗" | link to the tenant's public site URL |
| Greeting, date line, avatar initials, user name | current user + tenant timezone |
| Nav counters (7 pending bookings, 2 pending discount requests) | live per-tenant counts |
| KPIs, chart series, upcoming tours, recent bookings, inquiries | per-tenant aggregates/queries; every query scoped by tenant id |
| `$` currency, `en-GB` dates, "AZT" | tenant currency, locale and timezone (hard-coded in the design) |
| `AJ-` reference prefix | per-tenant booking reference prefix/sequence |
| `aj-ui` / `aj-promo` storage keys and channels | if a client-side sync channel is kept, namespace by tenant; the source of truth moves to the DB |
| Capacity, slots, departures, private-tour spans | per-tenant tour/availability tables (currently hard-coded in `tours()`) |

Also store on the booking what the design recomputes or flattens: a real `created_at` (instead of `req`), the quoted price/discount snapshot at request time (instead of the live recompute in §3.13), a `tour_id` (instead of the tour name), a `customer_id`, and typed log entries with author and kind (note vs status change vs date change).

### 9.2 Admin actions that need server-side checks

Every one must verify the session, the membership in the tenant that owns the record, and the role — none of this exists in the design, where all mutations are local state.

| Action | Server-side rules to enforce |
|---|---|
| Confirm booking | status is Pending; re-run the clash check on the server; require an explicit override flag to confirm into a clash; write audit entry with actor |
| Decline / cancel | status is Pending / Confirmed respectively; audit entry |
| Mark completed | status is Confirmed; decide whether a future-dated tour may be completed (design does not block it) |
| Reopen as pending | status is Cancelled; re-run the clash check |
| Change tour date | valid date; re-run the clash check; explicit override flag for "Save anyway"; audit entry; decide whether Completed/Cancelled bookings may be re-dated (design allows it) |
| Add internal note | non-empty; record author; never expose to the guest; decide per-role visibility |
| Read bookings / guest contact details | tenant scoping; guest email/phone are personal data |
| Appearance changes (theme, mode, radius, font, reset) | validate ids against the allowed enums; role allowed to change branding |
| Profile, contact/social, SEO/homepage saves | role check; field validation (email, URL/handle, length limits for SEO fields, numeric years); file type/size checks for logo and photo uploads |
| Overview data | tenant-scoped aggregates only |

Suggested role split, to be confirmed since the design defines none for these screens: owner — everything; assistant — view Overview and Bookings, add notes, possibly confirm/decline, but no branding/settings writes and no forced clash overrides. The only owner-only rule the design states explicitly is approving/rejecting discount requests.

### 9.3 Gaps and inconsistencies to resolve before building

1. No payment model at all (status, amounts paid, "mark paid").
2. No roles on these screens; "Viewing as" exists only on Discounts and is page-local.
3. "Declined" and "Cancelled" share one status.
4. Three different "today" values: Overview header 14 Nov 2026, promotions clock `2026-11-15`, availability cut-off `2026-11-16`.
5. Date formats differ: Overview "Apr 18, 2027" vs Bookings "18 Apr 2027"; seeded log timestamps "Nov 3, 10:12" vs generated "16 Nov, 10:12".
6. Clash counts differ: Overview says "2 date clashes", Bookings banner counts 4 bookings.
7. Overview KPI "Confirmed 27" vs 3 confirmed bookings in the Bookings seed (different sample sets); nav counters are static.
8. Mode is one shared setting for the public site and the admin's own dashboard.
9. Est. value is recomputed live from current promotions rather than stored; fractional child prices are not rounded.
10. Clash detection for scheduled multi-day departures compares start dates only; tours missing from `tours()` fall back to capacity 8 / 3 days.
11. Profile/contact/SEO saves do not persist or validate; file uploads are inert.
12. Dialogs and sheets have no Escape handling, focus trap or focus return; alert-dialog overlays ignore clicks.
13. Availability-calendar and discount-validation code is present in the Bookings script but unused there.
14. Preview buttons are forced `rounded-full`, so the live preview under-represents the corner setting.
