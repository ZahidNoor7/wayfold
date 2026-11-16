# 02 — Storefront: Tour detail, Booking request, Offers

Source: `design-reference/TourDetail.dc.html`, `Booking.dc.html`, `Offers.dc.html`.
The design shows one tenant ("Aurelia Journeys", guide "Leyla Mammadova"). Everything tenant-specific (names, copy, WhatsApp number, prices, tours, theme) becomes tenant data in Wayfold. Text in quotes below is verbatim design copy.

Conventions used in this document:

- **Mock clock.** The scripts hard-code "today": `promoNow()` returns `'2026-11-15'` (discount logic) and `dayInfo()` treats dates `< '2026-11-16'` as past (availability logic). The two differ by one day; in Wayfold both come from the server clock in the tenant's time zone.
- **"Server mirror" functions.** `serverSubmitRequest` and `serverDecide` are commented in the source as mirroring `POST /api/discount-requests` and `POST /api/admin/discount-requests/:id/decision`. They are the design's statement of server rules and are documented as such.
- Shared CSS classes (`btn`, `card`, …) have no stylesheet available; their intent is inferred from usage (section 0.3).
- shadcn/ui component names in the mapping tables were checked against the `@shadcn` registry listing (shadcn MCP). No Next.js or Tailwind API is asserted here; routes are proposals.

---

## 0. Shared shell (identical in all three files)

### 0.1 Page wrapper and theming

Root element: `<div data-theme data-font data-radius class="{dark|light} min-h-screen overflow-x-clip bg-background font-sans text-foreground antialiased">`.

- `data-theme`: `emerald` (default) | `caspian` | `pomegranate` | `graphite`.
- `data-font`: `classic` (default). `data-radius`: `md` (default).
- Mode: `light` (default) | `dark` | `system` (follows `prefers-color-scheme`, re-rendered on media-query change).
- Fonts loaded: Cormorant Garamond (500, 600, italic 500), Fraunces (opsz 9–144; 500, 600, italic 500), Manrope (400–700). `font-display` is the serif used for headings and prices; `font-sans` is the body face.
- Semantic colour tokens referenced: `background`, `foreground`, `primary(-foreground)`, `secondary`, `muted(-foreground)`, `accent`, `card`, `border`, `ring`, `destructive`, `highlight(-foreground)`, `hero(-foreground)`, `eyebrow`. Status colours are raw Tailwind palettes (emerald, amber, rose, violet) with explicit `dark:` variants.

In Wayfold this is the per-tenant theme (theme, mode, radius, font) resolved server-side; see section 6 for the storage mechanism the prototype uses.

### 0.2 Header, mobile menu, footer

- **Header**: `sticky top-0 z-40 border-b bg-background/90 backdrop-blur-md transition-colors duration-300`, inner `container-x flex h-20 items-center justify-between gap-4`. All three pages call `uiVals(false)`, so the header is always the solid variant (the transparent over-hero variant exists in the helper but is unused here, including on Offers, which has a hero).
- Logo: "Aurelia" (`font-display text-[24px] sm:text-[26px]`) + "JOURNEYS" (`text-[10px] uppercase tracking-[0.32em]`).
- Desktop nav `hidden xl:flex`: Home, About Me, Experiences, Offers, My Journey, Reviews, Contact. `aria-current="page"` is set on Experiences (TourDetail) and Offers (Offers); none on Booking. The Offers link carries a count pill `{{offerCount}}` = number of campaigns that are `Active` and `public` (4 with the sample data; falls back to 4 on error).
- Right cluster: WhatsApp icon button (`hidden sm:inline-flex`, `https://wa.me/994501234567`), "Book a Tour" (`btn btn-highlight rounded-full`; label "Book" below `sm`), hamburger (`xl:hidden`, `aria-expanded`).
- **Mobile menu**: `overlay` (click closes) + `sheet-right border-hero bg-hero p-6 text-hero-foreground sm:max-w-md`, `role="dialog" aria-modal="true" aria-label="Menu"`. Links are `font-display text-4xl` with `border-b border-hero-foreground/15`; the Offers item is labelled "Special offers". Bottom: "Book a Tour", "Chat on WhatsApp", contact line. Each link has `animate-menu-item` with staggered `animation-delay` (.04s, .08s, .12s, .14s, .16s, .2s, .24s).
- **Footer**: `bg-hero pb-10 pt-20`, grid `sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1.4fr]`: brand blurb + social icon buttons; "Explore"; "Destinations"; "Get in touch" (email, WhatsApp, "Icherisheher, Baku", "Mon–Sat · 9:00–19:00 (AZT)"). Bottom bar: copyright + Privacy Policy / Terms & Conditions (both link to Contact).

### 0.3 Shared classes and suggested shadcn/ui mapping

| Design class | Inferred intent | shadcn/ui (registry `@shadcn`) |
|---|---|---|
| `btn` + `btn-default / -highlight / -outline / -ghost / -link / -secondary / -hero-outline`; sizes `btn-sm / -lg / -xl / -icon / -icon-lg` | Button variants; `highlight` = accent CTA, `hero-outline` = outline on dark hero surface | `button` (add `highlight`, `heroOutline` variants and `xl`, `icon-lg` sizes) |
| `card`, `card-title`, `card-description` | Bordered surface | `card` |
| `badge` + `badge-default / -outline / -highlight / -pending / -confirmed / -cancelled / -verified` | Status pills. pending = amber, confirmed = green, cancelled = red, verified = green check | `badge` (add status variants) |
| `chip` (with `aria-checked:` styles) | Pill radio option | `toggle-group` or `radio-group` |
| `input`, `select`, `textarea`, `checkbox`, `label`, `field-hint`, `field-error` | Form primitives; `field-error` is small destructive text | `input`, `native-select` or `select`, `textarea`, `checkbox`, `label`, `field` |
| `alert`, `alert-destructive` | Inline message box | `alert` |
| `accordion-trigger` | Full-width row button with chevron | `accordion` |
| `progress` | Thin track for the mobile step bar | `progress` |
| `overlay`, `sheet-right`, `sheet-bottom` | Scrim, right drawer, bottom sheet with drag handle | `sheet` / `drawer` |
| `toast` | Fixed transient status message | `sonner` |
| `breadcrumb`, `avatar`, `eyebrow`, `nav-link`, `mnav` | Breadcrumb row, initials circle, small uppercase kicker, nav links | `breadcrumb`, `avatar`; rest are utilities |
| `container-x`, `safe-b`, `no-scrollbar`, `lift`, `img-zoom` | Page container with side gutter (the related-tours row uses `-mx-5 px-5`, implying a 20px mobile gutter); bottom safe-area padding; hidden scrollbar; hover lift; image scale on hover | utilities |
| `reveal`, `animate-rise`, `animate-fade-in`, `animate-pop`, `animate-menu-item`, `delay-1`, `delay-2` | Motion utilities (see the Motion subsection of each screen) | custom keyframes |

---

## 1. Tour detail (`TourDetail.dc.html`)

### 1.1 Purpose and route

