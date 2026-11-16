# 04 — Admin: Content and Discounts & Offers

Sources (design reference, read in full including script blocks):

- `design-reference/AdminPackages.dc.html` — `<title>` "Content Manager — Aurelia Admin", H1 "Content"
- `design-reference/AdminPromotions.dc.html` — `<title>` "Discounts & Offers — Aurelia Admin", H1 "Discounts & offers"

Conventions used below: "script" means the `class Component extends DCLogic` block; quoted strings are exact copy from the design; "NOT in design" marks something the brief asked about that the files do not contain. The shared component classes (`btn`, `card`, `badge`, `sheet-right`, `dialog`, `toast`, `chip`, `switch`, `tabs-list`, ...) have no CSS available, so their look and motion are inferred from usage only.

shadcn/ui component names referenced in this document (`sheet`, `alert-dialog`, `tabs`, `switch`, `table`, `badge`, `sonner`, `toggle-group`, `radio-group`, `combobox`, `select`, `native-select`, `checkbox`, `textarea`, `input`, `field`, `empty`, `alert`, `avatar`, `card`, `skeleton`) were verified to exist in the `@shadcn` registry through the shadcn MCP server. No Next.js or Tailwind v4 API is asserted here; verify those against official docs at implementation time.

---

## 0. Shared between both screens

### 0.1 Shell differences (shell itself is documented elsewhere)

- Sidebar "Content" group has two links: "Packages, reviews & journey" (`AdminPackages`) and "Discounts & offers" (`AdminPromotions`, with a trailing `badge badge-pending ml-auto` showing a **hard-coded `2`** — it should be the live pending-request count). Bookings shows a hard-coded `badge-highlight` `7`.
- `aria-current="page"` is set on the matching link on each screen.
- Page wrapper: `min-h-screen overflow-x-clip bg-muted/40 font-sans text-foreground antialiased lg:flex`; `<main class="min-w-0 flex-1 p-5 sm:p-8">`.
- Page header row: `mb-6 flex flex-wrap items-end justify-between gap-4`; caption `text-[13px] text-muted-foreground` above `h1.font-display.text-3xl.font-semibold.text-primary.sm:text-4xl`.
- Header right side (both screens): theme `<select class="select h-10 w-40">` (Emerald & Gold / Caspian Blue / Pomegranate / Graphite) plus a light/dark `btn btn-outline btn-icon`; wrapped in `hidden sm:flex`, so on phones they only exist in the mobile top bar / nav sheet.
- **Promotions only**: a "Viewing as" role `<select>` sits left of the theme controls (section 4).

### 0.2 Patterns reused everywhere

| Pattern | Markup / classes | Behaviour |
|---|---|---|
| Tabs | `div[role=tablist].tabs-list.no-scrollbar.mb-6.max-w-full.justify-start.overflow-x-auto` > `button[role=tab].tabs-trigger[aria-selected]` | Horizontal scroll on overflow, count pill inside trigger. Tab is component state, seeded by a `startTab` prop; not in the URL. |
| Filter chips | `div[role=group]` > `button.chip.h-9.px-3.5.text-[13px][aria-pressed]` | Single-select; label is `"{Label} · {n}"` (audit chips have no count). |
| Data table | `div.card.overflow-hidden` > `div.hidden.overflow-x-auto.md:block` (or `lg:block`) > `table.table.min-w-[...]`; first/last cells `pl-6` / `pr-6` | Horizontal scroll inside the card. |
| Phone stacked list | `ul.divide-y.md:hidden` (or `lg:hidden`) > `li.p-4` | Rendered alongside the table; breakpoint swaps them. |
| Side panel | `div.overlay` (click closes) + `aside[role=dialog][aria-modal=true].sheet-right.overflow-y-auto` (+ `sm:max-w-2xl` or `sm:max-w-xl`) | Close via overlay click, `✕` (`btn btn-outline btn-icon`, `aria-label="Close"`), or Cancel. No Escape handler and no unsaved-changes guard in script. |
| Confirm | `div.overlay.!z-[60]` (no click handler) + `div[role=alertdialog][aria-modal=true].dialog.!z-[60]` | Title `text-lg font-bold`, body `mt-2 text-sm text-muted-foreground`, footer `flex justify-end gap-2`, confirm is `btn btn-destructive`. Stacks above an open sheet. |
| Toast | `div[role=status].toast` with leading dot `span.h-2.w-2.rounded-full.bg-emerald-500` | One at a time; a new toast replaces the old and restarts the timer. 3000 ms on Content, 3200 ms on Promotions. Always the green dot, even for destructive results. |
| Field | `label.flex.flex-col.gap-2` > `span.label` + control (`input`/`select`/`textarea`) + `span.field-error[role=alert]` | Control gets `aria-invalid="true"` when its error is shown. Hint text inside the label: `span.font-normal.text-muted-foreground`. |
| Switch | `button[role=switch].switch[aria-checked]` > `span.switch-thumb` | `aria-label` is `"{Meaning}: {row title}"`. |
| Validation timing | A `touched` flag per form | Errors are computed on every render but only displayed after the first failed save; after that they update live as the user types. Save buttons are never disabled for invalidity. |

### 0.3 UI preference sync (`aj-ui`)

- `localStorage['aj-ui']` = `{ theme: 'emerald'|'caspian'|'pomegranate'|'graphite', mode: 'light'|'dark'|'system', radius: 'md', font: 'classic' }` (defaults shown: emerald / light / md / classic).
- On change: write localStorage, `new BroadcastChannel('aj-ui').postMessage(u)`, set state. Listeners: `storage` event (key `aj-ui`), BroadcastChannel `aj-ui`, and `matchMedia('(prefers-color-scheme: dark)')` change for system mode.
- Applied on the root as `data-theme`, `data-font`, `data-radius` and a `dark`/`light` class.

---

## 1. Content screen (`AdminPackages`)

**Purpose**: manage everything the tenant publishes on its public site: tour packages, reviews, the customer directory (read-only) and "My Journey" journal entries.

**Header**: caption "Everything you publish here appears on your website." / H1 "Content".

**Tabs** (`aria-label="Content type"`, prop `startTab`: `packages` | `reviews` | `customers` | `journey`, default `packages`). Each trigger has a count pill `rounded-full bg-muted-foreground/15 px-1.5 text-xs`:

| Key | Label | Count (seed) |
|---|---|---|
| `packages` | Packages | 9 |
| `reviews` | Reviews | 6 |
| `customers` | Customers | 6 |
| `journey` | My Journey | 6 |

There is **no role switch and no permission gating** on this screen, no pagination, no sorting, and no loading state.

### 1.1 Packages tab

**Toolbar** (`mb-4 flex flex-wrap items-center justify-between gap-3`): summary `text-sm text-muted-foreground` "`{pkPub}` published · `{pkDraft}` draft · `{pkFeat}` featured on homepage" (seed: 8 / 1 / 4), and `btn btn-default` "+ Create package". No search or filters.

**Table** (`md+`, `table min-w-[880px]`):

| Column | Content |
|---|---|
| Package | `img.h-11.w-16.shrink-0.rounded-md.object-cover` + bold title + `text-xs text-muted-foreground` "`{dest}` · `{photos}` photos" |
| Category | `cat` |
| Duration | `dur` (free text) |
| From | `font-semibold`, `"$" + price.toLocaleString('en-US')` e.g. `$2,450` |
| Featured | switch, `aria-label="Featured: {title}"` |
| Published | switch, `aria-label="Published: {title}"` |
| Actions (right) | `btn btn-outline btn-sm` "Edit"; `btn btn-ghost btn-sm text-destructive hover:text-destructive` "Delete" (`aria-label="Delete {title}"`) |

**Phone list** (`< md`): `li.flex.gap-3.p-4` — `img.h-16.w-20.rounded-md.object-cover`; truncated bold title; `text-xs text-muted-foreground` "`{cat}` · `{dur}` · `{priceL}`"; then a row with the Published switch labelled "Live" and an "Edit" `btn-outline btn-sm ml-auto`. **The Featured switch and Delete are absent on phone.**

**Empty state** (`p-14 text-center`): bold "No packages yet" + `btn btn-default` "Create your first package".

**Row actions and toasts**

| Action | Effect | Toast |
|---|---|---|
| Featured switch | toggles `feat` immediately (no confirm) | "Featured on homepage" / "Removed from homepage" |
| Published switch | toggles `pub` immediately (no confirm) | "“{title}” is live" / "“{title}” unpublished" |
| Edit | opens sheet pre-filled (`price`, `group` cast to strings) | — |
| Delete | opens confirm | "Deleted {title}" |

**Create / edit sheet** (`sheet-right sm:max-w-2xl`, `<form novalidate>`): sticky header (`sticky top-0 z-10 border-b bg-background px-6 py-4`, `h2.font-display.text-3xl.font-semibold.text-primary` "Create package" or "Edit package"), body `flex flex-col gap-4 p-6`, sticky footer (`sticky bottom-0 flex justify-end gap-2 border-t bg-background px-6 py-4`) with `btn-outline` "Cancel" and `btn-default` "Save package".

| # | Label | Control | Layout | Validation / error |
|---|---|---|---|---|
| 1 | Package title | text | full | trimmed length ≥ 3 — "Add a title (3+ characters)." |
| 2 | Destination | text | `sm:grid-cols-2` | none |
| 3 | Category | select: Cultural, Historical, Adventure, Food & Local, Private, Family, Customized | `sm:grid-cols-2` | none (default Cultural) |
| 4 | Starting price (USD) | number, `min=0` | `sm:grid-cols-3` | `Number(price) > 0` — "Enter a price above 0." |
| 5 | Duration | text, placeholder "e.g. 3 days" | `sm:grid-cols-3` | non-empty after trim — "Add a duration." |
| 6 | Max group | number, `min=1` | `sm:grid-cols-3` | none; saved as `Number(group) || 8` |
| 7 | Description | textarea rows 4 | full | none |
| 8 | Photos "· `{n}` uploaded · first is the cover" | dropzone label `cursor-pointer rounded-lg border-2 border-dashed bg-muted/40 p-6 text-center text-sm text-muted-foreground hover:bg-muted` with upload icon, "Drag photos here or browse", "JPG, PNG or WebP · up to 10 MB each"; hidden `input[type=file][accept=image/*][multiple]` | full | none. Script only adds the selected file count to `photos`; there is no preview, reorder, delete, real drag-drop, type or size check. |
| 9 | Itinerary "· one day per line, “Title: description”" | textarea rows 4 | full | none (stored as raw text) |
| 10 | Included | textarea rows 4, placeholder "One per line" | `sm:grid-cols-2` | none |
| 11 | Excluded | textarea rows 4, placeholder "One per line" | `sm:grid-cols-2` | none |
| 12 | Available dates "· comma-separated, blank = on request" | text | full | none (stored as raw text) |
| 13 | Toggle group (`rounded-lg border p-4`, label `text-sm font-semibold` + hint `text-xs text-muted-foreground`, switch on the right) | three switches | full | — |

Toggle group rows: "Featured on homepage" / "Shows in the Featured Experiences section" (`feat`); "“Popular” badge" / "Adds a badge on tour cards" (`popular`); "Published" / "Visible on your website" (`pub`).

New-package defaults: `{ title:'', dest:'', cat:'Cultural', price:'', dur:'', group:'8', desc:'', itin:'', inc:'', exc:'', dates:'', photos:0, feat:false, popular:false, pub:false }`.

Save: on create the record is prepended with a new numeric id and a fallback cover image; on edit it is merged over the existing record. Toasts: "Package updated", "Package created and published", or "Package created as draft".

**Delete confirm** (shared by packages, reviews, journey; `aria-label="Confirm delete"`): title "Delete “{name}”?", body "This removes it from your website immediately. This can’t be undone.", buttons `btn-outline` "Keep it" / `btn-destructive` "Delete". Toast "Deleted {name}".

### 1.2 Reviews tab

**Toolbar**: helper "Reviews you add appear as “Added by guide” unless linked to a completed booking." + `btn-default` "+ Add review". No search, filters or empty state.

**Layout**: card grid `grid gap-4 sm:grid-cols-2 xl:grid-cols-3` (same on phone, one column). Each `article.card.flex.flex-col.gap-2.5.p-5`:

1. Row: bold `name` and stars (`'★'.repeat(rating)`, `tracking-wider text-highlight`, `aria-label="{rating} stars"`).
2. `text-xs text-muted-foreground` "`{country}` · `{tour}`".
3. Title `font-display text-xl font-semibold text-primary`.
4. Body `text-[13px] leading-relaxed text-muted-foreground`.
5. Badges: source — `badge badge-verified` "✓ Verified booking" when `verified`, else `badge badge-manual` "✎ Added by guide"; `badge badge-default` "Featured" when `feat`; `badge badge-secondary` "Unpublished" when `!pub`.
6. Footer `mt-auto flex flex-wrap gap-1.5 border-t pt-3`: `btn-outline btn-sm` "Edit", "Publish"/"Unpublish", "Feature"/"Unfeature"; `btn-ghost btn-sm text-destructive` "Delete" (`aria-label="Delete review by {name}"`).

| Action | Toast |
|---|---|
| Publish / Unpublish | "Review published" / "Review hidden from site" |
| Feature / Unfeature | "Added to featured testimonials" / "Removed from featured" |
| Delete (confirm name is `review by {name}`) | "Deleted review by {name}" |

**Add / edit sheet** (`sheet-right`, default width, non-sticky header; `form.flex.flex-col.gap-4.p-6`; heading "Add review" or "Edit review"):

| Label | Control | Validation / error |
|---|---|---|
| Customer name | text (`sm:grid-cols-2` with Country) | trimmed length ≥ 2 — "Add the customer’s name." |
| Country | text | none |
| Rating | select, options "★★★★★ 5" … "★ 1" (values `5`..`1`) | none (default `5`) |
| Tour | select of all package **titles** (value is the title string) | none (default first package) |
| Review title | text | none |
| Full review | textarea rows 5 | trimmed length ≥ 10 — "Add the review text (10+ characters)." |
| (upload) | dashed dropzone "Upload customer photo or avatar · browse", single `image/*` | not wired to any state |
| (checkbox) | `input.checkbox.h-5.w-5` "Linked to a completed booking (shows “Verified booking”)" | free toggle — nothing checks a booking exists |

Footer: "Cancel" / "Save review". Toasts: "Review added" / "Review updated". New-review defaults: `rating:'5'`, `verified:false`, `feat:false`, **`pub:true`** (published immediately).

### 1.3 Customers tab (read-only directory)

**Toolbar**: "Created automatically from booking requests." + search `input.input[type=search]` (`w-full sm:w-80`, sr-only label "Search customers", placeholder "Search name, email or country…").

**Search rule**: case-insensitive substring match against the concatenation `name + email + country`. Phone, history and notes are not searched. Filters live on every keystroke.

**Table** (`md+`, `table min-w-[820px]`, rows `align-top`): Customer (`avatar h-9 w-9 text-xs` initials + bold name) · Email (`mailto:` link, `text-primary underline-offset-4 hover:underline`) · Phone (`whitespace-nowrap`) · Country · Tours (bold count) · History & notes (`text-[13px] leading-relaxed`: history in `text-muted-foreground`, then "Note: {note}" in `text-eyebrow`).

**Phone list** (`< md`): `avatar h-10 w-10 text-xs`; name + `badge badge-secondary` "`{n}` tours"; "`{country}` · `{phone}`"; truncated email link; history; "Note: …".

**Empty state**: `p-10 text-center text-muted-foreground` "No customers match “{query}”."

No create, edit, delete, row click or detail view. Initials = first letters of the first two words of the name.

### 1.4 My Journey tab

**Toolbar**: "Entries appear in the My Journey gallery, timeline and map." + `btn-default` "+ Add journal entry".

**Layout**: `grid gap-4 sm:grid-cols-2 xl:grid-cols-3`; `article.card.flex.flex-col.overflow-hidden` — cover `img.h-36.w-full.object-cover`; `text-xs text-muted-foreground` "`{loc}` · `{date}` · `{photos}` photos"; title `font-display text-xl font-semibold text-primary`; footer row with a switch + label "Published"/"Draft" (`text-sm font-semibold`) and `btn-ghost btn-sm text-destructive` "Delete".

| Action | Toast |
|---|---|
| Switch | "Entry published" / "Entry moved to drafts" |
| Delete (confirm) | "Deleted {title}" |

There is **no Edit action** for journal entries and no empty state.

**New entry sheet** (`sheet-right`, heading "New journal entry"):

| Label | Control | Validation / error |
|---|---|---|
| Tour or destination name | text | trimmed length ≥ 3 — "Add a name (3+ characters)." |
| Location | text (`sm:grid-cols-2`) | none; saved as "—" when blank |
| Date of visit | `input[type=month]` | none; saved as `toLocaleDateString('en-GB',{month:'short',year:'numeric'})` e.g. "Oct 2026", or "Undated" |
| Description | textarea rows 4 | none |
| Highlights & memorable moments "· one per line" | textarea rows 3 | none |
| (upload) | dashed dropzone "Cover, gallery images & videos · browse" + "`{n}` selected"; `accept="image/*,video/*"`, multiple | count **replaces** (not adds) on each selection |

Footer: "Cancel" / **"Save as draft"** (new entries are always `pub:false`). Toast "Journal entry saved as draft".

---

## 2. Discounts & offers screen (`AdminPromotions`)

**Purpose**: run public and private discount campaigns, hand out one-off personal discounts, decide customer discount requests, read an append-only audit log and set request rules. Every mutation is pushed to the public website immediately (section 3.8).

**Header**: caption "Campaigns, personal discounts and customer requests. Changes go live on your website instantly." / H1 "Discounts & offers". Right side: `label.flex.w-full.items-center.gap-2.text-sm.sm:w-auto` "Viewing as" + `select.select.h-10.flex-1.sm:w-56.sm:flex-none` (full-width row on phone), then the theme controls.