Public detail page for one tour, with a live price/availability card that leads into the booking request. The design is hard-wired to the tour `sheki` ("Silk Road to Sheki", a scheduled multi-day departure tour).
Proposed route: `/tours/[slug]` on the tenant storefront (the share handler copies `https://aureliajourneys.az/experiences/silk-road-to-sheki`, so `/experiences/[slug]` is the design's own URL shape).

### 1.2 Layout, top to bottom

1. **Title block** (`container-x pt-8`)
   - Breadcrumb: Home / Experiences / "Silk Road to Sheki".
   - Row `flex flex-wrap items-end justify-between gap-6`: badges "Featured" (`badge-default`) and "Cultural" (`badge-outline`), both `uppercase tracking-wider`; `h1` `font-display text-[44px] font-medium leading-none text-primary sm:text-6xl`; meta line `text-[15px] text-muted-foreground`: route "Baku → Shamakhi → Sheki → Lahij", "★ 4.9" + link "71 reviews" (`#reviews`), "Hosted by Leyla Mammadova".
   - Actions: "Save" / "Saved" (heart, `aria-pressed`) and "Share" (`btn btn-outline rounded-full`).
2. **Gallery mosaic**: `grid grid-cols-2 gap-3 md:grid-cols-4 md:grid-rows-[240px_240px]`. Five image buttons, each `group relative overflow-hidden rounded-xl bg-hero`; the first is `col-span-2 aspect-[16/10] md:row-span-2 md:aspect-auto`, the others `aspect-[4/3] md:aspect-auto`. Images `img-zoom h-full w-full object-cover`. Caption: "Select a photo to open the gallery · 26 photos".
3. **Body** (`container-x pb-24 pt-12 lg:pt-14`): `flex flex-col gap-14 lg:flex-row lg:items-start lg:gap-16`. Left column `min-w-0 flex-1`; right `aside` `hidden w-[380px] shrink-0 lg:sticky lg:top-28 lg:block`.
   - **Facts strip**: `card mb-14 grid grid-cols-2 overflow-hidden sm:grid-cols-4`, four cells (label `text-xs uppercase tracking-widest text-muted-foreground`, value `font-display text-2xl text-primary`): Duration "3 days · 2 nights"; Group size "2 – 8 guests"; Meeting point "Your Baku hotel"; Languages "EN · AZ · RU · TR".
   - **Overview** (`h2` `font-display text-4xl font-medium text-primary`): two paragraphs `text-[17px] leading-relaxed text-foreground/85`.
   - **Highlights**: `ul grid gap-4 sm:grid-cols-2`; each item is a `h-7 w-7 rounded-full bg-primary` check bullet + text. Six items.
   - **Day-by-day itinerary**: heading row with a ghost toggle "Expand all" / "Collapse all". `ol` timeline; each `li` is `flex gap-5`: left rail = numbered circle (`h-12 w-12 rounded-full border border-highlight bg-card font-display text-2xl`) + vertical line (`w-px flex-1 bg-border`); right = `accordion-trigger` with eyebrow "Day {n} · {where}" and title (`font-display text-[26px]`), then the body (text + `text-[13px]` meta line).
   - **Inclusions**: `grid gap-5 sm:grid-cols-2`, two `card p-7`: "What’s included" (green ✓ bullets, `text-emerald-700 dark:text-emerald-400`) and "Not included" (✕ in `text-destructive`).
   - **Important information**: `rounded-xl bg-secondary/70 p-7`, disc list of 4 notes (fitness, e-visa, winding roads, dress code).
   - **Frequently asked**: list of `border-b` accordion rows (`accordion-trigger text-[17px]`); answer `max-w-2xl text-[15px] text-muted-foreground`.
   - **Reviews** (`id="reviews"`): heading "★ 4.9 · 71 reviews" + link "See all reviews"; `grid gap-5 sm:grid-cols-2` of `article.card p-6`: avatar initials, name, "{country} · {date}", "★★★★★" (`text-highlight`), text, `badge badge-verified` "✓ Verified booking".
   - **Booking card (desktop aside)**: section 1.4.
4. **Related tours**: `bg-secondary/60 py-20`, heading "You may also love". Horizontal snap carousel on mobile, grid on desktop: `no-scrollbar -mx-5 flex snap-x gap-5 overflow-x-auto px-5 md:mx-0 md:grid md:grid-cols-3 md:px-0`; cards `card lift group w-[78%] shrink-0 snap-start md:w-auto` with `aspect-[16/10]` image, meta, title, "from **$480**".
5. **Mobile sticky booking bar** (`lg:hidden`): `sticky bottom-0 z-30 flex items-center justify-between gap-4 border-t bg-background/95 px-5 pt-3 shadow-[0_-12px_30px_-18px_rgba(0,0,0,.4)] backdrop-blur safe-b`. Left: "{adults} adults · est." + optional green "({discount label})", total in `font-display text-2xl`. Right: "Check dates" (`btn btn-default btn-lg rounded-full px-6`) opens the bottom sheet.
6. Footer.

### 1.3 Components and variants

Badges (default, outline, highlight, pending, cancelled, verified), outline pill buttons, image mosaic, lightbox dialog, timeline accordion (multi-open), FAQ accordion (single-open), cards, sticky price card, departure radio list, quantity steppers, bottom sheet, toast, horizontal snap carousel.

### 1.4 Booking card (desktop aside and mobile bottom sheet share the same state)

Desktop card `card p-7 shadow-xl`:

1. "From" + optional struck original price (`text-lg text-muted-foreground line-through`) + current price (`font-display text-[44px] font-semibold text-primary`) + "per adult".
2. Offer line when a list-price offer exists: `badge badge-highlight` (e.g. "−15%") + offer name linking to Offers + "· Ends 15 Dec". Otherwise: "No current offer — request a discount when you book." (link to Booking).
3. **Departures** fieldset: `role="radiogroup"`, `flex max-h-72 flex-col gap-2 overflow-y-auto pr-1`. One `role="radio"` button per scheduled departure:
   - Label "{start} – {start + 2 days}" using `en-GB` short dates, e.g. "17 Apr 2027 – 19 Apr 2027".
   - Sub-line: "{left} of 8 seats left" (green when open, amber bold when limited) or "Fully booked — join the waitlist".
   - Right badge: `badge-cancelled` "Sold out" when full; `badge-pending` "{left} left" when limited and not the selected one.
   - Classes: selected `rounded-lg border-2 border-primary bg-accent p-3`; default `border-2 border-border … hover:border-ring cursor-pointer`; full `border-2 border-dashed bg-muted/50 text-muted-foreground line-through decoration-destructive/50`, `aria-disabled="true"`.
4. Sold-out message (`role="status"`, `rounded-md bg-muted p-2.5 text-[13px]`): "{date} is sold out (8 of 8 seats booked)." + inline button "Join waitlist" / "✓ On the waitlist".
5. Steppers: "Adults" ("$690 each") and "Children" ("Under 12 · $345"); round outline `−` / `+` icon buttons, value in `aria-live="polite"`.
6. Seat warning (`role="alert"`, `field-error`).
7. Discount row (green, `text-emerald-700 dark:text-emerald-400`): "{offer name} ({15% off})" … "−$207".
8. "Estimated total": optional struck base + total (`font-display text-[28px] text-primary`).
9. CTA "Book This Experience" (`btn btn-default btn-xl w-full rounded-full`, links to Booking), note "No payment now. Leyla confirms availability personally within 24 hours.", link "Ask a question on WhatsApp".

Mobile sheet (`sheet-bottom lg:hidden`, `role="dialog" aria-modal="true" aria-label="Choose departure and guests"`): drag handle (`mx-auto mt-3 h-1.5 w-12 rounded-full bg-muted`), title "Choose your departure", close ✕, scrollable body with the same departures list, sold-out message, steppers (labels here are dynamic: "{current price} each", "Under 12 · half price") and seat warning; sticky footer with discount row, "Estimated total", CTA "Continue to booking request", note "No payment now · Leyla confirms within 24 hours". Scrim `overlay lg:hidden` closes it.

### 1.5 State and interactions

Initial state: `{ lb: -1, open: { 0: true }, faq: -1, adults: 2, children: 0, dep: '2027-04-17', saved: false, wl: {}, mOpen: false, toast: '' }` plus `fullPick` (ISO of the last sold-out departure clicked), `menu`, `scrolled`, `ui`, `promo`.

| Interaction | Behaviour |
|---|---|
| Gallery tile click | `lb = index`; opens lightbox. `aria-label` "Open photo {n}: {alt}". |
| Lightbox | `fixed inset-0 z-[60] … bg-black/90 p-4 sm:p-8`, `role="dialog" aria-modal="true" aria-label="Photo gallery"`. Image `max-h-[72vh] w-full max-w-5xl rounded-xl object-cover`. Caption "{alt} · {i} / {n}". Prev/next wrap around (modulo). Close ✕ top-right. No keyboard (Esc/arrow), swipe or backdrop-click handling is defined in the script; add them in the real build. |
| Itinerary row | Independent toggle per day (`open` is a map; several can be open). Day 1 open by default. `aria-expanded` mirrors state. |
| "Expand all" / "Collapse all" | Label is "Collapse all" only when every day is open; click opens all, or closes all if all are open. |
| FAQ row | Single-open: clicking the open one closes it (`faq = -1`). |
| Save | Toggles `saved`; heart fill switches `none`/`currentColor`; label "Save"/"Saved"; toast "Saved to your wishlist" / "Removed from wishlist". Not persisted. |
| Share | Copies the tour URL to the clipboard; toast "Link copied to clipboard" (shown even if the clipboard write throws). |
| Pick departure | Available: `dep = iso`, clears `fullPick`. Sold out / past: sets `fullPick` only, which shows the sold-out message; selection is unchanged. |
| Join waitlist | `wl[fullPick] = true`; toast "You’re on the waitlist for {date}"; button becomes "✓ On the waitlist". No contact details are collected. |
| Adults stepper | min 1, max 8. |
| Children stepper | min 0, max 6. |
| Seat warning | When `adults + children > seats left` on the selected departure: "Only {left} seats left on this departure — reduce your group or choose another date." Advisory only; the CTA stays enabled. |
| Mobile "Check dates" | `mOpen = true`; scrim or ✕ closes. |
| Toast | `flash(msg)`: one toast at a time, auto-dismiss after 3000 ms, `role="status"`. |
| CTA | Plain link to the booking page; **no selection is passed** (see section 7, item 1). |

There are no tabs on this page. No loading, skeleton or error states are designed for it.

### 1.6 Motion

- Lightbox container and image: `animate-fade-in` on open and on each image swap (image element re-renders).
- Itinerary and FAQ bodies: `animate-fade-in` when expanded (no height animation specified).
- Gallery and related-card images: `img-zoom` on hover; related cards: `lift` on hover.
- Mobile menu items: `animate-menu-item` staggered.
- Header: `transition-colors duration-300`.
- Bottom sheet, overlay and toast enter/exit are owned by the missing stylesheet (assume slide-up, fade and rise).

### 1.7 Sample content (tour `sheki`)

- Gallery (5): "Sheki beneath the Greater Caucasus", "The Upper Caravanserai courtyard", "Walnut groves near Kish", "Mountain road above Sheki", "Lahij copper workshops".
- Itinerary: Day 1 "Along the caravan road" (Baku → Shamakhi → Sheki; meta "Drive 5 h with stops · Upper Caravanserai · Dinner"); Day 2 "Palaces, stained glass and halva" (Sheki; "Walk 3 h · Breakfast & dinner · Halva class"); Day 3 "The coppersmiths of Lahij" (Sheki → Lahij → Baku; "Drive 6 h with stops · Breakfast").
- Included (6): guiding, 2 nights in Sheki, breakfasts and two dinners, private vehicle and driver, entrance fees, halva and shebeke workshops. Not included (4): international flights, e-visa fee, "Travel insurance (required)", lunches/gratuities/personal expenses.
- FAQ (4): fitness; "Can this tour be made private?" ("any date can be booked privately … I’ll quote a private rate"); children ("Under-12s travel at half price"); weather.
- Reviews (2): Aiko Tanaka (Japan, May 2026), Liam & Grace Walsh (Ireland, Oct 2025).
- Related (3): Khinalug & Quba Highlands ($480), Fire & Stone: Gobustan ($165), Shamakhi Wine Route ($210).

---

## 2. Booking request (`Booking.dc.html`)

### 2.1 Purpose and route

Four-step booking **request** wizard (no payment): 1 tour/date/guests, 2 contact details, 3 review + terms (+ optional discount request), 4 confirmation.
Proposed route: `/book` with optional prefill query (`?tour=&date=&slot=&adults=&children=`) so the tour page can hand over its selection; confirmation at the same route or `/book/confirmation/[reference]`.

Prototype-only switches (design props, not product features): `simulateError`, `simulateConflict`, `simulateTamper`.

### 2.2 Layout

Container `container-x pb-28 pt-10 lg:pt-14`.

1. Eyebrow "Booking request"; `h1` "Reserve your journey" (`font-display text-5xl font-medium leading-none text-primary lg:text-6xl`).
2. **Stepper**: mobile-only progress bar (`progress mb-4 sm:hidden`, fill `bg-primary transition-all duration-500`, width `(step − 1) / 3 × 100%`), then `ol.flex.items-center.gap-2` with four items "Tour & date", "Your details", "Review", "Confirmation". Dot `h-9 w-9 rounded-full text-sm font-bold transition-all`: current `bg-primary text-primary-foreground` (`aria-current="step"`), done `bg-highlight text-highlight-foreground` showing "✓", upcoming `border text-muted-foreground`. Labels `hidden sm:inline`; connector `h-px min-w-3 flex-1 bg-border`.
3. Two columns: `flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12`. Left `form.card min-w-0 flex-1 p-4 sm:p-9` (`novalidate`); right summary `aside` `w-full overflow-hidden rounded-xl bg-hero text-hero-foreground lg:sticky lg:top-28 lg:w-[380px] lg:shrink-0` (stacks below the form on mobile).
4. **Form footer / action bar**: `sticky bottom-0 z-20 -mx-4 -mb-4 mt-8 flex flex-col gap-2 rounded-b-xl border-t bg-card/95 px-4 pt-3 backdrop-blur safe-b sm:static sm:mx-0 sm:mb-0 sm:flex-row sm:items-center sm:justify-between sm:rounded-none sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-6 sm:backdrop-blur-none`. Mobile-only row "Estimated total · {discount label}" + total. Buttons: "Back" (`btn-outline btn-lg rounded-full`, steps 2–3) and primary (`btn-default btn-lg flex-1 rounded-full px-8 sm:flex-none`) labelled "Continue" (steps 1–2), "Submit booking request" (step 3) or "Checking availability…" with spinner while loading (button disabled).
5. Step 4 replaces everything above with the centred confirmation (`mx-auto max-w-3xl text-center`).

### 2.3 Step 1 — "1 · Choose your tour, date & guests"

- **Selected tour**: native `select` with six options ("Silk Road to Sheki · 3 days · $690", "Fire & Stone: Gobustan & Yanar Dag · 1 day · $165", "Icherisheher & Flame Towers · 6 hours · $120", "Baku Food & Wine Evening · 4 hours · $85", "Khinalug & Quba Highlands · 2 days · $480", "Private Grand Azerbaijan · 8 days · $2,450"). `field-hint` shows the rule line for the tour kind:
  - scheduled departure: "Scheduled small-group departures · max {cap} guests · availability updates live"
  - private: "Private tour — once a date is booked or on hold, the whole 8-day period is unavailable to others"
  - day tour: "Daily except Sundays · {n} start time(s) · max {cap} guests per time"
- **Conflict alert** (only after a failed final check, section 4.1.6).
- Grid `grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]`: calendar panel left, side panel right.

**Calendar panel** (`rounded-xl border p-2 sm:p-4`):

- Month header: `‹` / `›` outline icon buttons (disabled at the range ends) around the month label (`en-GB` "November 2026", `aria-live="polite"`). Range: November 2026 – December 2027.
- Summary strip (`rounded-md bg-muted/60 px-3 py-2 text-[13px]`, `aria-live="polite"`): bold "{c} date(s) available[ · {n} booked or on hold] in {Month YYYY}." + hint by kind: "This tour runs on scheduled departures only — coloured dates are departures." / "Each date is the start of your private 8-day tour." / "Pick a green or amber date, then choose a start time."
- Weekday row "Mo Tu We Th Fr Sa Su" (Monday first), then `role="grid"` `grid grid-cols-7 gap-1`. Leading blanks are empty spans. Each day is a `button` with `aria-label` "{Sat, 28 Nov 2026}, [selected, ]{available | few spots left | fully booked | on hold | not available}", `aria-disabled` (false only for open/limited), `aria-pressed` (selected).
- Cell base: `relative flex h-12 sm:h-14 w-full flex-col items-center justify-center gap-0.5 rounded-md text-sm transition-all`. Day number plus an optional sub-label (`text-[9px] sm:text-[10px] leading-none`).

| State (`st`) | Legend label | Cell classes (light; each has `dark:` variants) | Sub-label | Clickable |
|---|---|---|---|---|
| `open` | "Available" | `border border-emerald-600/40 bg-emerald-50 font-bold text-emerald-900 hover:border-emerald-600 hover:bg-emerald-100` | "{left} left" if `cap > 1`, else "Free" | selects |
| `limited` | "Few spots left" | `border border-amber-500/60 bg-amber-50 font-bold text-amber-900 hover:…` | "{left} left" if `cap > 1`, else "Few left" | selects |
| `full` | "Fully booked" | `cursor-not-allowed border border-rose-300 bg-rose-50 text-rose-800/70` | "BOOKED" (uppercase) | opens info panel |
| `hold` | "On hold (pending)" | `cursor-not-allowed border border-dashed border-violet-400 bg-violet-50 text-violet-900/80` | "ON HOLD" | opens info panel |
| `closed` | "Not running" | `cursor-default text-muted-foreground/40` | none | opens info panel with the reason |
| `past` | (none) | `cursor-default text-muted-foreground/25` | none | no-op |
| selected | "Your selection" | `bg-primary font-bold text-primary-foreground shadow-lg ring-2 ring-primary ring-offset-2 ring-offset-background` | "✓ Selected" | — |

  Day tours return no `cap` from `dayInfo`, so their cells show "Free" / "Few left" rather than a seat count; departure tours show "{n} left"; private tours show "Free".
- Legend: `mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-xs font-medium sm:grid-cols-3` with the six swatches above.
- Link "Jump to the next available date →": selects the next open/limited date after the current selection (or after today) and moves the calendar to its month.

**Side panel** (`flex flex-col gap-4`), in order:

1. **Info alert** (`role="alert"`) when an unavailable date or full slot is clicked. Style: `alert alert-destructive` for `full` / slot-full, otherwise amber (`alert border-amber-500/50 bg-amber-50 text-amber-900 dark:…`). Titles: "{date} is fully booked" / "{date} is on hold" / "That time is fully booked" / "{date} isn’t available". Body = the reason string (section 4.1). Then "NEXT AVAILABLE" with up to 3 outline buttons ("{Sat, 5 Dec 2026}" + "Available" or "Few spots left") that select that date and jump the calendar; and, for `full` / `hold`, a secondary button "Join the waitlist for this date" → "✓ You’re on the waitlist — Leyla will email you" (keyed `tour|date`).
2. **Selected card** (`rounded-xl border bg-secondary/40 p-4`): "SELECTED", long date, span line, seat line (green, amber when limited).
   - departure: "{start} – {end} · {len} days"; "{left} of {cap} seats left" (amber when `left ≤ 3`)
   - private: "{start} – {end} · 8 days"; "Exclusively yours — no other guests"
   - day: the tour meta (e.g. "Historical · 6 hours"); "{total left} seats left across {n} time slot(s)"
3. **Start time** (day tours only): `role="radiogroup"` of `h-12` rows, time in bold + status. Status text: "{left} of {cap} seats left", with " · too few for your group" appended when the party is larger than what is left; or "Fully booked". Classes: selected `border-2 border-primary bg-accent`; default `border-2 border-border hover:border-ring`; full `cursor-not-allowed border-2 border-dashed border-border bg-muted/50 text-muted-foreground line-through decoration-destructive/60` (`aria-disabled`). Status colour: destructive bold when full, amber when `left ≤ 2` or the group does not fit, muted otherwise. Clicking a full slot opens the info alert with "{HH:MM} on {date} is fully booked ({cap} of {cap} seats taken). Choose another time or date."
4. **Empty state** (no date, no info): dashed box "Pick a date in the calendar to see live availability."
5. Date error text.
6. **Guests**: "Adults" stepper (1–8) and "Children" ("Under 12 · half price", 0–6) in `flex flex-col divide-y rounded-xl border`.
7. Seat error text.
8. **Back-up date (optional)**: select with "No back-up date" + the next 6 available dates after the selection (excluding it), long format. Hint: "Only dates that are still available are listed." Cleared automatically if the main date is later set to the same day.

Changing the tour resets `date`, `slot`, `alt`, the info alert and the conflict banner, and jumps the calendar to the month of that tour's first available date.

### 2.4 Step 2 — "2 · Your details"

| Field | Control | Default | Rule / error (shown after "Continue" is pressed on this step) |
|---|---|---|---|
| Full name | `input`, `autocomplete="name"` | "" | trimmed length ≥ 2 — "Please enter your full name." |
| Email address | `input type="email"`, `autocomplete="email"` | "" | `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` on trimmed value — "Enter a valid email, e.g. name@example.com." |
| Phone number | country-code `select` (`w-28`: 🇬🇧 +44, 🇺🇸 +1, 🇦🇿 +994, 🇦🇪 +971, 🇩🇪 +49, 🇹🇷 +90) + `input type="tel"` | `+44`, "" | at least 7 digits after stripping non-digits — "Enter a phone number with at least 7 digits." |
| Preferred language | `select`: English, Azerbaijani, Russian, Turkish | English | — |
| Pickup location (optional) | `input`, placeholder "e.g. Four Seasons, Baku" | "" | blank shows as "Your Baku hotel" in the review |
| Preferred contact method | chip radio group: WhatsApp, Email, Phone call | WhatsApp | — |
| Special requests (optional) | `textarea rows=4`, placeholder "Dietary needs, celebrations, mobility, interests…" | "" | blank shows as "None" |

Name/email grid: `grid gap-5 sm:grid-cols-2`. Invalid fields set `aria-invalid="true"`; errors are `span.field-error[role=alert]`.

Under the email field, a green status line (`role="status"`, `rounded-md bg-emerald-50 px-3 py-2 text-[13px] font-semibold text-emerald-900`) appears as soon as the typed email matches an email-bound discount: "✓ {Personal discount | Approved request | Private offer} found for this email: {10% off}".

Step 2 also validates adults (1–8): "Between 1 and 8 adults per booking." — this message has no element in the markup (unreachable through the steppers).

### 2.5 Step 3 — "3 · Review your request"

- Definition list `grid grid-cols-[minmax(120px,auto)_1fr] gap-x-6 gap-y-3 text-[15px]`, rows in order: Tour; Date ("{Sat, 17 Apr 2027}[ at 09:00]"); Back-up date; Lead traveller; Email; Phone ("{cc} {phone}"); Travellers ("2 adult(s), 0 child(ren)"); Language; Pickup; Contact via; Notes; Discount ("{label} (−$207)" or "None"); Estimated total.
- Link "Edit details" → step 2.
- **Price breakdown** card (`rounded-xl border p-5`): "{n} adult(s) × {$690}" …; "{n} child(ren) × 50%" …; optional green discount row "{name} ({15% off})" "−$207"; "Estimated total" (bold, top border). With a discount: "One discount per booking — the best one is applied automatically."
- **Discount request box** (`rounded-xl border border-dashed p-5`), only when no discount applies and the tenant has requests enabled:
  - Idle: "No offer applies to this trip" / "Celebrating, a student, or a returning guest? Ask Leyla for a special discount." + "Request a discount".
  - Form (`animate-rise`): "Request a special discount"; Type select (Percentage | Fixed amount ($)); value `input type="number" min="1"` labelled "Discount you’d like (%)" or "Amount you’d like off ($)" (default `10`); Reason textarea (optional, placeholder "e.g. honeymoon, student, returning guest, large group…"); error line; "Send request" / "Cancel"; note "Your booking request is sent either way. If approved, the discount is applied to this booking."
  - Existing request for this email + tour (`aria-live="polite"`): "Discount request {DR-1051}" + status badge + message + "Track status" (link to Offers). Messages: Pending "You asked for {10% off}. Leyla will reply within {responseDays} days."; Approved "Approved: {8% off} — applied to this booking."; Rejected "Not approved: {reason}".
- **Terms checkbox** (`rounded-lg bg-secondary/60 p-4`): "I understand this is a **booking request**, not a confirmed reservation, and I agree to the Terms & Conditions." Error: "Please confirm you understand this is a request."
- **Submit failure alert** (`alert alert-destructive`): "We couldn’t send your request just now. Please try again, or message Leyla on WhatsApp."

### 2.6 Summary aside (steps 1–3)

Tour image (`hidden h-44 w-full object-cover sm:block`), meta kicker (`text-xs uppercase tracking-[0.2em] text-highlight`), tour name (`font-display text-[28px]`). Rows between `border-y border-highlight/25`: Date; Start time (only when chosen); Availability ("Choose a date" / seat text / "Private · available"); "{n} adult(s) × {price}"; "{n} child(ren) × 50%". Discount chip (`rounded-lg bg-highlight/15 p-3`): name, "{Public offer | Private offer | Personal discount | Approved request} · {15% off}", "−$207". "Estimated total" with struck subtotal (`line-through opacity-60`) and total (`font-display text-[34px] text-highlight`). When several discounts matched: "{n} other offer(s) also matched — discounts don’t combine, so the best one is applied." Footnote: "No payment is taken now. The final price is confirmed by Leyla with availability."

### 2.7 Step 4 — confirmation

- Check icon in a circle (`h-20 w-20 animate-pop rounded-full bg-primary text-highlight`), eyebrow "Request received", `h1[role=status]` "Thank you, {first name}." (falls back to "traveller").
- Lead: "Your date is now **held for 24 hours** so no one else can take it. Leyla will check the details personally and contact you by **{contact method}** within 24 hours to confirm your journey."
- Card: "Booking reference" + reference (`font-display text-3xl tracking-wider`) + `badge badge-pending` "PENDING CONFIRMATION"; the same review definition list; and, if a discount request exists for this email + tour: "Discount request **{id}** is **{status}**. You’ll be notified by email and WhatsApp — track it any time on the Offers page."
- Actions: "Message Leyla on WhatsApp", "Browse more experiences", link "Make another request" (resets the whole wizard to initial state).

### 2.8 State, validation flow, loading and error states

Initial state (`fresh()`):

```js
{ step: 1, loading: false, failed: false, touched: {}, ref: '',
  y: 2026, m: 10,                 // calendar month (0-based)
  info: null,                     // { iso, st, why } for the info alert
  waitlisted: {},                 // { 'tour|iso': true }
  extraFull: {},                  // { 'tour|iso|slot': 1 } — slots/dates lost in a conflict
  conflict: '',                   // human label of the lost slot
  rqOpen: false, rq: { type: 'percent', value: '10', reason: '' }, rqErr: '',
  f: { /* booking draft, section 5.9 */ } }
```

- Validation runs on every render over the whole draft; a message is displayed only for keys in `touched`. Keys are marked touched **when the step's primary button is pressed**, not on blur. Step → keys: 1 `date, slot, seats`; 2 `name, email, phone, adults`; 3 `agree`. If any key of the current step has an error, the step does not advance.
- Step 1 messages:
  - no date: "Choose an available date in the calendar."
  - date no longer open/limited: "That date is no longer available — please choose another."
  - day tour, no slot: "Choose a start time."
  - day tour, slot has 0 left: "That time is fully booked — choose another."
  - day tour, party > slot seats: "Only {n} seat(s) left at {HH:MM} — reduce your group or pick another time."
  - departure, party > seats: "Only {n} seat(s) left on this departure — reduce your group or pick another date."
  ("seat" is singular when n = 1.) Private tours have no party-size check.
- Any field edit clears the conflict banner.
- "Back" decrements the step without validation. Draft values persist across steps (in memory only; lost on reload).
- **Submit** (step 3): sets `loading`, button shows spinner + "Checking availability…" and is disabled; after a simulated 1400 ms round trip one of three outcomes:
  1. **Error** (`simulateError`): `failed = true`, stays on step 3 with the destructive alert; user can resubmit.
  2. **Conflict** (`simulateConflict`): section 4.1.6.
  3. **Success**: reference generated, single-use discount consumed (section 4.3.5), step 4.
- No skeleton/loading state is designed for the calendar itself.

### 2.9 Motion

- Each step's content wrapper: `animate-rise` on mount (step change).
- Discount request form: `animate-rise` when opened.
- Stepper dots `transition-all`; mobile progress fill `transition-all duration-500`.
- Calendar cells `transition-all` (hover colour/border).
- Submit spinner `animate-spin`.
- Confirmation check `animate-pop`.

---

## 3. Offers (`Offers.dc.html`)

### 3.1 Purpose and route

Public list of live promotions, entry point to personal discount requests, and a status tracker for a discount request. Proposed route: `/offers`.

### 3.2 Layout

1. **Hero**: `relative overflow-hidden bg-hero` with a full-bleed image at `opacity-40`; content `container-x relative pb-20 pt-16 text-hero-foreground lg:pb-24 lg:pt-24`. Breadcrumb Home / Special offers. `h1` `font-display text-5xl font-medium leading-none sm:text-6xl lg:text-7xl`: "Special offers & *seasonal savings*" (the italic part in `text-highlight`). Lead: "Current promotions, applied automatically when you book. Offers don’t combine — we always apply the single best one for your trip." Badges: "{n} offers live now" (solid highlight) and "Updated {15 Nov 2026}" (outline on hero).
2. **Active offers** (`py-16 lg:py-24`, sr-only `h2` "Active offers"): `grid gap-6 lg:grid-cols-2`. Each `article.card.reveal flex flex-col overflow-hidden lg:flex-row`:
   - Image block `relative h-52 shrink-0 lg:h-auto lg:w-56` with a value tag top-left (`rounded-lg bg-highlight px-3 py-2 font-display text-3xl font-semibold text-highlight-foreground shadow-lg`): "15%" or "$300".
   - Body `flex flex-1 flex-col gap-3 p-6`: `badge badge-confirmed` "● Active" + "Valid 1 Nov – 15 Dec"; name (`h3 font-display text-3xl font-semibold text-primary`); blurb; "**Who it’s for:** {eligibility}"; a bordered, divided list of the tours covered, each row linking to the tour page with tour name + price: percentage offers show struck original + discounted price + "/ adult"; fixed offers show "−$300" + "per booking" with no strike.
   - Footer row: clock icon + "{n} days left · ends {31 Jan}" (or "Ends today" when ≤ 0 days) and "Book with this offer" (`btn btn-default rounded-full`, links to Booking with no parameters).
   - Card image = image of the first tour in the campaign.
   - **Empty state**: `card border-dashed p-14 text-center` "No offers running right now" / "New seasonal offers are announced here first."
3. **Request a personal discount** (`bg-secondary/60 py-16 lg:py-24`, `grid gap-8 lg:grid-cols-2 lg:gap-14`):
   - Left: eyebrow "Something special in mind?"; `h2` "Request a personal discount" (`text-4xl sm:text-5xl`); paragraph ending "…she’ll review it personally — usually within {responseDays} days."; three ✓ bullets ("No obligation — your booking request stays separate", "You’ll get a reply by email and WhatsApp", "Approved discounts apply automatically when you book with the same email"); CTA "Start a booking & request a discount" → Booking. When requests are disabled the CTA is replaced by an alert: "Personal discount requests are paused at the moment. Current offers above still apply automatically."
   - Right: `card p-6 sm:p-8` "Check a discount request" / "Enter the reference from your confirmation email, e.g. DR-1043." Input (`input uppercase`, placeholder "DR-0000") + "Check status". Error (`role="alert"`): "We couldn’t find {REF | that reference}. Check the code in your email (e.g. DR-1043)."
   - Result (`animate-rise rounded-xl border p-5`, `aria-live="polite"`): "{id} · {tour name}" + status badge; "Requested {15% off} · {2026-11-15 10:20}"; three-step timeline:
     1. ✓ "**Submitted** — we received your request" (always done, `bg-primary`).
     2. "**Under review** — Leyla checks dates and group details": while Pending an amber pulsing dot with "…" (`animate-pulse bg-amber-500`); once decided, ✓.
     3. Pending: outlined "3", "**Decision** — you’ll be notified by email and WhatsApp". Approved: green ✓ (`bg-emerald-600`), "**Approved** — {8% off} will apply automatically when you book with {email}". Rejected: red ✕ (`bg-destructive`), "**Not approved** — {decision reason | see the email we sent you}".
4. **Offer terms** (`py-14`, `grid gap-x-10 gap-y-2 text-sm text-muted-foreground md:grid-cols-2`): section 4.3.7.
5. Footer.

### 3.3 State and interactions

State: `{ refQ: '', found: null, refErr: '' }`. Typing clears the error. "Check status" trims and upper-cases the query and looks the request up **by id only**; on a hit it stores the id (the card then stays live if the request changes in another tab). No loading state.

### 3.4 Motion

Hero heading, lead and badges: `animate-rise` with `delay-1` / `delay-2` stagger. Offer cards: `reveal` (scroll-into-view reveal, owned by the missing stylesheet/support script). Status result: `animate-rise`. Pending step dot: `animate-pulse`.

---

## 4. Business rules

### 4.1 Availability model

There are three tour kinds (`kind`), each with its own availability unit:

| `kind` | Unit that is booked | Capacity | Sample tours |
|---|---|---|---|
| `day` | (date, start time) slot | `cap` seats **per slot** | `fire` (08:30, 13:00), `old` (09:00, 14:00, 18:00), `food` (19:00); cap 8 |
| `dep` | scheduled departure start date (covers `len` days) | `cap` seats per departure | `sheki` (explicit date list, cap 8, 3 days); `khin` (every Saturday, cap 6, 2 days) |
| `private` | exclusive date range of `len` days starting on the chosen date | 1 party | `grand` (8 days) |

#### 4.1.1 Global rules (evaluated first, in order)

1. Date before today → `past` ("This date has passed"). Not selectable, no info panel.
2. Date after the booking horizon (`2027-12-31`) → `closed` ("Not scheduled yet"). The calendar cannot navigate before the current month or beyond December 2027.

#### 4.1.2 Guide calendar (single shared resource)

`guideBusy(date)` returns a label when the tenant's guide is committed elsewhere:

- every scheduled `sheki` departure, for all `len` days (start … start + 2) → "Silk Road to Sheki";
- every `grand` range that is booked **or on hold** → "a private tour".

Day tours and weekly departures (`khin`) are `closed` on those days with "Leyla is away guiding {label}". A private tour start date is `closed` when any of its 8 days overlaps a scheduled Sheki departure ("Your 8 days would overlap a scheduled Sheki departure"). (`khin` departures and day-tour bookings do not feed the busy list in the prototype — section 7, item 8.)

#### 4.1.3 Day tours

1. Sunday → `closed` ("Leyla’s day off (Sundays)").
2. Guide busy → `closed`.
3. Otherwise compute each slot `{ t, left, cap }` where `left = cap − seats taken` (the prototype derives `taken` from a hash and a fixed list of full slots; the real value is the sum of seats on live bookings for that slot).
4. Day state from its slots, with `left = Σ slot.left`:
   - `full` when `left = 0` — "Every time slot is fully booked";
   - `limited` when any slot has 1–2 seats left **or** total `left ≤ 4`;
   - `open` otherwise.
5. Slot display: full (0 left), few (1–2 left), "too few for your group" (party > left), normal.
6. A date can be selected when open/limited; a start time is then mandatory, the slot must have seats, and `adults + children ≤ slot.left`.

#### 4.1.4 Scheduled departures

1. `sheki`: only dates present in the departures map run; any other date is `closed` ("No scheduled departure — private dates on request").
2. `khin`: only the configured weekday (`weekly: 6`, Saturday) runs; other days are `closed` ("Departs every Saturday"); guide-busy Saturdays are `closed`.
3. `left = cap − taken`: `full` at 0 ("All {cap} seats are booked"), `limited` at `left ≤ 3`, else `open`.
4. `adults + children ≤ left` is required.
5. The tour detail page lists departures instead of a calendar and adds: past departures are rendered as sold out; clicking a sold-out departure offers the waitlist.

Sample `sheki` departures (`start: seats taken` of 8) and resulting state: 2026-11-28: 6 (limited, 2 left) · 2026-12-12: 8 (full) · 2027-03-20: 5 (limited, 3) · 2027-04-03: 8 (full) · 2027-04-17: 4 (open, 4) · 2027-05-08: 5 (limited, 3) · 2027-05-22: 8 (full) · 2027-06-12: 6 (limited, 2) · 2027-09-18: 7 (limited, 1) · 2027-10-09: 3 (open, 5).

#### 4.1.5 Private tours

The chosen date is the **start** of an exclusive `len`-day block `[start, start + len − 1]`. For a candidate start:

1. If the block overlaps an existing block (`start ≤ b.end && end ≥ b.start`):
   - status `hold` → state `hold`: "On hold for another guest’s pending request ({from} – {to})";
   - status `booked` → state `full`: "Already booked by another guest ({from} – {to})".
2. If the start was lost in a just-failed conflict → `full`: "Just booked by another guest".
3. If any day overlaps a scheduled Sheki departure → `closed`.
4. Otherwise `open` with `left: 1, cap: 1` ("Free"; "Exclusively yours — no other guests").

Sample blocks: `['2027-01-11','2027-01-18','booked']`, `['2027-04-05','2027-04-12','booked']`, `['2027-06-14','2027-06-21','hold']`. No party-size limit is applied to private tours beyond the steppers.

#### 4.1.6 Holds, waitlist and the last-second double-booking check

- **Hold**: a submitted request places a hold. The customer is told: "Your date is now **held for 24 hours** so no one else can take it." Other customers see `hold` (violet dashed, "ON HOLD", "On hold for another guest’s pending request") on private tours. For seat-based tours a hold simply consumes seats (there is no visual "held seats" state).
- **Waitlist**: offered on `full` and `hold` dates (Booking) and on sold-out departures (Tour detail). The prototype only flips a local flag (`tour|date`); copy promises "Leyla will email you", so an email must be known or collected.
- **Final availability check** (`simulateConflict`): on submit the server re-checks the exact unit (`tour|date|slot`, slot empty for non-day tours) while the button reads "Checking availability…". If it was taken in the meantime:
  1. the wizard returns to step 1;
  2. the selected `date` and `slot` are cleared; every other draft value (guests, contact details, notes, back-up date, terms tick) is kept; touched flags are reset;
  3. that unit is now rendered unavailable (slot full / departure full / private start "Just booked by another guest");
  4. a destructive alert (`role="alert"`, warning-triangle icon) appears above the calendar: "**Sorry — {Sat, 17 Apr 2027[ at 09:00]} was just booked by another guest.**" / "To avoid a double booking we’ve released your selection. Please choose another date or time below — nothing else you entered has been lost.";
  5. the alert disappears on the next field change.
- Step-level re-validation also covers staleness without a conflict: "That date is no longer available — please choose another." and the seat-count messages.

### 4.2 Pricing

- One base price per tour (`price`, whole US dollars in the sample), **per adult**. Children ("Under 12") pay **half**: `base = adults × price + children × price / 2`.
- "Private" pricing is not a separate price model in these screens: the private tour (`grand`, $2,450) is also priced per adult × party. Making a scheduled tour private is by request only (FAQ: "I’ll quote a private rate").
- No extras/add-ons, no deposits, no taxes or fees, no payment step exist in these three files. All totals are labelled "Estimated total" and the copy states "No payment is taken now. The final price is confirmed by Leyla with availability."
- Party limits in the UI: adults 1–8, children 0–6, plus the seat checks in 6.1. (The tour page also states "Group size 2 – 8 guests"; the lower bound of 2 is not enforced.)
- Currency: US dollars, symbol prefix, `en-US` grouping, no decimals: `'$' + Math.round(n).toLocaleString('en-US')` → "$2,450". The Booking page's local formatter omits the rounding, so half-priced children on odd prices can render as "$82.5" (section 7, item 5).
- Dates: `en-GB`. Short "17 Apr 2027"; long "Sat, 17 Apr 2027"; month label "November 2026"; offer dates "15 Dec".

### 4.3 Discounts and offers

#### 4.3.1 Sources of discount

| Source label (shown to customer) | Record | Bound to | Single use |
|---|---|---|---|
| "Public offer" | campaign, `visibility: 'public'` | anyone meeting the eligibility rules | no (`uses` counter) |
| "Private offer" | campaign, `visibility: 'private'`, optional `code` (e.g. `WELCOMEBACK`) | emails in `assigned[]` | no |
| "Personal discount" (label "Personal discount from Leyla") | manual discount created by staff | one email, one tour or `any`, with `expiry` | yes (`usedBy` = booking reference) |
| "Approved request" (label "Your approved request DR-1043") | discount request with status Approved | the requester's email and the requested tour | yes (`usedBy`) |

Discount types everywhere: `percent` (value = percentage) or `fixed` (value = dollars).

There is **no code-entry field** anywhere in the customer flow. Private campaigns and personal discounts are matched purely by the email typed in step 2; the campaign `code` is stored but never used by these screens.

#### 4.3.2 Campaign status (derived, never stored)

```
!active            → 'Inactive'
end   <  today     → 'Expired'
start >  today     → 'Scheduled'
otherwise          → 'Active'      // start and end dates are inclusive
```

Only `Active` campaigns can apply. The header count and the Offers page list `Active` + `public` campaigns only.

#### 4.3.3 Eligibility (a candidate must pass every test)

Campaign:

1. status is `Active`;
2. `tours` contains the tour id or `'all'`;
3. if private: a non-empty email that is in `assigned` (emails compared trimmed, lower-cased);
4. `minGuests`: `adults + children ≥ minGuests`;
5. `minChildren`: `children ≥ minChildren`;
6. `bookAhead`: a travel date is selected and `days between today and travel date ≥ bookAhead`.

Personal discount: same email, `usedBy` empty, `expiry ≥ today`, `tour` is `'any'` or the tour id.
Approved request: same email, `status === 'Approved'`, same tour, has a decision, `usedBy` empty. The discount granted is the **decision's** type/value, not the requested one.

Customer-facing eligibility summary (`eligText`), joined with " · ": "{n}+ guests", "at least {n} child", "booked {n}+ days ahead", "assigned guests only"; or "Everyone" when unconditional.

#### 4.3.4 Amount and "only the single best discount applies"

- `amount = percent ? Math.round(base × value / 100) : Math.min(value, base)`. Percentage discounts apply to the whole booking base (adults and children); fixed discounts apply once per booking and can never exceed the base.
- All eligible candidates are sorted by `amount` descending; the first is applied (`settings.stacking: 'best'`). `total = base − best.amount`. Nothing stacks.
- The quote returns `{ base, best, amount, total, others, all }` where `others = candidates − 1`. When `others > 0` the summary says "{n} other offer(s) also matched — discounts don’t combine, so the best one is applied."
- Label format: "15% off" / "$300 off".

Worked default (tour page: `sheki`, 2 adults, departure 2027-04-17, today 2026-11-15): base $1,380; "Autumn in the Caucasus" 15% → −$207; total $1,173. Note that the offer window constrains the **booking** date, not the travel date.

#### 4.3.5 Consuming single-use discounts

On a successful booking submit, if the applied discount's source is "Personal discount" or "Approved request", the record's `usedBy` is set to the new booking reference and an audit-log entry is written: "{label} (−$X) used on {ref} — locked so it can’t be applied twice" (`kind: 'used'`, `who: 'System'`). Campaign `uses` is not incremented by the prototype.

#### 4.3.6 Struck-through / list prices

`listPrice(tour)` produces the per-adult "from" price used by the tour page:

- Candidates: `Active`, `public` campaigns covering the tour that have **no** `minGuests` and **no** `minChildren` (a `bookAhead` condition does not exclude a campaign here). Best = largest amount against one adult price.
- Percentage best → `{ has: true, strike: true, orig: '$690', now: '$586', badge: '−15%', name, ends: 'Ends 15 Dec' }`: original struck through, discounted price large.
- Fixed best → `{ has: true, strike: false, fixedWhole: true, now: '$2,450', badge: '$300 off per booking', … }`: no strike-through, because a fixed amount applies per booking, not per person.
- No unconditional campaign → `{ has: false, now: base }`; if a conditional campaign exists it is described in `badge` ("8% off · 6+ guests") with `hasNote: true` (not rendered on the tour page, which shows "No current offer — request a discount when you book.").

Where struck prices appear:

| Place | What is struck | Shown next to it |
|---|---|---|
| Tour page "From" price | base adult price (percentage offers only) | discounted adult price, badge, offer name, end date |
| Tour page / mobile bar "Estimated total" | undiscounted base for the party | discounted total, green "−$X" row with "{name} ({label})"; mobile bar shows "({label})" |
| Booking summary aside | subtotal (`line-through opacity-60`) | total in highlight colour, discount chip with source |
| Booking step 3 breakdown | nothing struck | green discount line above the total |
| Offers card tour rows | base adult price for percentage campaigns | discounted adult price "/ adult"; fixed campaigns show "−$300 per booking" |

The Offers page strikes per-adult prices for **every** percentage campaign, including conditional ones (e.g. "Groups of 6+"), relying on the "Who it’s for" line to state the condition.

#### 4.3.7 Published offer terms (verbatim)

- "One discount per booking — the best eligible offer is applied automatically."
- "Offers apply to new booking requests made during the offer period."
- "Percentage offers apply to the full trip price; fixed offers apply once per booking."
- "Personal and approved discounts are linked to the email used to book, and can be used once."
- "Expired offers are removed automatically and can’t be applied."
- "Final prices are confirmed by Leyla together with availability."

#### 4.3.8 Discount requests

Settings (tenant-level): `{ requestsEnabled: true, maxRequestPct: 30, notify: 'email+whatsapp', responseDays: 2, stacking: 'best' }`.

Where a customer can request: only inside the booking wizard, step 3, and only when **no** discount currently applies and `requestsEnabled` is true. The Offers page only links to the wizard.

Submit rules (server; evaluated in this order, first failure wins):

| # | Check | HTTP | Message |
|---|---|---|---|
| 1 | requests enabled | 403 | "Discount requests aren’t available at the moment." |
| 2 | tour exists | 400 | "This tour can’t be found." |
| 3 | email valid (same regex as booking) | 422 | "Add a valid email so we can reply." |
| 4 | type is `percent` or `fixed`, value finite and > 0 | 422 | "Please enter a valid discount." |
| 5 | fixed value < request base | 422 | "We can’t consider a discount this large for this trip. Please request a smaller amount." |
| 6 | equivalent percentage ≤ `maxRequestPct` | 422 | same generic message as 5 (the cap itself is never disclosed) |
| 7 | no other `Pending` request for the same email + tour | 409 | "You already have a discount request waiting for this tour." |

- Request base = `tour price × max(1, guests)` where `guests = adults + children` (children counted at full price here, unlike the booking base). Equivalent percentage: `percent → value`; `fixed → value / base × 100` (999 when base is 0).
- On success the value is rounded to 2 decimals and a request is stored with `status: 'Pending'`, `decision: null`, `booking: '(new request)'`, name (or "Guest"), lower-cased email, phone "{cc} {phone}", tour, guests, type, value, reason, timestamp; an audit-log entry "Requested {label} on {tour name}" (`kind: 'request'`) is added.
- Request ids: `DR-` + sequential number (`'DR-' + (1047 + requests.length)` in the prototype; sample ids DR-1041 … DR-1046).
- `simulateTamper` demonstrates that a forged payload (50%) is rejected by rule 6 regardless of what the form shows.
- The booking request is independent: "Your booking request is sent either way. If approved, the discount is applied to this booking."

Decision rules (owner only; `serverDecide`):

| Check | HTTP | Message |
|---|---|---|
| actor role is `owner` | 403 | "Only owners can approve or reject discount requests." |
| request exists | 404 | "Request not found." |
| request is still `Pending` | 409 | "This request has already been decided." |
| reject: non-empty reason | 422 | "Add a reason so the customer understands." |
| approve: value > 0 | 422 | "Enter the discount you’re approving." |
| approve: granted % ≤ requested % | 422 | "You can’t approve more than the customer asked for ({label})." |
| approve: granted % ≤ `maxRequestPct` | 422 | "That’s above your maximum of {max}%. Approve {max}% or less, or reject." |

The owner may approve a different type/value than requested (sample: asked 10%, approved 8%) as long as its percentage equivalent does not exceed either bound.

Status model:

```
Pending ──approve──▶ Approved ──applied to a submitted booking──▶ (used: usedBy = reference)
   └─────reject────▶ Rejected
```

Decided requests are final. Badges: Pending `badge-pending`, Approved `badge-confirmed`, Rejected `badge-cancelled`. The customer is notified "by email and WhatsApp" and can track the status on the Offers page with the DR reference.

### 4.4 Booking request lifecycle

- The customer submits a **request**, never a confirmed reservation (terms checkbox wording; CTA "Submit booking request").
- On submit the server must, atomically: re-check availability, create the booking, place the hold, compute the price and best discount, consume a single-use discount, and return the reference.
- **Reference format**: `AJ-{first three letters of the tour id, upper-cased}-{random 4-digit number 1000–9999}` → `AJ-SHE-4821`, `AJ-FIR-2045`, `AJ-OLD-7720`, `AJ-GRA-3412`, `AJ-LAN-6618`. `AJ` is the tenant prefix (Aurelia Journeys). Random digits give no uniqueness guarantee in the prototype.
- **Status shown to the customer**: "Pending confirmation" (`badge-pending`). The only other states visible from these three screens are implied by availability ("booked", "on hold") and by the badge palette (`badge-confirmed`, `badge-cancelled`). The admin screen `AdminBookings.dc.html` (outside this document) uses the status strings Pending, Approved, Confirmed, Rejected, Cancelled, Completed; take the authoritative lifecycle from its document.
- **What the customer is told happens next**:
  - the date is held for 24 hours;
  - the guide checks the details personally and replies via the chosen contact method (WhatsApp, Email or Phone call) within 24 hours;
  - no payment is taken now; the final price is confirmed together with availability;
  - (tour page) "No payment now. Leyla confirms availability personally within 24 hours.";
  - a pending discount request is answered by email and WhatsApp, usually within `responseDays` (2) days.
- **Cancellation policy**: none of the three files contains any cancellation, refund or deposit text. The only legal references are the links to "Terms & Conditions" and "Privacy Policy" (both pointing at the Contact page). Policy copy must come from another screen or from tenant settings.
- What happens when the 24-hour hold lapses is not specified.

---

## 5. Data shapes (as they appear in the scripts)

### 5.1 Tour, availability side (`tours()`; keyed by tour id)

```js
// kind: 'dep' with explicit departures
sheki: { name: 'Silk Road to Sheki', kind: 'dep', cap: 8, len: 3, price: 690,
         meta: 'Cultural · 3 days', img: 'sheki',
         deps: { '2026-11-28': 6, '2026-12-12': 8, /* startDate: seatsTaken */ } }
// kind: 'dep' with a weekly rule
khin:  { name: 'Khinalug & Quba Highlands', kind: 'dep', cap: 6, len: 2, price: 480,
         meta: 'Adventure · 2 days', img: 'khinalug',
         weekly: 6,                                   // JS weekday, 6 = Saturday
         full: ['2026-11-21','2026-12-19','2027-01-02','2027-05-15'] }
// kind: 'private'
grand: { name: 'Private Grand Azerbaijan', kind: 'private', len: 8, price: 2450,
         meta: 'Private · 8 days', img: 'khinalug',
         booked: [['2027-01-11','2027-01-18','booked'], ['2027-06-14','2027-06-21','hold']] }
// kind: 'day'
old:   { name: 'Icherisheher & Flame Towers', kind: 'day', cap: 8, price: 120,
         meta: 'Historical · 6 hours', img: 'oldcity', slots: ['09:00','14:00','18:00'] }
```

| Field | Type | Notes |
|---|---|---|
| `name` | string | |
| `kind` | `'day' \| 'dep' \| 'private'` | availability model |
| `cap` | number | seats per slot (`day`) or per departure (`dep`); absent for `private` |
| `len` | number | days; `dep` and `private` |
| `price` | number | per adult, USD |
| `meta` | string | "{category} · {duration}" |
| `img` | string | image key |
| `deps` | `Record<ISODate, seatsTaken>` | explicit departures |
| `weekly` | 0–6 | weekly departure weekday |
| `full` | `ISODate[]` | weekly departures forced full (mock) |
| `booked` | `[from, to, 'booked' \| 'hold'][]` | private blocks, inclusive |
| `slots` | `'HH:MM'[]` | day-tour start times |

Promo-side price list (`promoTours()`): `Record<tourId, { n: string, p: number }>` — the six tours above plus `wine` (Shamakhi Wine Route, 210), `lank` (Lankaran Tea & Hirkan Forest, 560), `bespoke` (Bespoke Azerbaijan, 3200). The two lists must be one table in Wayfold.

### 5.2 Tour detail content (inline in `renderVals`, no named object)

| Object | Shape | Example |
|---|---|---|
| Header facts | static markup | badges `['Featured','Cultural']`; route string; rating `4.9`; review count `71`; host name; duration "3 days · 2 nights"; group size "2 – 8 guests"; meeting point "Your Baku hotel"; languages `['EN','AZ','RU','TR']` |
| Photo | `{ img: string, alt: string }` | `{ img: '/_blob/…', alt: 'Sheki beneath the Greater Caucasus' }` |
| Highlight | `string` | 'A night inside the 18th-century Upper Caravanserai' |
| Itinerary day | `{ where: string, title: string, text: string, meta: string }` (+ derived `n`, `open`) | `{ where: 'Sheki', title: 'Palaces, stained glass and halva', text: '…', meta: 'Walk 3 h · Breakfast & dinner · Halva class' }` |
| Inclusion / exclusion | `string` (two arrays `inc`, `exc`) | 'All entrance fees' / 'Travel insurance (required)' |
| Important info | `string[]` (static list) | 'Please dress modestly for mosques; scarves are provided.' |
| FAQ | `{ q: string, a: string }` | |
| Review | `{ name, init, country, date, text }` | `{ name: 'Aiko Tanaka', init: 'AT', country: 'Japan', date: 'May 2026', text: '…' }` |
| Related tour | `{ title, meta, price, img }` | `{ title: 'Khinalug & Quba Highlands', meta: 'Adventure · 2 days', price: '$480', img }` |
| Meeting point | plain string only | "Your Baku hotel"; no address, map or coordinates exist in the design |

### 5.3 Availability results

```ts
// dayInfo(tourId, isoDate)
{ st: 'open' | 'limited' | 'full' | 'hold' | 'closed' | 'past',
  why?: string,          // reason shown in the info alert
  left?: number,         // seats left (day: sum of slots; dep: departure; private: 1)
  cap?: number,          // dep and private only
  slots?: SlotInfo[] }   // day tours only
// slotInfo(tourId, isoDate, time)
{ t: '09:00', left: 5, cap: 8 }
// calendar cell (calCells)
{ blank: false, key: iso, day: 28, iso: '2026-11-28', st, sub: '2 left', hasSub: true,
  subCls, cls, aria: 'Sat, 28 Nov 2026, few spots left', dis: 'false', pressed: 'false', pick }
```

Availability keys used for conflicts/holds: `'{tourId}|{isoDate}|{HH:MM or empty}'`. Waitlist key: `'{tourId}|{isoDate}'`.

### 5.4 Promo store (`promoDefaults()`, persisted whole under `aj-promo`)

```ts
{ settings: Settings, campaigns: Campaign[], manual: ManualDiscount[],
  requests: DiscountRequest[], log: LogEntry[] }
```

### 5.5 Settings

`{ requestsEnabled: true, maxRequestPct: 30, notify: 'email+whatsapp', responseDays: 2, stacking: 'best' }`

### 5.6 Campaign (offer)

```js
{ id: 'c1', name: 'Autumn in the Caucasus', code: '', type: 'percent', value: 15,
  tours: ['sheki','khin'], start: '2026-11-01', end: '2026-12-15',
  visibility: 'public', assigned: [], minGuests: 0, minChildren: 0, bookAhead: 0,
  active: true, uses: 41, blurb: 'Golden forests, harvest suppers and crisp mountain air — …' }
```

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `name`, `blurb` | string | public title and description |
| `code` | string | `''` or e.g. `'WELCOMEBACK'`; unused by the customer flow |
| `type` | `'percent' \| 'fixed'` | |
| `value` | number | percent or dollars |
| `tours` | `string[]` | tour ids or `['all']` |
| `start`, `end` | ISO date | inclusive |
| `visibility` | `'public' \| 'private'` | |
| `assigned` | `string[]` | lower-case emails (private campaigns) |
| `minGuests`, `minChildren`, `bookAhead` | number | `0` = no condition; `bookAhead` in days |
| `active` | boolean | manual on/off switch |
| `uses` | number | counter |

Sample set: c1 Autumn in the Caucasus (15%, sheki+khin), c2 Early Bird 2027 ($300, grand+bespoke, `bookAhead: 90`), c3 Family Adventures (10%, fire+lank, `minChildren: 1`), c4 Groups of 6+ (8%, old+food+fire, `minGuests: 6`), c5 Returning Guests (12%, all, private, code WELCOMEBACK), c6 Novruz Spring 2026 (20%, expired), c7 Caspian Summer (12%, inactive).

### 5.7 Manual (personal) discount

```js
{ id: 'm1', name: 'Eleanor Whitfield', email: 'eleanor@example.com', booking: 'AJ-SHE-4821',
  tour: 'any', type: 'percent', value: 10, expiry: '2027-05-31',
  note: 'Anniversary gesture — second trip with us', by: 'Leyla Mammadova',
  at: '2026-11-02', usedBy: '' }
```

`booking` = the past booking that motivated it; `tour` = tour id or `'any'`; `usedBy` = `''` or the booking reference that consumed it (e.g. `'AJ-OLD-7720'`).

### 5.8 Discount request, decision, quote, log

```js
// request
{ id: 'DR-1043', name: 'Maria Santos', email: 'maria@example.com', phone: '+55 11 91234 5678',
  tour: 'fire', booking: 'AJ-FIR-2045',          // or '(new request)'
  guests: 1, type: 'percent', value: 10, reason: 'Student travelling solo.',
  status: 'Approved',                             // 'Pending' | 'Approved' | 'Rejected'
  at: '2026-11-10 14:12', decision: Decision | null,
  usedBy: '<booking reference>' }                   // optional; added when the discount is consumed
// decision — approved
{ type: 'percent', value: 8, note: 'Approved 8% for students with ID.',
  by: 'Leyla Mammadova', at: '2026-11-11 09:30', notified: true }
// decision — rejected
{ reason: 'This date is already over capacity — …', by: 'Leyla Mammadova',
  at: '2026-11-09 08:15', notified: true }
// submit payload (client → server)
{ tour: 'sheki', email: 'a@b.co', guests: 2, type: 'percent', value: '10' }
// submit / decide result
{ ok: true, value: 10 }  |  { ok: false, code: 422, error: '…' }
// quote(tourId, adults, children, { date?, email? })
{ base: 1380, best: Candidate | null, amount: 207, total: 1173, others: 0, all: Candidate[] }
// Candidate
{ source: 'Public offer' | 'Private offer' | 'Personal discount' | 'Approved request',
  label: 'Autumn in the Caucasus', type: 'percent', value: 15, amount: 207, id: 'c1' }
// listPrice(tourId)
{ has: true, orig: '$690', now: '$586', badge: '−15%', name: 'Autumn in the Caucasus',
  ends: 'Ends 15 Dec', fixedWhole: false, strike: true, hasNote: false }
// log entry
{ at: '2026-11-15 10:20', who: 'Kenji Watanabe (customer)',
  what: 'Requested 15% off Icherisheher & Flame Towers',
  kind: 'request' }   // 'request' | 'approve' | 'reject' | 'campaign' | 'manual' | 'used'
```

### 5.9 Booking draft (`state.f`) and the submitted booking

```js
{ tour: 'sheki',        // tour id
  date: '',             // ISO date; start date for dep/private
  slot: '',             // 'HH:MM', day tours only
  alt: '',              // optional back-up ISO date
  name: '', email: '', cc: '+44', phone: '',
  adults: '2', kids: '0',          // strings in the draft, parsed to ints
  lang: 'English',                 // English | Azerbaijani | Russian | Turkish
  pickup: '',                      // optional free text
  method: 'WhatsApp',              // WhatsApp | Email | Phone call
  notes: '',                       // optional free text
  agree: false }                   // terms acknowledgement
```

Result of a successful submit: `ref` (e.g. `'AJ-SHE-4821'`), status "Pending confirmation", and the review list (section 2.5) as the confirmation summary. The prototype stores no booking record; the persisted booking must additionally snapshot: tour, kind, date range, slot, party, unit price, base, applied discount (source, record id, type, value, amount), total, currency, hold expiry, timestamps.

---

## 6. Cross-page shared state

| Mechanism | Name | Payload | Written by | Read by |
|---|---|---|---|---|
| `localStorage` | `aj-ui` | `{ theme: 'emerald', mode: 'light', radius: 'md', font: 'classic' }` (JSON) | `saveUi(patch)` (theme/mode controls; exposed as `cycleMode`, `pickTheme` but not rendered on these three pages) | all pages on mount; merged over defaults |
| `BroadcastChannel` | `aj-ui` | the same object | `saveUi` | all open tabs → live theme switch |
| `localStorage` | `aj-promo` | the whole promo store `{ settings, campaigns, manual, requests, log }` (JSON); ignored unless it has `campaigns` | Booking (`promoSave` on discount request and on consuming a single-use discount); admin promotions screen | TourDetail, Booking, Offers on mount; falls back to `promoDefaults()` |
| `BroadcastChannel` | `aj-promo` | the same whole object | `promoSave` | all open tabs → prices, offer count and request status update live |
| `window` `storage` event | keys `aj-ui`, `aj-promo` (also fires a reload when `key` is null, i.e. storage cleared) | — | browser | re-reads the key |
| `matchMedia('(prefers-color-scheme: dark)')` change | — | — | OS | re-render when mode is `system` |
| `window` `scroll` (passive) | — | sets `scrolled` when `scrollY > 40` | — | header variant (only matters over a hero) |

Not present: `sessionStorage`, custom DOM events, URL/query parameters, cookies. In particular the **booking draft and the tour-page selection are not shared at all** — component state only.

Design props (editor-only): `theme` (`admin | emerald | caspian | pomegranate | graphite`) and `mode` (`admin | light | dark | system`) override the stored values unless set to `admin`; Booking adds `simulateError`, `simulateConflict`, `simulateTamper`.

In Wayfold, `aj-ui` becomes the tenant theme record and `aj-promo` becomes server data (offers, discounts, requests, audit log); the BroadcastChannel behaviour maps to revalidation/refetch, not to client storage.

---

## 7. Ambiguities and inconsistencies found in the design

1. **No hand-off from tour page to booking.** "Book This Experience", "Continue to booking request" and "Book with this offer" are plain links; the chosen departure, guest counts and offer are dropped, and the wizard always opens on `sheki` with no date and 2 adults.
2. **Hard-coded price labels on the desktop booking card**: "Adults $690 each" and "Under 12 · $345" ignore the active offer, while the mobile sheet shows the discounted "{$586} each" and "half price".
3. **Gallery count**: caption says "26 photos"; only 5 exist and the lightbox counts "1 / 5".
4. **Group size**: "2 – 8 guests" on the tour page vs. a minimum of 1 adult in every stepper; adults ≤ 8 and children ≤ 6 are independent, so 14 people can be entered for a private tour (no capacity check), and the "Between 1 and 8 adults per booking." error has no place in the markup.
5. **Money formatting**: the Booking page's local `money` does not round (possible "$82.5"); the shared `money` rounds to whole dollars. Half prices on odd amounts need a defined rounding rule and minor-unit storage.
6. **Two different "today" values** (2026-11-15 for offers, 2026-11-16 as the first bookable day). Whether same-day booking is allowed, and any minimum notice, is undefined.
7. **Request base vs. booking base**: the discount-request cap is computed with children at full price; the booking total charges them half, so the effective cap differs from 30% of the real total.
8. **Guide-busy model is partial**: only Sheki departures and private blocks block other tours. Khinalug departures and day-tour bookings do not block anything, so a Saturday day tour and a Khinalug departure can coexist; a scheduled Sheki departure blocks other tours even with no seats sold. The private-tour overlap message hard-codes "8 days" and "Sheki".
9. **Rejected request blocks a new one in the UI**: with a Rejected request for the same email + tour the wizard shows only the rejection (no way to ask again), although the server rule only forbids a second *Pending* request.
10. **Approved-request message placement**: the "Approved … applied to this booking" row sits inside the box that is only rendered when *no* discount applies, so it is effectively shown only after the approval has already been used.
11. **Discount status lookup by reference only**: the Offers tracker reveals tour, amounts, rejection reason and the customer's email to anyone who enters or guesses a sequential `DR-` id.
12. **Private campaign `code`** exists in the data but there is no promo-code input; matching is by email alone, which also means anyone typing an assigned email receives that discount (no ownership proof).
13. **Offers cards show conditional discounts as struck per-adult prices** (e.g. Groups of 6+), and a `bookAhead` campaign counts as a list-price offer on the tour page even when the selected date would not qualify.
14. **Hold semantics**: "held for 24 hours" is promised, but expiry behaviour, whether a hold consumes seats on shared departures, and how `hold` differs visually on seat-based tours are not designed.
15. **Waitlist** collects no contact details on either page yet promises an email.
16. **No cancellation/refund/deposit copy** anywhere in these screens; Terms and Privacy links point to the Contact page.
17. **Booking statuses**: only "Pending confirmation" appears here; the status vocabulary must be reconciled with the admin bookings design.
18. **Reference numbers** are random 4-digit values (collisions possible) and derive their middle part from an internal tour id.
19. **Related tours / offers reference tours with no availability definition** (`wine`, `lank`, `bespoke` exist only in the promo price list), and every tour link points at the single Sheki detail page.
20. **Offers hero** uses the solid header although a transparent over-hero variant exists; treat as intentional unless other screens differ.
21. **Lightbox/sheets** define no Escape, focus-trap, arrow-key or swipe behaviour in script.
22. The mobile sticky bar text says "{n} adults · est." and ignores children in the label (the total includes them).

---

## Implementation notes for multi-tenant mapping

### Must be enforced server-side (never trusted from the browser)

1. **Tenant scoping**: every read and write is resolved from the request host/tenant, never from a client-supplied tenant id. Tour ids, campaign ids, request ids and booking references are unique per tenant.
2. **Price**: the server recomputes `base` from the tenant's stored tour price, child rule and party; the client sends only tour, date, slot, adults, children, contact data. Client totals are display-only.
3. **Discount selection**: the server re-derives campaign status from its own clock (tenant time zone), re-checks every eligibility rule (tour, visibility + assigned email, `minGuests`, `minChildren`, `bookAhead`, validity window), applies the single best candidate, and stores a snapshot on the booking. The client never names the discount to apply.
4. **Single-use discounts**: consuming a personal discount or approved request (`usedBy`) happens in the same transaction as booking creation, with a uniqueness guarantee so two concurrent bookings cannot both use it. Define whether a cancelled/rejected booking releases it.
5. **Availability and capacity**: date state, slot seats, departure seats and private-block overlap are computed from bookings and holds in the database. Booking creation re-checks inside a transaction (row lock or exclusion/unique constraint on the bookable unit) — this is the real version of `simulateConflict`; the response must distinguish "unit taken" (return to step 1 with the conflict banner) from generic failure (retry alert).
6. **Holds**: created with the booking, with a server-side `hold_expires_at` (24 h in the design, should be a tenant setting) and a job that releases expired holds.
7. **Guide/resource calendar**: closed days (weekly day off, guide busy, overlap with scheduled departures, booking horizon, past dates) are derived server-side from tenant schedule data.
8. **Input validation**: name ≥ 2 chars, email pattern, phone ≥ 7 digits, adults 1–8 (tenant-configurable), children ≥ 0, party ≤ seats left, slot required for day tours, terms accepted (store the acceptance timestamp and terms version). Mirror messages client-side for UX only.
9. **Discount requests**: all seven submit rules and all decision rules in section 4.3.8, including the hidden `maxRequestPct` cap, the one-pending-per-email-and-tour rule (unique partial index), "cannot approve more than asked", owner-only decisions (role from the session, not the payload), and immutability after a decision. Add rate limiting, since the endpoint is public.
10. **Request status lookup**: require the reference plus the requester's email (or a signed link) and return the minimum needed; do not echo the email.
11. **Private offers / personal discounts**: because they bind to an email, either verify ownership of the email (magic link/OTP) before revealing or applying them, or accept the design's weaker model as a deliberate tenant-level choice. The "found for this email" hint is an enumeration oracle as designed.
12. **References and ids**: generated server-side with a per-tenant uniqueness constraint (`{tenant prefix}-{tour code}-{number}`, `DR-{sequence}`).
13. **Audit log**: written by the server for request, approve, reject, campaign, manual and used events, with actor identity.
14. **Notifications** (email / WhatsApp, per `settings.notify`) are triggered server-side on booking received, discount request received and decided; `decision.notified` records delivery.
15. **Theme**: resolved from tenant settings on the server; `localStorage` is at most a visitor preference for light/dark.

### Database entities implied

| Entity | Key fields |
|---|---|
| `tenant` | slug/domain, display name, reference prefix (`AJ`), currency, locale, time zone, contact channels (WhatsApp, email), theme (`theme`, `mode`, `radius`, `font`), booking horizon, weekly days off, hold duration, confirmation SLA text |
| `tour` | tenant, slug, name, category, kind (`day`/`dep`/`private`), duration (`len` days or hours), capacity, group min/max, adult price (minor units), child price rule (50%, age limit 12), meta line, route, meeting point, languages[], badges (featured), rating/review count (derived), status |
| `tour_media` | tour, url, alt, sort order |
| `tour_highlight`, `tour_itinerary_day` (`n`, `where`, `title`, `text`, `meta`), `tour_inclusion` (included/excluded, text), `tour_info_note`, `tour_faq` (`q`, `a`), `tour_related` | tour, sort order |
| `tour_schedule_rule` | tour, weekday(s) for weekly departures, start times for day tours, validity range |
| `departure` | tour, start date, end date, capacity, status — explicit scheduled departures (and materialised weekly ones) |
| `time_slot` (or `slot_instance`) | tour, date, start time, capacity |
| `availability_block` | tenant/guide resource, from, to, reason (day off, private tour, away guiding, manual closure) |
| `booking` | tenant, reference (unique per tenant), tour, kind snapshot, start date, end date, slot time, back-up date, adults, children, lead name, email, phone (cc + number), language, pickup, contact method, notes, status, hold_expires_at, unit price, base, discount source/type/value/amount + source record id, total, currency, terms accepted at, created/updated |
| `booking_hold` (or status + expiry on `booking`) | bookable unit, expires at |
| `waitlist_entry` | tenant, tour, date (and slot), email/contact, created |
| `campaign` | tenant, name, blurb, code, type, value, start, end, visibility, min_guests, min_children, book_ahead_days, active, uses |
| `campaign_tour` | campaign, tour (or an `all_tours` flag) |
| `campaign_assignee` | campaign, email |
| `personal_discount` | tenant, customer name, email, source booking, tour or any, type, value, expiry, note, created by, created at, used_by_booking |
| `discount_request` | tenant, public id (`DR-n`), name, email, phone, tour, booking (nullable), guests, type, value, reason, status, created at, decision type/value/note/reason, decided by, decided at, notified, used_by_booking |
| `promo_settings` | tenant, requests_enabled, max_request_pct, notify channels, response_days, stacking (`best`) |
| `audit_log` | tenant, at, actor, kind, message, related entity |
| `review` | tenant, tour, booking (verified), author name, country, date, rating, text |
| `wishlist_item` (optional) | visitor/customer, tour — the "Save" action has no persistence in the design |