**View-only banner** (assistant only, above the KPI row): `div[role=status].alert.mb-5.flex.items-center.gap-3.border-amber-500/50.bg-amber-50.text-amber-900.dark:bg-amber-500/10.dark:text-amber-200` with a lock icon — "**View-only access.** Only owners can create campaigns, assign discounts or approve requests. Ask Leyla to change your permissions in Settings."

**KPI row**: `mb-6 grid grid-cols-2 gap-4 xl:grid-cols-5`; each is a `button.card.flex.flex-col.gap-1.p-4.text-left.transition-shadow.hover:shadow-md` — label `text-[13px] font-medium text-muted-foreground`, value `font-display text-[32px] font-semibold leading-none text-primary`, sub `text-xs text-muted-foreground`. With five cards in two columns the fifth sits alone on its row below `xl`.

| Label | Value | Sub | Click |
|---|---|---|---|
| Active campaigns | count with derived status `Active` (seed 5) | "`{n}` public · `{m}` private" (4 · 1) | Campaigns tab, filter `Active` |
| Pending requests | pending count (2) | "Reply within `{responseDays}` days" | Requests tab, filter `Pending` |
| Personal discounts | count with derived status `Active` (2) | "`{n}` used" (1) | Personal tab |
| Redemptions | sum of `campaign.uses` (143) | "Across all campaigns" | Audit log tab, filter `used` |
| Discount requests | "On" / "Off" | "Shown on website" / "Hidden from website" | Settings tab |

**Tabs** (`aria-label="Discount sections"`, prop `startTab`: `campaigns` | `personal` | `requests` | `history` | `settings`, default `campaigns`):

| Key | Label | Pill |
|---|---|---|
| `campaigns` | Campaigns | total campaigns, `ml-1.5 rounded-full bg-muted-foreground/15 px-1.5 text-xs` |
| `personal` | Personal discounts | total personal discounts, same neutral pill |
| `requests` | Requests | **pending** count, `ml-1.5 rounded-full bg-amber-500 px-1.5 text-xs text-white`; hidden when 0 |
| `history` | Audit log | none |
| `settings` | Settings | none |

### 2.1 Campaigns tab

**Toolbar**: chips `All` · `Active` · `Scheduled` · `Expired` · `Inactive`, each "`{label}` · `{count}`" (default `All`); `btn-default` "+ New campaign" (disabled when view-only).

**Table** (`lg+`, `table min-w-[1040px]`):

| Column | Content |
|---|---|
| Campaign | bold name; optional `font-mono text-xs text-muted-foreground` code beneath |
| Discount | `whitespace-nowrap font-semibold` — "`{value}`% off" or "$`{value}` off" |
| Applies to | `max-w-[200px] text-[13px] text-muted-foreground` — "All tours" or comma-joined tour names |
| Valid | `whitespace-nowrap text-[13px]` — start without year, " – ", end with year (en-GB), e.g. "1 Nov – 15 Dec 2026" |
| Visibility | `badge badge-secondary` "Public" or `badge badge-outline` "Private · `{n}` guest(s)" |
| Eligibility | `text-[13px] text-muted-foreground`, see `eligText` in 3.1 |
| Uses | integer |
| Status | badge (colour map in 3.2) |
| Active | switch, `aria-label="Active: {name}"`, disabled when view-only |
| Actions (right) | `btn-outline btn-sm` "Edit", `btn-ghost btn-sm text-destructive` "Delete" — both disabled when view-only |

**Phone / tablet list** (`< lg`): `li.flex.flex-col.gap-2.p-4` — name + `text-xs` validity with the status badge top-right; badge row (`badge badge-highlight` discount, visibility badge, `badge badge-outline` "`{uses}` uses"); `text-[13px] text-muted-foreground` "`{tours}` · `{eligibility}`"; action row with switch + "Active" label, "Edit" (`ml-auto`), "Delete". The code is not shown here.

**Empty state**: `p-10 text-center text-muted-foreground` "No campaigns in this view."

**Footnote** (`mt-3 text-[13px] text-muted-foreground`): "Expired, scheduled and inactive campaigns are hidden from the website and can’t be applied. Only one discount applies per booking — the best one."

**Row actions**

| Action | Audit entry (`kind: 'campaign'`) | Toast |
|---|---|---|
| Active switch | "Activated campaign “{name}”" / "Deactivated campaign “{name}”" | "“{name}” activated" / "“{name}” deactivated — removed from website" |
| Edit → save | "Edited campaign “{name}” ({discount label})" | "Campaign updated" |
| New → save | "Created campaign “{name}” ({discount label})" | "Campaign created — live on the website" if `active`, else "Campaign created" |
| Delete (confirm) | "Deleted campaign “{name}”" | "Campaign deleted" |

Delete confirm: title "Delete “{name}”?", body "It will stop applying immediately. Past bookings keep their price and the history stays in the audit log.", buttons "Cancel" / `btn-destructive` "Delete campaign". Delete is a hard removal from the campaigns array.

**Campaign editor sheet** (`sheet-right sm:max-w-2xl`; sticky header "New campaign" / "Edit campaign"; body `flex flex-col gap-5 p-6`; sticky footer "Cancel" / "Save campaign"):

| # | Label | Control | Validation / error |
|---|---|---|---|
| 1 | Campaign name | text (`sm:grid-cols-[1fr_180px]` with Code) | trimmed length ≥ 3 — "Give the campaign a name." |
| 2 | Code "(optional)" | text `font-mono uppercase`, placeholder "AUTUMN15"; forced to upper case on input | none; no uniqueness check |
| 3 | Discount type | select: `percent` "Percentage off the trip", `fixed` "Fixed amount off per booking" | — |
| 4 | "Percentage off (%)" or "Amount off ($)" (label follows type) | number, `min=1` | `> 0` — "Enter a discount above 0."; percent `> 90` — "Percentages can’t exceed 90%." No upper bound for fixed. |
| 5 | Starts | `input[type=date]` | — |
| 6 | Ends | `input[type=date]` | `end < start` — "End date must be after the start date." (same-day is allowed) |
| 7 | Applicable tour packages (fieldset) | `rounded-lg border p-3 sm:grid-cols-2`: "All tours" checkbox (`sm:col-span-2 font-semibold`) + one checkbox per tour | empty — "Choose at least one tour." |
| 8 | Visibility (fieldset, `role=radiogroup`) | two radio cards `rounded-lg border-2 border-border p-3 text-left aria-checked:border-primary aria-checked:bg-accent`: "Public" / "Shown on the Offers page and applied to everyone eligible"; "Private" / "Only for customers you assign — not shown publicly" | — |
| 9 | Assigned customers "· emails, one per line" (only when Private) | textarea `font-mono text-sm`, rows 3 | blank — "Add at least one customer email." No per-email format check. |
| 10 | Eligibility "· leave 0 for no rule" (fieldset, `sm:grid-cols-3`, labels `text-[13px]`) | three numbers `min=0`: "Minimum guests", "Minimum children", "Book days ahead" | none; saved as `Number(x) || 0` |
| 11 | Description on the Offers page | textarea rows 2 (`blurb`) | none |
| 12 | Active (bordered row) | switch; hint "Inactive campaigns are hidden and never applied." | — |
| 13 | Price preview (`rounded-lg bg-secondary/60 p-4`, eyebrow `text-xs font-semibold uppercase tracking-wider text-muted-foreground` "Price preview · per adult") | read-only list of up to the first 4 selected tours: name, struck-through original, bold new price | shown only when value > 0. Percent: one adult price. Fixed: label becomes "`{tour}` (2 adults)" and the maths uses 2 × price. |

Tour checkbox behaviour: "All tours" toggles `tours` between `['all']` and `[]`. While `all` is set every tour box renders checked; clicking any individual box drops `all` and leaves **only that one tour** selected.

New-campaign defaults: `{ name:'', code:'', type:'percent', value:'10', start: today, end:'2026-12-31', tours:[], visibility:'public', assignedTxt:'', minGuests:'0', minChildren:'0', bookAhead:'0', blurb:'', active:true }`.

On save: `assigned` = `assignedTxt.split(/[\s,]+/)` trimmed, lower-cased, empties removed (forced to `[]` for public); new id `'c' + Date.now()`, `uses: 0`, prepended.

### 2.2 Personal discounts tab

Layout `grid gap-6 2xl:grid-cols-[420px_1fr]` — below `2xl` the form stacks above the list.

**Left: "Assign a personal discount"** (`section.card.h-fit`; `card-header` with `card-title` + `card-description` "Applied automatically when this customer books with their email. Single use."; `card-content flex flex-col gap-4`)

| Label | Control | Validation / behaviour |
|---|---|---|
| Customer or booking | text combobox, placeholder "Search name, email or booking ref…", `autocomplete="off"` | Required — "Search and select a customer or booking." Results appear when the query has ≥ 1 character and nothing is picked: `ul[role=listbox].absolute.top-full.z-20.mt-1.max-h-64.w-full.overflow-y-auto.rounded-md.border.bg-popover.p-1.shadow-lg`, max 6 options, each `button[role=option]` with "**{name}** · {booking}" and `text-xs` "{email} · {tour}", `hover:bg-accent`. Match is a case-insensitive substring of `name + email + booking`. Typing again clears the pick. |
| (picked chip) | `flex items-center gap-3 rounded-lg border bg-muted/40 p-3` — avatar initials, bold name, "{email} · {booking} · {tour}", `btn-ghost btn-icon` ✕ (`aria-label="Clear customer"`) | Picking sets the input to the name and preselects "Applies to" with the tour of that booking. |
| Type | select: `percent` "Percentage", `fixed` "Fixed amount" (`grid-cols-2` with value) | — |
| "Percentage off (%)" / "Amount off ($)" | number `min=1`, default `10` | `> 0` — "Enter a discount above 0."; percent `> 90` — "Percentages can’t exceed 90%."; a past expiry appends "Expiry date is in the past." to this same error slot |
| Applies to | select: "Any tour" (`any`) + every tour | — |
| Expiry date "(optional)" | `input[type=date]` | must not be before today (see above) |
| Internal note "· not shown to the customer" | textarea rows 2, placeholder "Why this discount was given" | optional; stored as "—" when blank |
| (preview) | `rounded-lg bg-secondary/60 p-3 text-sm` | "On {tour} for 2 adults: {base} → {after} · expires {date}" or "· no expiry"; uses the picked booking's tour when "Any tour" is selected |
| (duplicate warning) | amber `alert[role=alert]` | "{name} already has an active personal discount ({label} on {tour}). Applying will replace it so the customer can’t receive two." |
| (submit) | `btn btn-default btn-lg`, disabled when view-only | "Apply discount", or "Replace & apply discount" when a duplicate exists |

Assign: prepends the new record, marks the duplicate (if any) `revoked: true`, audit `kind: 'manual'` "Assigned {label} personal discount to {name} ({booking})" plus " — replaced previous one", toast "Discount applied to {name}’s booking", then resets the form.

**Right: "Assigned personal discounts"** (`section.card.overflow-hidden`; description "Full record for auditing — revoked and used discounts stay listed.")

Table (`lg+`, `table min-w-[860px]`, rows `align-top`): Customer (bold name; `text-xs` "{email} · {booking}"; `text-xs text-eyebrow` "Note: {note}") · Discount · Applies to ("Any tour" or tour name) · Expires (en-GB "31 May 2027" or "No expiry") · Status badge · Assigned (`text-xs`: by, line break, date) · Action ("Revoke", `btn-ghost btn-sm text-destructive`, rendered only while status is Active, disabled when view-only).

Phone list (`< lg`): name + "{email} · {booking}" with status badge; "**{discount}** · {tour} · expires {date}"; note; footer "{by} · {at}" and Revoke.

Revoke confirm: title "Revoke {name}’s discount?", body "It will no longer apply to new bookings. The record stays in the audit log.", button "Revoke". Sets `revoked: true` (soft), audit `kind: 'revoke'` "Revoked personal discount for {name}", toast "Discount revoked".

No empty state is defined for this list.

### 2.3 Requests tab

**Disabled notice** (when `settings.requestsEnabled` is false): `alert mb-4 flex flex-wrap items-center justify-between gap-3 bg-background` — "**Discount requests are turned off.** Customers can’t send new requests; existing ones are still listed." + `btn-outline btn-sm` "Open settings".

**Filter chips**: `Pending` · `Approved` · `Rejected` · `All` with counts; default `Pending`.

**List** (same markup at every width; `flex-wrap` handles phones): `ul.divide-y` of full-width `button.flex.w-full.flex-wrap.items-center.gap-x-4.gap-y-2.px-4.py-4.text-left.hover:bg-muted/50.sm:px-6` containing: `avatar` initials; `min-w-[180px] flex-1` block with "**{name}** · {id}" and `text-[13px] text-muted-foreground` "{tour} · {guests} guest(s) · {booking}"; "Requested" (label `text-xs`, value `font-semibold`); "Price after"; timestamp `text-xs`; status badge. Clicking opens the detail sheet.

**Empty state**: "No requests in this view."

**Request detail sheet** (`sheet-right sm:max-w-xl`, `aria-label="Request {id}"`):

- Sticky header (`p-6`): `text-[13px] text-muted-foreground` "{id} · received {at}", `h2` customer name, status badge, ✕.
- Contact box (`rounded-lg bg-muted/60 p-4 text-sm`): Email, Phone, Booking (link to the Bookings screen).
- Definition list (`grid grid-cols-[140px_1fr] gap-x-4 gap-y-2.5 text-sm`): Tour · Guests · Trip price · Requested "**{label} ({amount}) → {price after}**" · Your private max "{max}% · not visible to the customer" · Reason (quoted, "—" if blank) · Existing offers (result of the best-discount engine for that tour/guests/email: "{offer} ({label}) already applies — the better of the two will be used, never both." or "None — no current offer applies").
- **Decided** state: a result box — approved: `alert border-emerald-600/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200`, title "Approved · {label}", text "Linked to {email} and {booking} · not used yet" (or "· used on {ref}") plus " · Note: {note}"; rejected: `alert alert-destructive`, title "Rejected", text = the reason shown to the customer. Meta line `text-xs opacity-80` "By {by} · {at} · customer notified" / "· customer not notified". No further actions.
- **Pending** state, after a `separator`:
  - Decision tabs `tabs-list grid w-full grid-cols-3`: "Approve in full" · "Approve lower" · "Reject". "Approve in full" gets `aria-disabled` (`cursor-not-allowed`, 40% opacity, click ignored) when the request exceeds the private maximum; the sheet then opens on "Approve lower".
  - Over-maximum alert (amber): "This request ({askedPct}%) is above your current private maximum of {max}%. You can approve up to {max}% or reject it."
  - *Approve in full*: `rounded-lg bg-secondary/60 p-3 text-sm` "Approve **{label}** ({amount} off) — customer pays **{after}** instead of {base}. Linked to {email} and {booking} · single use."
  - *Approve lower*: "Approve as" select (Percentage / Fixed amount) + value input (`min=1`); `p.field-hint` "Up to {asked} — what {first name} asked for" or "Up to {max}% (your maximum)"; live `p.field-error[role=alert]` carrying the server rule message; summary "Customer pays **{after}** instead of {base} · single use". Default value: half the requested percentage rounded down (min 1), or the maximum when the request is over it; default type is always percent.
  - *Reject*: "Reason shown to the customer" textarea rows 3, placeholder "e.g. We can’t discount peak dates, but the Autumn offer applies in October." (required).
  - "Internal note (optional)" textarea rows 2.
  - Checkbox (checked by default) "Notify {first name} by {email & WhatsApp | email | WhatsApp}".
  - Submit error `span.field-error[role=alert]`: "{message} ({http code})".
  - View-only line: "You have view-only access — only owners can decide."
  - Buttons: primary (disabled when view-only) — "Approve {label} & notify" (`btn-default`), "Approve lower & notify" (`btn-default`) or "Reject & notify" (`btn-destructive`); `btn-outline` "Later" closes without deciding.

### 2.4 Audit log tab

**Filter chips** (no counts; default `All`): All · Campaigns (`campaign`) · Personal (`manual`) · Requests (`request`) · Approved (`approve`) · Rejected (`reject`) · Redeemed (`used`) · Settings (`settings`). There is **no chip for `revoke`**; those rows only appear under All.

**Table** (`md+`, `table min-w-[720px]`): When (`whitespace-nowrap text-[13px] text-muted-foreground`) · Who (`text-sm font-semibold`) · What happened (`text-sm`) · Type (badge).

**Phone list** (`< md`): timestamp + type badge, then the description, then who (`text-xs font-semibold text-muted-foreground`).

**Footnote**: "History can’t be edited or deleted. Every campaign change, assignment, decision and redemption is recorded." Newest first. No empty state, search, date range, pagination or export.

### 2.5 Settings tab

`grid max-w-5xl gap-6 lg:grid-cols-2`.

**Card 1 — "Customer discount requests"** ("Let customers ask for a special discount when no offer applies."):

| Control | Detail | Save model |
|---|---|---|
| Allow discount requests (bordered row, switch) | hint "When off, the request option is hidden on the website." | immediate |
| Maximum discount customers can request (bordered block) | `badge badge-outline gap-1` with lock icon "Private · never shown to customers"; `input.w-24[type=number][min=1][max=90][step=1]` + "% of the trip price · all tours" + `btn-outline btn-sm ml-auto` "Save". Error "Enter a whole number from 1 to 90." Help: "Fixed-amount requests are converted to a percentage of the trip price and held to the same limit. Larger requests are blocked with a general message that doesn’t reveal this number." Amber warning (`text-xs font-semibold text-amber-700 dark:text-amber-400`) when pending requests exceed the limit: "{n} pending request(s) are above this limit — you can approve them only up to the limit, or reject." | explicit Save button (draft value held locally) |
| Promised response time | select: "Within 1 day" / "Within 2 days" / "Within 3 days" | immediate on change |
| Notify customers about decisions by | select: `email+whatsapp` "Email & WhatsApp", `email` "Email only", `whatsapp` "WhatsApp only" | immediate on change |

All four controls are disabled when view-only. Every save writes an audit entry (`kind: 'settings'`) and shows the toast "Settings saved — live on your website".

**Card 2 — "Rules & permissions"** ("Who can change pricing, and how discounts combine."), entirely read-only:

- `rounded-lg bg-secondary/60 p-4` "Combining discounts" — "Never combined. Each booking gets the single best eligible discount — public offer, private offer, personal discount or approved request. Personal and approved discounts are locked after one use."
- Member list (`divide-y rounded-lg border`): avatar + name + role with a badge — owner `badge badge-confirmed` "Full control"; assistant `badge badge-secondary` "View only".
- "Only owners can create or edit campaigns, assign personal discounts, and approve or reject requests."
- "How limits are enforced" ordered list: (1) "Checked in the customer’s browser as they type, with a general message." (2) "Re-checked by the server when the request is submitted. Tampered or oversized requests are refused (422)." (3) "Re-checked when you decide: the approval can’t exceed what was asked for or your current maximum, and only owners can decide (403)."

---

## 3. Business rules (from script)

`promoNow()` returns the fixed demo date `'2026-11-15'`; all "today" comparisons use ISO `YYYY-MM-DD` string comparison. Replace with the tenant-local current date.

### 3.1 Campaign model

- **Discount types — exactly two**: `percent` (1–90, off the whole trip) and `fixed` (USD off per booking, capped at the trip price). "Early bird", "group", "family" and "seasonal" are **not types**; they are ordinary campaigns expressed through eligibility rules and the date window. A "last-minute" rule is NOT in design (only "book at least N days ahead" exists).
- **Scope**: `tours` is either `['all']` or a list of tour ids. Category scope is NOT in design.
- **Eligibility** (0 = no rule): `minGuests` (adults + children ≥ N), `minChildren` (children ≥ N), `bookAhead` (travel date ≥ N days from today; fails when no travel date is known).
- **Visibility**: `public` (listed on the Offers page, applies to anyone eligible) or `private` (applies only when the booking email is in `assigned`; never listed).
- **Date window**: `start`..`end`, both inclusive.
- **Usage**: `uses` is a read-only counter incremented elsewhere (booking flow). Usage limits / per-customer limits are NOT in design.
- **Code**: optional label, upper-cased. The engine never reads it — there is no "enter a promo code" path; campaigns apply automatically.
- **Stacking**: never. `settings.stacking` is the constant `'best'` with no UI to change it.
- `eligText(c)`: joins with " · " — "`{minGuests}`+ guests", "at least `{minChildren}` child", "booked `{bookAhead}`+ days ahead", "assigned guests only" (private); or "Everyone" when no rule applies.

### 3.2 Campaign status (derived, never stored)

```
campStatus(c):
  if !c.active        -> 'Inactive'
  if c.end   < today  -> 'Expired'
  if c.start > today  -> 'Scheduled'
  else                -> 'Active'
```

- The only stored lifecycle field is the boolean `active` (the pause switch). Draft and Paused statuses are NOT in design: "Inactive" covers both.
- `Inactive` wins over date-based states, so a switched-off expired or future campaign reads Inactive.
- Only `Active` campaigns are applied or shown publicly. Transitions happen by toggling `active`, editing dates, or the passage of time; all four states are reachable from each other through those three levers. Delete is possible from any state.

Badge classes: Active `badge badge-confirmed`; Scheduled `badge badge-completed`; Expired `badge badge-secondary`; Inactive `badge badge-outline text-muted-foreground`; Pending `badge badge-pending`; Approved `badge badge-confirmed`; Rejected `badge badge-cancelled`; Used `badge badge-completed`; Revoked `badge badge-cancelled`.

### 3.3 Personal discounts

- **No code is generated.** A personal discount is bound to the customer's email (optionally recorded against a booking ref) and is "applied automatically when this customer books with their email". Id is `'m' + Date.now()`.
- Fields: type (`percent` ≤ 90 or `fixed`), value, scope (`any` or one tour id), optional expiry, internal note, assigning user, assignment date.
- **Single use**: `usedBy` is set to the redeeming booking ref (by the booking flow), after which it no longer applies.
- **Derived status**: `revoked` → Revoked; else `usedBy` → Used (rendered "Used on {ref}"); else `expiry && expiry < today` → Expired; else Active.
- **One active discount per customer per scope**: an existing Active discount conflicts when the emails match and either side is `any` or both name the same tour. Assigning then **replaces** it (old one soft-revoked in the same write).
- Revoke is a soft delete; revoked and used rows stay listed.

### 3.4 Discount requests

**Customer submission** — script method `serverSubmitRequest(p)`, commented "Mirrors the server: POST /api/discount-requests. Never trusts the client payload." Payload `{ tour, email, type, value, guests }`. Checks in order:

| # | Condition | Code | Message |
|---|---|---|---|
| 1 | `settings.requestsEnabled` is false | 403 | "Discount requests aren’t available at the moment." |
| 2 | unknown tour | 400 | "This tour can’t be found." |
| 3 | email fails `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` (after trim + lower-case) | 422 | "Add a valid email so we can reply." |
| 4 | type not `percent`/`fixed`, or value not finite, or value ≤ 0 | 422 | "Please enter a valid discount." |
| 5 | `fixed` and value ≥ trip base | 422 | generic message below |
| 6 | requested percentage > `settings.maxRequestPct` | 422 | generic message below |
| 7 | same email already has a `Pending` request for the same tour | 409 | "You already have a discount request waiting for this tour." |

Generic over-limit message (never reveals the cap): "We can’t consider a discount this large for this trip. Please request a smaller amount." Success returns `{ ok: true, value: round(value, 2 decimals) }`.

Helpers: `reqBase(tour, guests) = tourPrice × max(1, guests)` (every guest at adult price); `reqPct(type, value, base)` = value for percent, `value / base × 100` for fixed (999 when base is 0).

**Statuses**: `Pending` → `Approved` | `Rejected`. Both are terminal (no reopen, no edit, no withdraw). There is **no counter-offer status**: "Approve lower" is a one-sided partial approval that goes straight to `Approved` with `decision.partial = true`; the customer does not accept or decline it.

**Owner decision** — script method `serverDecide(id, dec)`, commented "Mirrors the server: POST /api/admin/discount-requests/:id/decision (owners only). Re-validates every rule." Payload `{ role, action: 'approve'|'reject', type?, value?, reason? }`. Checks in order:

| # | Condition | Code | Message |
|---|---|---|---|
| 1 | role is not owner | 403 | "Only owners can approve or reject discount requests." |
| 2 | request not found | 404 | "Request not found." |
| 3 | status is not `Pending` | 409 | "This request has already been decided." |
| 4 | reject with blank reason | 422 | "Add a reason so the customer understands." |
| 5 | approve with value ≤ 0 | 422 | "Enter the discount you’re approving." |
| 6 | approved percentage > requested percentage | 422 | "You can’t approve more than the customer asked for ({requested label})." |
| 7 | approved percentage > `maxRequestPct` | 422 | "That’s above your maximum of {max}%. Approve {max}% or less, or reject." |

Comparisons 6 and 7 use a `1e-9` tolerance and compare in percentage-of-base terms, so a percent request may be approved as a fixed amount and vice versa. "Approve in full" sends the request's own type and value, so it fails rule 7 if the cap has since been lowered below the request (hence the disabled tab).

**Result**: status changes, a `decision` object is stored, the approved discount becomes a single-use candidate bound to that email **and that tour**, an audit entry is written, and the customer is notified through the channel in `settings.notify` if the "Notify" box is ticked.

| Outcome | Audit text (`kind`) | Toast |
|---|---|---|
| Approve in full | "Approved {id} at {label} in full for {name}" + " · customer notified by {channel}" (`approve`) | "Approved — {first name} notified by {channel}" (or just "Approved") |
| Approve lower | "Approved {id} at {label} (requested {asked label}) for {name}" + notified suffix (`approve`) | same |
| Reject | "Rejected {id} for {name}" + notified suffix (`reject`) | "Rejected — {first name} notified by {channel}" (or "Rejected") |

Channel labels: "email & WhatsApp", "email", "WhatsApp". The notification content itself is not designed in these files.

### 3.5 "Only the single best discount applies" — exact algorithm

`quote(tourId, adults, children, { email?, date? })`:

1. `base = adults × price + children × price / 2` (children are half price). `email` is trimmed and lower-cased.
2. Build a candidate list, in this order:
   - **Campaigns** — keep a campaign only if all hold: derived status is `Active`; `tours` includes `'all'` or `tourId`; if `private`, an email is present and is in `assigned`; if `minGuests`, `adults + children ≥ minGuests`; if `minChildren`, `children ≥ minChildren`; if `bookAhead`, a `date` is supplied and `daysBetween(today, date) ≥ bookAhead`. Candidate `source` is "Private offer" or "Public offer", `label` is the campaign name.
   - **Personal discounts** (only when an email is supplied) — `email` matches, `usedBy` is empty, `expiry >= today`, and `tour` is `any` or `tourId`. `source` "Personal discount", `label` "Personal discount from Leyla" (use the tenant/guide name).
   - **Approved requests** (only when an email is supplied) — `email` matches, status `Approved`, `tour === tourId`, a decision exists, `usedBy` is empty. Uses `decision.type` / `decision.value`. `source` "Approved request", `label` "Your approved request {id}".
3. Each candidate's `amount = discAmt(type, value, base)` where percent → `Math.round(base × value / 100)` and fixed → `Math.min(value, base)`.
4. Sort candidates by `amount` descending. The sort is stable, so ties keep insertion order: campaigns (in stored array order, newest first), then personal discounts, then approved requests.
5. `best = candidates[0] || null`. Return `{ base, best, amount: best?.amount ?? 0, total: base − amount, others: max(0, candidates.length − 1), all: candidates }`.

Candidate shape: `{ source, label, type, value, amount, id }`. Exactly one discount is ever subtracted; `others` lets the UI say how many alternatives were beaten.

**List-price badge** — `listPrice(tourId)` (for public tour cards, one adult):

- Qualifying set: `Active` + `public` + covers the tour + **no `minGuests` and no `minChildren`** (`bookAhead` campaigns are *not* excluded). Pick the one with the largest amount on the single adult price.
- If one qualifies: `{ has: true, orig: '$690', now, badge, name, ends: 'Ends 15 Dec', fixedWhole, strike, hasNote: false }`. Percent → `now` is the discounted price, `badge` "−15%", `strike: true`. Fixed → `now` stays the list price, `badge` "$300 off per booking", `strike: false`, `fixedWhole: true`.
- If none qualifies but some active public campaign covers the tour: `{ has: false, now: '$120', orig: '', badge: '8% off · 6+ guests', hasNote: true, name }` (a conditional note, no strike-through).
- Otherwise `{ has: false, now, orig: '', badge: '', hasNote: false, name: '' }`.

`offerCount` (shared nav value) = number of `Active` + `public` campaigns, fallback 4.

### 3.6 Discount settings

`{ requestsEnabled: true, maxRequestPct: 30, notify: 'email+whatsapp', responseDays: 2, stacking: 'best' }`

- `maxRequestPct`: whole number 1–90, tenant-wide ("all tours"), private. It caps both what a customer may request and what an owner may approve. Lowering it does not reject pending requests; they are flagged and can only be approved up to the new cap.
- `requestsEnabled`: hides the request entry point on the public site and makes submission return 403; existing requests remain decidable.
- `responseDays`: 1, 2 or 3 — display promise only ("Reply within N days"); no SLA timer or overdue state is designed.
- `notify`: default channel(s) for decision notifications.
- NOT in design: per-campaign caps, minimum order value, approval thresholds by role, auto-approve rules, any limit on campaign or personal discount size beyond the 90% validation.

### 3.7 Audit log

Entry shape: `{ at: 'YYYY-MM-DD HH:mm', who: string, what: string, kind }`. Append-only, newest first, written in the same transaction as the change (`commit(patch, what, kind, toast)` prepends the entry and saves everything together).

| `kind` | Type badge label | Badge class | Written when | `who` |
|---|---|---|---|---|
| `campaign` | Campaign | `badge badge-secondary` | campaign created, edited, activated, deactivated, deleted | acting admin |
| `manual` | Personal | `badge badge-outline` | personal discount assigned (incl. replacement) | acting admin |
| `revoke` | Revoked | `badge badge-cancelled` | personal discount revoked | acting admin |
| `approve` | Approved | `badge badge-confirmed` | request approved (full or lower) | acting admin |
| `reject` | Rejected | `badge badge-cancelled` | request rejected | acting admin |
| `settings` | Settings | `badge badge-outline` | any settings change: "Turned on/off customer discount requests", "Set private maximum discount request to {n}%", "Set response time to {n} day(s)", "Changed request notifications" | acting admin |
| `request` | Request | `badge badge-pending` | customer submits a request (public site): "Requested 15% off {tour}" | "{name} (customer)" |
| `used` | Redeemed | `badge badge-completed` | single-use discount redeemed on a booking: "Personal discount $20 used on {ref} ({name})" | "System" |

The script hard-codes `who` to the owner's name; record the real actor.

### 3.8 Broadcast to the public website

- **Storage key**: `localStorage['aj-promo']` holds the **entire** promotions document as one JSON object: `{ settings, campaigns: [...], manual: [...], requests: [...], log: [...] }`.
- **On every mutation** (`promoSave(d)`): `localStorage.setItem('aj-promo', JSON.stringify(d))`, then `new BroadcastChannel('aj-promo').postMessage(d)` (the full object, channel closed right after), then local state update.
- **Listeners** (`promoInit`, on every page that shows prices or offers): window `storage` event — reload when `e.key === 'aj-promo'` or the event has no key; `BroadcastChannel('aj-promo').onmessage` — accept only if `data.campaigns` exists and replace state wholesale. Falls back to built-in defaults when nothing is stored.
- No versioning, diffing, or conflict handling: last write wins.
- The **Content screen does not persist or broadcast anything** — packages, reviews and journal entries live in component state and reset on reload, despite the copy "Everything you publish here appears on your website."
- This also means the private maximum, internal notes, private-campaign email lists and the whole audit log are shipped to the public pages in the prototype. That must not survive into the real build (section 7).

---

## 4. Roles and permissions

Only the Promotions screen has a role concept. The "Viewing as" select (a prototype stand-in for the signed-in member; state `role`, default `owner`, not persisted) offers:

| Value | Label | Access |
|---|---|---|
| `owner` | "Leyla Mammadova · Owner" | "Full control" |
| `assistant` | "Kamran Huseynov · Assistant" | "View only" (`viewOnly = role !== 'owner'`) |

Effect of `assistant`:

| Area | Disabled (`disabled` attribute) | Still usable |
|---|---|---|
| Global | — | amber "View-only access" banner appears; tabs, KPI cards, filter chips, role select, theme controls |
| Campaigns | "+ New campaign"; every Active switch; every Edit; every Delete (table and stacked list) | viewing all rows including private campaigns and codes |
| Personal discounts | "Apply discount" submit; every "Revoke" | the whole assign form remains typeable (search, pick, type, value, tour, expiry, note, preview) — only submit is blocked |
| Requests | the primary decision button; helper text "You have view-only access — only owners can decide." | opening the detail sheet; switching decision tabs; typing in decision fields; "Later" |
| Audit log | — (already read-only) | filters |
| Settings | Allow-requests switch; max % input; max "Save"; response-time select; notify select | reading everything, **including the private maximum** (also shown in the request sheet) |

Nothing is hidden for the assistant; controls are only disabled. The campaign editor's own "Save campaign" button is not disabled, but the sheet cannot be opened by an assistant. The server mirror rejects an assistant's decision with 403 regardless of the UI.

The Content screen has no role gating at all (create, publish, feature and delete are open to whoever is viewing).

---

## 5. Data shapes

Types are as they appear in script state. Form copies hold numbers as strings while editing.

### 5.1 Package / tour (Content screen)

| Field | Type | Example | Notes |
|---|---|---|---|
| `id` | number | `1` | new records use an incrementing counter from 101 |
| `title` | string | `'Silk Road to Sheki'` | |
| `dest` | string | `'Sheki'` | destination |
| `cat` | string enum | `'Cultural'` | Cultural, Historical, Adventure, Food & Local, Private, Family, Customized |
| `dur` | string | `'3 days'`, `'6 hours'` | free text |
| `price` | number | `690` | "starting price", USD |
| `img` | string (URL) | `'/_blob/…'` | cover |
| `photos` | number | `26` | a count only |
| `feat` | boolean | `true` | featured on homepage |
| `pub` | boolean | `true` | published |
| `popular` | boolean | `false` | "Popular" badge |
| `group` | number | `8` | max group size |
| `desc` | string | `''` | |
| `itin` | string | `''` | one day per line, "Title: description" |
| `inc` | string | `''` | included, one per line |
| `exc` | string | `''` | excluded, one per line |
| `dates` | string | `''` | comma-separated; blank = on request |

Seed (id · title · dest · cat · dur · price · photos · feat · pub): 1 Silk Road to Sheki · Sheki · Cultural · 3 days · 690 · 26 · ✓ · ✓ — 2 Fire & Stone: Gobustan & Yanar Dag · Absheron · Adventure · 1 day · 165 · 22 · ✓ · ✓ — 3 Icherisheher & Flame Towers · Baku · Historical · 6 hours · 120 · 18 · ✓ · ✓ — 4 Khinalug & Quba Highlands · Quba · Adventure · 2 days · 480 · 15 · – · ✓ — 5 Baku Food & Wine Evening · Baku · Food & Local · 4 hours · 85 · 21 · – · ✓ — 6 Shamakhi Wine Route · Shamakhi · Food & Local · 1 day · 210 · 12 · – · ✓ — 7 Lankaran Tea & Hirkan Forest · Lankaran · Family · 3 days · 560 · 11 · – · ✓ — 8 Private Grand Azerbaijan · Nationwide · Private · 8 days · 2450 · 19 · ✓ · ✓ — 9 Gabala Mountain Escape · Gabala · Adventure · 2 days · 390 · 0 · – · – (draft).

### 5.2 Tour catalogue used by the discount engine (Promotions screen)

`promoTours()`: map of slug → `{ n: name, p: adult price }`: `sheki` 690 · `khin` 480 · `grand` 2450 · `fire` 165 · `old` 120 · `food` 85 · `wine` 210 · `lank` 560 · `bespoke` ("Bespoke Azerbaijan") 3200. Special scope values: `'all'` (campaign) and `'any'` (personal discount).

### 5.3 Review

| Field | Type | Example |
|---|---|---|
| `id` | number | `1` |
| `name` | string | `'Eleanor Whitfield'` |
| `country` | string | `'United Kingdom'` |
| `rating` | number 1–5 | `5` |
| `tour` | string (package **title**) | `'Private Grand Azerbaijan'` |
| `title` | string | `'Like coming home'` |
| `text` | string | `'Leyla turned a holiday into the most meaningful two weeks of our lives.'` |
| `verified` | boolean | `true` → "Verified booking"; `false` → "Added by guide" |
| `feat` | boolean | `true` (featured testimonial) |
| `pub` | boolean | `true` |

A customer photo/avatar upload exists in the form but has no field.

### 5.4 Customer (Content screen, hard-coded tuples)

`[name, email, phone, country, toursCount, history, note]` mapped to `{ name, init, email, mail: 'mailto:…', phone, country, n, hist, note }`.

Example: `{ name:'Eleanor Whitfield', email:'eleanor@example.com', phone:'+44 7700 900821', country:'United Kingdom', n:2, hist:'Grand Azerbaijan (Oct 2026) · Sheki (pending)', note:'Anniversary in April — arrange a private dinner.' }`.

The Promotions customer picker uses a different tuple `[name, email, bookingRef, tourSlug]` → `{ name, email, booking: 'AJ-SHE-4821', tour: 'sheki', tourName, init }` — effectively one row per booking. Booking ref format: `AJ-{3-letter tour code}-{4 digits}`.

### 5.5 Journey entry

| Field | Type | Example |
|---|---|---|
| `id` | number | `1` |
| `title` | string | `'Autumn in Sheki'` |
| `loc` | string | `'Sheki'` (or `'—'`) |
| `date` | string (display) | `'Oct 2026'` or `'Undated'` |
| `photos` | number | `46` |
| `img` | string (URL) | cover |
| `pub` | boolean | `true` |

Form-only fields that are collected but not stored: `desc`, `moments` (one highlight per line).

### 5.6 Campaign

| Field | Type | Example |
|---|---|---|
| `id` | string | `'c1'` (new: `'c' + Date.now()`) |
| `name` | string | `'Autumn in the Caucasus'` |
| `code` | string | `''` or `'WELCOMEBACK'` |
| `type` | `'percent'` \| `'fixed'` | `'percent'` |
| `value` | number | `15` (percent) / `300` (USD) |
| `tours` | string[] | `['sheki','khin']` or `['all']` |
| `start` | ISO date | `'2026-11-01'` |
| `end` | ISO date | `'2026-12-15'` |
| `visibility` | `'public'` \| `'private'` | `'public'` |
| `assigned` | string[] (lower-case emails) | `['priya@example.com','thomas@example.com']` |
| `minGuests` | number | `0` / `6` |
| `minChildren` | number | `0` / `1` |
| `bookAhead` | number (days) | `0` / `90` |
| `active` | boolean | `true` |
| `uses` | number | `41` |
| `blurb` | string | `'Golden forests, harvest suppers and crisp mountain air — our favourite season, now 15% off.'` |

Seed and derived status on 2026-11-15: c1 Autumn in the Caucasus 15% (sheki, khin; 1 Nov–15 Dec 2026; 41 uses) Active · c2 Early Bird 2027 $300 (grand, bespoke; to 31 Jan 2027; bookAhead 90; 9) Active · c3 Family Adventures 10% (fire, lank; 15 Oct 2026–28 Feb 2027; minChildren 1; 17) Active · c4 Groups of 6+ 8% (old, food, fire; 10 Nov 2026–30 Jun 2027; minGuests 6; 6) Active · c5 Returning Guests 12% `WELCOMEBACK` (all; 2026–2027; private, 2 emails; 12) Active · c6 Novruz Spring 2026 20% (all; March 2026; 58) Expired · c7 Caspian Summer 12% (old, food; Jun–Aug 2027; `active:false`; 0) Inactive.

### 5.7 Personal discount (`manual`)

| Field | Type | Example |
|---|---|---|
| `id` | string | `'m1'` (new: `'m' + Date.now()`) |
| `name` | string | `'Eleanor Whitfield'` |
| `email` | string | `'eleanor@example.com'` |
| `booking` | string | `'AJ-SHE-4821'` (the booking it was assigned from) |
| `tour` | tour slug \| `'any'` | `'any'` |
| `type` | `'percent'` \| `'fixed'` | `'percent'` |
| `value` | number | `10` |
| `expiry` | ISO date \| `''` | `'2027-05-31'` |
| `note` | string | `'Anniversary gesture — second trip with us'` (`'—'` if blank) |
| `by` | string | `'Leyla Mammadova'` |
| `at` | ISO date | `'2026-11-02'` |
| `usedBy` | string | `''` or booking ref `'AJ-OLD-7720'` |
| `revoked` | boolean (optional) | `true` |

### 5.8 Discount request

| Field | Type | Example |
|---|---|---|
| `id` | string | `'DR-1046'` |
| `name` | string | `'Kenji Watanabe'` |
| `email` | string | `'kenji@example.com'` |
| `phone` | string | `'+81 90 1234 5678'` |
| `tour` | tour slug | `'old'` |
| `booking` | string | `'AJ-OLD-9034'` |
| `guests` | number | `5` |
| `type` | `'percent'` \| `'fixed'` | `'percent'` |
| `value` | number | `15` |
| `reason` | string | `'Photography group of five — we may book Khinalug in spring too.'` |
| `status` | `'Pending'` \| `'Approved'` \| `'Rejected'` | `'Pending'` |
| `at` | `'YYYY-MM-DD HH:mm'` | `'2026-11-15 10:20'` |
| `decision` | object \| `null` | see below |
| `usedBy` | string (optional) | booking ref once redeemed |

`decision` when approved: `{ type, value, note, by, at, notified: boolean, partial: boolean }` — e.g. `{ type:'percent', value:8, note:'Approved 8% for students with ID.', by:'Leyla Mammadova', at:'2026-11-11 09:30', notified:true }`.
`decision` when rejected: `{ reason, note, by, at, notified }` — `reason` is customer-facing, `note` is internal.

Worked examples: DR-1046 → base 5 × $120 = $600, 15% = $90, price after $510. DR-1045 → 2 × $2,450 = $4,900, 10% = $490, after $4,410. DR-1041 → $60 fixed on $600 = 10%.

### 5.9 Audit entry and settings

See 3.7 and 3.6. Root document: `{ settings, campaigns, manual, requests, log }`.

### 5.10 Component state (for reference)

- Content: `{ tab, toast, drawer: null|'pk'|'rv'|'jo', edit: id|null, pf, rf, jf, touched, confirm: { k: 'pks'|'rvs'|'jos', id, name }|null, cq, pks, rvs, jos }`.
- Promotions: `{ tab, role, cFilter, rFilter, lFilter, toast, drawer: null|'camp'|'req', edit, cf, cTouched, rSel, decMode: 'full'|'lower'|'reject', df: { type, value, reason, note, notify }, dErr, confirm: { kind: 'camp'|'revoke', id, title, text, btn }|null, mq, mPick, mf: { type, value, tour, expiry, note }, mTouched, maxDraft, maxErr, promo }`.

---

## 6. Motion, toasts, empty and loading states

- **Explicit motion in markup** is limited to `transition-shadow hover:shadow-md` (KPI cards) and colour hovers (`hover:bg-muted/50` request rows, `hover:bg-muted` dropzones, `hover:bg-accent` combobox options, `hover:underline` links). Sheet, dialog, overlay, toast, switch-thumb and tab transitions come from the unavailable shared CSS and are unspecified; conditional blocks mount and unmount instantly in script.
- **Toasts**: single slot, auto-dismiss (3.0 s Content, 3.2 s Promotions), `role="status"`, no action or undo. Full text is listed per action above.
- **Empty states** defined: packages (CTA), customers search (echoes the query), campaigns filter, requests filter. **Not defined**: reviews, journey, personal discounts, audit log, combobox no-match.
- **Loading / skeleton / error states**: none. All data is synchronous. (`hint-placeholder-count` / `hint-placeholder-val` attributes are editor preview hints, not skeleton specs.)
- **Focus management, Escape-to-close, focus trapping and scroll locking** are not implemented in script; the real `sheet` / `alert-dialog` components should supply them.
- Dark mode: amber and emerald alert boxes carry explicit `dark:` variants; everything else relies on theme tokens.

---

## 7. Ambiguities and inconsistencies found in the design

1. **Two tour catalogues**: Content packages use numeric ids and include "Gabala Mountain Escape" (draft); the discount engine uses slugs and includes "Bespoke Azerbaijan" ($3,200), which is not a package. Reviews reference tours by title string.
2. **No-expiry personal discounts never apply**: the form says expiry is optional and the list shows "No expiry"/Active, but `quote()` requires `m.expiry >= today`, which is false for an empty string.
3. **Revoked personal discounts still apply**: `quote()` checks `usedBy` and expiry but not `revoked`.
4. **Content is not persisted or broadcast** although the copy says it appears on the website.
5. **Content screen has no role gating**; unclear whether assistants may edit content.
6. **Assistant can read private data** (private maximum, internal notes, private campaign email lists, audit log). "View only" may or may not be meant to include these.
7. **Sidebar "Discounts & offers" badge is a literal `2`**, not the live pending count; assistant avatar initials read "KA" for "Kamran Huseynov".
8. **`bookAhead` campaigns leak into list-price badges**: `listPrice()` excludes `minGuests`/`minChildren` campaigns but not `bookAhead`, so Early Bird shows "$300 off per booking" unconditionally on the card.
9. **Request base ignores children**: requests carry only `guests` and are priced at full adult rate, while `quote()` charges children half.
10. **"Price preview · per adult"** shows 2-adult totals for fixed discounts.
11. **"Campaign created — live on the website"** is shown whenever `active` is true, even if the start date is in the future (derived status Scheduled).
12. **Campaign code is unused** by the engine, and personal discounts have no code at all.
13. **Audit kind `revoke` has no filter chip**; campaign delete is a hard delete while personal discounts are soft-revoked.
14. **Phone layout drops actions**: packages lose the Featured switch and Delete below `md`.
15. **Journal entries cannot be edited** and discard Description and Highlights; the "map" mention has no coordinates field.
16. **Review "verified" is a free checkbox**, and manual reviews default to published.
17. **Lower-approval default type is always percent** even for fixed-amount requests; approved requests apply only to the requested tour and are tied to email, not to the specific booking the copy mentions ("Linked to {email} and {booking}").
18. **Tour checkbox quirk**: clicking one tour while "All tours" is on leaves only that tour selected.
19. **Tie-breaking** between equal discounts is implicit (insertion order), not a stated rule.
20. **Past-expiry error** for personal discounts is rendered in the value field's error slot.
21. **Status vocabulary** the brief expected (draft, paused, counter-offer, usage limits, category scope, last-minute type) does not exist in the design.
22. Money is USD-only, formatted `'$' + Math.round(n).toLocaleString('en-US')`; percent discounts are rounded to whole dollars.

---

## 8. Implementation notes for multi-tenant mapping

Every table below carries `tenant_id` (the workspace); all reads and writes are scoped to the signed-in member's tenant, and slugs / codes / reference numbers are unique per tenant, not globally. "Aurelia", "Leyla" and the `AJ-` prefix are tenant data.

### 8.1 Entities implied

| Entity | Key fields | Notes |
|---|---|---|
| `tours` (packages) | id, tenant_id, slug, title, destination, category, duration_label, base_price, currency, max_group, description, is_featured, is_popular, is_published, timestamps | One catalogue for both screens (resolves ambiguity 1). Decide whether "Bespoke" is a tour row or a special scope. |
| `tour_photos` | tour_id, storage key, position (0 = cover) | Replaces the `photos` count and `img`. Enforce JPG/PNG/WebP and 10 MB server-side. |
| `tour_itinerary_days`, `tour_inclusions` (kind: included/excluded), `tour_available_dates` | tour_id, position, … | Or keep as text/JSON columns to match the newline/comma inputs; choose one and validate. |
| `reviews` | id, tenant_id, tour_id (FK, not title), customer_name, country, rating 1–5, title, body, avatar key, source (`verified_booking` \| `added_by_guide`), booking_id (nullable), is_featured, is_published | `verified` should be derived from a completed booking, not a free flag. |
| `customers` | id, tenant_id, name, email (unique per tenant, lower-cased), phone, country, note | Created from bookings. Tours count and history are derived from `bookings`, not stored. |
| `journey_entries` | id, tenant_id, title, location, visited_month, description, highlights[], is_published, (lat/lng if the map is built) | plus `journey_media` (image/video, position, cover). |
| `discount_campaigns` | id, tenant_id, name, code (nullable), type, value, starts_on, ends_on, visibility, min_guests, min_children, book_ahead_days, is_active, blurb, uses_count | `applies_to_all` boolean + `campaign_tours` join; `campaign_assignees` (email) for private. Status is computed, never stored. |
| `personal_discounts` | id, tenant_id, customer_id / email, booking_id (origin, nullable), tour_id (null = any), type, value, expires_on (nullable), internal_note, assigned_by, assigned_at, used_by_booking_id, used_at, revoked_at, revoked_by | Treat null expiry as "never expires" and exclude revoked rows in the engine (fixes 2 and 3). |
| `discount_requests` | id, tenant_id, reference (`DR-n`, per-tenant sequence), customer name/email/phone, tour_id, booking_id, guests, type, value, reason, status, created_at; decision_type, decision_value, decision_is_partial, decision_reason (customer-facing), decision_note (internal), decided_by, decided_at, notified, used_by_booking_id | Partial unique index: one `Pending` per (tenant, email, tour). |
| `discount_settings` | tenant_id (PK), requests_enabled, max_request_pct, notify_channels, response_days, stacking (`best`) | One row per tenant with the defaults in 3.6. |
| `discount_audit_log` | id, tenant_id, at, actor_type (member/customer/system), actor_id, actor_label, kind, summary, optional entity ref + before/after JSON | Insert-only: no update or delete path, including for owners. |
| `memberships` | tenant_id, user_id, role (`owner`, `assistant`, …) | Replaces the "Viewing as" switch. |
| `bookings` (owned elsewhere) | needs `applied_discount_source`, `applied_discount_id`, `discount_amount` | Snapshot the price so "past bookings keep their price" holds after a campaign is deleted. |

### 8.2 Rules the server must enforce (never trust the client)

- **Best-discount selection** (3.5) runs server-side at quote time and again at booking confirmation, against live data and the tenant's current date; the client may show a preview but its total is never accepted.
- **Single use**: mark a personal discount or approved request as used in the same transaction that confirms the booking (conditional update on "not used"), and increment `uses_count` for campaigns; write the `used` audit row there.
- **Campaign validation**: name ≥ 3 chars; value > 0; percent ≤ 90; `ends_on >= starts_on`; at least one tour or all; private needs ≥ 1 valid email; integers ≥ 0 for eligibility rules. Derive status from `is_active` + dates on read.
- **Personal discount validation**: existing customer; value > 0; percent ≤ 90; expiry not in the past; replace-on-conflict (same email, overlapping scope) done atomically.
- **Request submission** (3.4 table): the seven checks in order with the same status codes, and the generic over-limit message so the cap is never disclosed. Compute the base from the server's price and party composition.
- **Request decision** (3.4 table): the seven checks in order; decide with a conditional update on `status = 'Pending'` so concurrent decisions yield one 409.
- **Settings**: `max_request_pct` integer 1–90; `response_days` in {1,2,3}; `notify_channels` in the three allowed values.
- **Audit**: every mutation in 3.7 writes its log row in the same transaction, with the real actor.
- **Content**: package title ≥ 3, price > 0, duration required; review name ≥ 2, text ≥ 10, rating 1–5; journey title ≥ 3. Unpublished/draft records must be excluded from every public query, not just hidden in the UI.
- **Replace the localStorage/BroadcastChannel broadcast** with server data plus cache invalidation for the tenant's public pages, so "changes go live instantly" stays true. Public endpoints must return only: active public campaigns (name, blurb, type, value, scope, eligibility, end date), `requests_enabled`, `response_days`, and per-request quote results. They must never return `max_request_pct`, internal notes, private campaigns or their assignee emails, other customers' discounts or requests, or the audit log.
- **Notifications**: send the decision by the tenant's configured channels only when "Notify" was ticked, and store `notified`. Message templates are not designed.

### 8.3 Permission checks

| Capability | Owner | Assistant |
|---|---|---|
| View campaigns, personal discounts, requests, audit log, settings | yes | yes (decide whether private max, internal notes and assignee emails should be redacted — ambiguity 6) |
| Create / edit / delete / activate / deactivate campaign | yes | no (403) |
| Assign / replace / revoke personal discount | yes | no (403) |
| Approve / reject discount request | yes | no (403) |
| Change discount settings | yes | no (403) |
| Edit or delete audit entries | no | no |
| Content: create / edit / publish / feature / delete tours, reviews, journey entries | yes | **undefined in design — needs a product decision** |
| Content: view customers | yes | undefined in design |

Enforce on every mutation endpoint from the session's membership role for the tenant in the URL/host, independent of what the UI disabled; render the disabled controls and the view-only banner from the same role. Customers of a tenant (public site) can only create a discount request and read quotes for their own email.
