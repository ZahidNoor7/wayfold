# 05 — Mobile flows and design-system inventory

Source: `design-reference/*.dc.html` (19 screens, plus 14 `Phone*.dc.html` phone-width copies) and `design-reference/canvas.json`.
Scope: Part A documents the five dedicated 390 px mobile flows (`MHome`, `MExperiences`, `MTour`, `MBooking`, `MAdmin`). Part B is a design-system inventory across all 19 screens.

How to read this document:

- **Observed** means the fact is literally present in the markup or script of the design files.
- **Inferred** means it is a reconstruction of the shared stylesheet (`/_blob/70d0ec09cb9bf09f570d988b94190c96`, linked by all 19 files) and the runtime (`./support.js`), neither of which was exported. Inferred values are best guesses from usage and must be confirmed against a rendered reference before being treated as final.
- Counts are occurrences across all 19 files. "markup" counts are class attributes inside `<x-dc>`; "script" counts are class strings built in `renderVals()`.
- Sample content (names, prices, dates, copy) belongs to the single demo tenant "Aurelia Journeys" and is tenant data in Wayfold, not product chrome.

External facts checked while writing (everything else is derived from the design files only):

| Claim | Source |
| --- | --- |
| shadcn/ui component names cited in B.4 exist as `registry:ui` items in `@shadcn` | shadcn MCP registry listing (names only — APIs, props and styles were **not** checked) |
| `delay-<number>` → `transition-delay: <number>ms`; `animate-spin` / `animate-pulse` definitions; custom animations via `--animate-*` in `@theme` | tailwindcss.com docs, v4.3 ("transition-delay" and "animation" pages), fetched directly because no Tailwind MCP server is configured |
| Next.js App Router specifics | none asserted in this document; nothing was verified |

---

## Part A — Mobile flows

### A.0 What the mobile flows are

`canvas.json` groups the artboards into five pages: Public website, Admin dashboard, **Mobile app flows**, Phone previews — website, Phone previews — admin. The five `M*.dc.html` files are the "Mobile app flows" page: hand-designed, app-like 390 px screens, each on an artboard with a 28 px corner radius (device frame).

Two canvas notes define the intent (quoted as design documentation):

- "Use the States tweaks to show the open menu, filter sheet, booking sheet or appearance sheet. The desktop pages are also fully responsive and adapt down to phone width."
- "On phones and tablets the admin sidebar becomes a top bar with a slide-out menu (tap ☰). Tables turn into stacked cards; side panels open full-screen; sticky action bars keep primary buttons in thumb reach."

`canvas.json` also lists 14 `Phone*.dc.html` artboards ("the real responsive pages rendered in a 390 px frame — generated from the same code as the desktop pages"). Those files are now in `design-reference/` too. Each is the desktop page's code unchanged except for its `<title>` (prefixed "Phone —") and its internal links (pointing at the other `Phone*` pages), so the responsive behaviour described in A.7 applies to them as written. So there are two distinct mobile concepts: the dedicated `M*` flows (documented here) and the responsive behaviour of the desktop pages (compared in A.7).

### A.1 Shared mobile shell

Every `M*` screen has the same root:

```html
<div data-theme="{{uiTheme}}" data-font="{{uiFont}}" data-radius="{{uiRadius}}"
     class="{{uiDark}} relative overflow-x-clip min-h-[Npx] w-[390px] overflow-x-hidden
            bg-background font-sans text-foreground antialiased">
```

| Screen | `min-h` | Extra root classes | `$preview` size |
| --- | --- | --- | --- |
| MHome | 4300px | — | 390 × 4300 |
| MExperiences | 2300px | — | 390 × 2300 |
| MTour | 2700px | — | 390 × 2700 |
| MBooking | 1300px | `flex flex-col` | 390 × 1400 |
| MAdmin | 1500px | `flex flex-col`, `bg-muted/40` instead of `bg-background` | 390 × 1500 |

- `{{uiDark}}` resolves to the class `dark` or `light` (see B.3).
- Width is hard-coded to 390 px and `min-h` equals the artboard height; both are artboard artefacts. A real implementation should use full viewport width and `min-h-dvh`-style sizing, not these literals.
- `flex flex-col` on MBooking/MAdmin lets the content area be `flex-1` so the sticky bottom bar sits at the bottom even with short content.

Shared mobile patterns (observed):

| Pattern | Classes | Used in |
| --- | --- | --- |
| Bottom tab bar | `sticky bottom-0 z-40` (z-30 on MExperiences/MAdmin) `grid grid-cols-4 border-t bg-background/95 pb-5 pt-2 backdrop-blur` | MHome, MExperiences, MAdmin |
| Tab item | `flex flex-col items-center gap-1 py-1 text-[11px] font-semibold text-muted-foreground aria-[current=page]:text-primary`; icon `svg.size-5`, stroke 1.8 | same |
| Sticky bottom action bar | `sticky bottom-0 z-30` (z-20 MBooking) `flex items-center justify-between gap-3 border-t bg-background/95 px-5 pb-7 pt-3 backdrop-blur` | MTour, MBooking |
| Bottom-sheet scrim | `fixed inset-0 z-50 animate-fade-in bg-black/60`, click closes | MExperiences, MTour, MAdmin |
| Bottom sheet | `fixed inset-x-0 bottom-0 z-50 flex animate-sheet-bottom flex-col rounded-t-2xl border-t bg-background` + `pb-7` (auto height) or `h-[560px]` (filter sheet); `role="dialog" aria-modal="true" aria-label` | same |
| Sheet grabber | `mx-auto mt-3 h-1.5 w-12 rounded-full bg-muted` (decorative; no drag behaviour is scripted) | same |
| Sticky app bar | `sticky top-0 z-40/z-30 border-b bg-background/95 backdrop-blur`, row `h-14` (MExperiences, MBooking) or `h-16` (MHome, MAdmin) | all but MTour |
| Horizontal chip rail | `no-scrollbar flex gap-2 overflow-x-auto px-5` (or `-mx-5 px-5` / `-mx-4 px-4` to bleed to the screen edge) | MHome, MExperiences, MTour, MAdmin |
| Snap carousel | `no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-5 px-5`; children `shrink-0 snap-start` (cards) or `snap-center` (full-bleed gallery) | MHome, MTour |
| Toast | `<div role="status" class="toast w-max max-w-[340px]">`, auto-dismiss 2600 ms | MTour, MAdmin |

Safe-area handling (observed): the mobile flows do **not** use `env(safe-area-inset-*)`. The home-indicator area is approximated with fixed bottom padding: `pb-5` (20 px) on the tab bar, `pb-7` (28 px) on sticky action bars and sheets, `p-4 pb-7` on the filter-sheet footer. There is no top inset handling (headers start at `top-0`). The desktop pages instead use a shared class `safe-b` on their mobile sticky bars (3 uses: TourDetail ×2, Booking ×1) — inferred to be `padding-bottom: max(<base>, env(safe-area-inset-bottom))`. Recommendation for the port: use one safe-area-aware utility for all bottom bars and sheets instead of the fixed `pb-5`/`pb-7`.

Touch-target sizes (observed where a utility sets them, otherwise inferred from the missing `.btn` CSS):

| Element | Size | Basis |
| --- | --- | --- |
| Chips | 36 px high (`h-9 px-3.5 text-[13px]`) | observed |
| Sort radio rows (filter sheet) | 48 px (`h-12`) | observed |
| "Contact me by" radio buttons | 44 px (`h-11`) | observed |
| Departure radio rows | `p-3` + two text lines ≈ 60 px | observed |
| Tab-bar items | 390/4 = 97.5 px wide; ≈ 48 px tall (20 px icon + 11 px label + `gap-1` + `py-1`) plus bar `pt-2 pb-5` | observed |
| App-bar rows | 56 px (`h-14`) / 64 px (`h-16`) | observed |
| `.btn-icon` (back, close, share, steppers) | ≈ 40 px square | inferred |
| `.btn-icon-lg` (filter button, review prev/next) | ≈ 44–48 px square | inferred |
| `.btn-lg` / `.btn-xl` CTAs | ≈ 44–48 px / ≈ 52–56 px high | inferred |
| Switch | ≈ 24 × 44 px | inferred |
| Checkbox | 20 px (`h-5 w-5`) inside a full-width padded `label` (`p-4`) that is the real target | observed |

Chips at 36 px are below the 44 px guideline; they rely on `gap-2` spacing. Flag for review during implementation.

"States" tweak props (design-tool props in the `data-props` attribute; each is mirrored into component state in the constructor and re-synced in `componentDidUpdate`):

| Screen | Prop | Type / default | Effect |
| --- | --- | --- | --- |
| MHome | `menuOpen` | boolean / false | Full-screen menu overlay open |
| MExperiences | `sheetOpen` | boolean / false | Filter sheet open |
| MTour | `bookingSheet` | boolean / false | "Choose your departure" sheet open |
| MBooking | `simulateConflict` | boolean / false | On submit, simulate a last-second double-booking |
| MAdmin | `startTab` | enum `home` \| `bookings` \| `content` / `home` | Initial tab |
| MAdmin | `appearanceSheet` | boolean / false | Appearance sheet open |
| all | `theme` | enum `admin` \| `emerald` \| `caspian` \| `pomegranate` \| `graphite` / `admin` | Per-artboard theme override (`admin` = follow saved setting) |
| all | `mode` | enum `admin` \| `light` \| `dark` \| `system` / `admin` | Per-artboard colour-scheme override |

In production these become real UI state (open/closed) and, for `simulateConflict`, a server response (HTTP 409-style conflict).

Animation use on mobile (class semantics in B.4):

| Class | Where on mobile |
| --- | --- |
| `animate-hero-zoom` | MHome hero image |
| `animate-rise` + `delay-1..4` | MHome hero text stack (eyebrow, h1, paragraph, CTAs in that order); MExperiences list cards; each MBooking step container; MAdmin pending cards |
| `animate-fade-in` | sheet scrims; MHome menu overlay; MHome accordion answers; MTour tab panels and itinerary panels; MAdmin tab panels |
| `animate-sheet-bottom` | all three bottom sheets |
| `animate-menu-item` + inline `animation-delay` `.04s … .24s` (step .04 s) | MHome menu links |
| `animate-pop` | MBooking success check circle |
| `animate-spin` | MBooking submit spinner |
| `transition-all duration-500` | MBooking progress-bar fill |
| `transition-colors duration-300` | MHome header transparent → solid |

No exit animations are defined: sheets, scrims and the menu are removed from the DOM immediately on close (`<sc-if>`).

---

### A.2 MHome — "Mobile — Home"

**Purpose.** Marketing landing page of one tour-guide business in an app-like shell: hero, proof stats, featured tours, guide profile, destinations, reasons, reviews, final CTA, footer, bottom tab bar, and a full-screen menu.

**State.** `cat:'All'` (featured filter), `idx:0` (review index), `why:0` (open accordion index, `-1` = none), `menu` (overlay), `scrolled` (window `scrollY > 40`).

**Layout, top to bottom**

1. **Header** — `sticky top-0 z-40 flex h-16 items-center justify-between px-5 transition-colors duration-300` plus
   - transparent state (at top, menu closed): `bg-transparent`; logo `text-hero-foreground`; menu button `btn-hero-outline`.
   - solid state (`scrolled || menu`): `border-b bg-background/95 backdrop-blur`; logo `text-primary`; menu button `btn-outline`.
   - Left: wordmark link — "Aurelia" `font-display text-[22px] font-semibold leading-none` + "Journeys" `text-[9px] font-semibold uppercase tracking-[0.3em] text-highlight`.
   - Right: `Book` (`btn btn-highlight btn-sm rounded-full` → MBooking) and menu button (`btn btn-icon rounded-full`, `aria-label="Open menu"`, `aria-expanded`; three-line icon with a shorter third line).
2. **Hero** — `relative -mt-16 flex h-[640px] items-end overflow-hidden bg-hero`. The `-mt-16` slides the hero under the 64 px sticky header.
   - Image `absolute inset-0 h-full w-full animate-hero-zoom object-cover`.
   - Scrim `absolute inset-0 bg-gradient-to-b from-hero/60 via-hero/10 to-hero/95`.
   - Content `relative w-full px-5 pb-10`: kicker `text-[11px] font-semibold uppercase tracking-[0.26em] text-highlight` ("Private journeys · Azerbaijan"); `h1` `font-display text-[46px] font-medium leading-[0.98] text-hero-foreground` with an `<em class="text-highlight">` second clause; paragraph `text-[15px] leading-relaxed text-hero-foreground/85`; CTAs `flex flex-col gap-3`: "Explore Experiences" (`btn btn-highlight btn-xl rounded-full`) and "Book Your Private Tour" (`btn btn-hero-outline btn-xl rounded-full`).
   - Entry animation: the four blocks use `animate-rise` with `delay-1` … `delay-4`.
3. **Stats band** — `grid grid-cols-2 gap-y-5 bg-primary px-5 py-7 text-primary-foreground`; value `font-display text-3xl text-highlight`, label `text-xs opacity-80`. Four stats: guests guided, tours completed, places explored, rating + review count.
4. **Featured experiences** — `py-14`. Heading block `px-5`: `.eyebrow mb-3` + `h2` `font-display text-[34px] font-medium leading-tight text-primary`.
   - Category chip rail (`role="group" aria-label="Filter by category"`): `chip h-9 shrink-0 px-3.5 text-[13px]`, `aria-pressed`. Options: All, Cultural, Historical, Adventure, Food & Local, Family.
   - Snap carousel of cards: `card flex w-[300px] shrink-0 snap-start flex-col overflow-hidden`; image `relative h-48` with `badge badge-overlay absolute left-3 top-3` (category); body `flex flex-1 flex-col gap-1.5 p-4`: meta row `text-xs text-muted-foreground` ("place · duration" / "★ rating"), title `font-display text-2xl font-semibold leading-tight text-primary`, price line `mt-auto pt-2 text-[13px]` with `strong.font-display.text-xl.text-primary`.
   - Pager dots: three static spans (`h-1.5 w-5 rounded-full bg-primary` then two `h-1.5 w-1.5 rounded-full bg-muted-foreground/40`), `aria-hidden`. They are decorative and **not wired** to scroll position.
   - "View all 9 experiences" — `btn btn-outline btn-lg w-full rounded-full`.
   - Rule: `All` shows the first 3 tours; any other category shows every tour of that category (carousel may hold 1 card).
5. **Your guide** — `bg-secondary/60 px-5 py-14`. Portrait placeholder `relative mb-10 overflow-hidden rounded-2xl bg-hero` (image `h-72 … opacity-50`, centred monogram `h-24 w-24 rounded-full border border-highlight font-display text-4xl text-highlight`, label "Portrait"); floating stat `absolute bottom-4 right-4 rounded-lg bg-primary px-4 py-3` ("12 years guiding"). Then `.eyebrow`, `h2` `font-display text-[40px] font-medium leading-none text-primary`, subtitle `font-display text-lg italic text-eyebrow`, body `text-[15px] leading-relaxed text-foreground/85`, language tags `badge badge-outline px-3 py-1`, CTA `btn btn-default btn-lg w-full rounded-full` ("Discover My Story" → About).
6. **Popular destinations** — `py-14`; snap carousel (`gap-3`) of `relative block h-96 w-[280px] shrink-0 snap-start overflow-hidden rounded-xl text-hero-foreground` tiles: image, `bg-gradient-to-b from-transparent via-transparent to-hero/90`, caption `absolute inset-x-5 bottom-5` (region kicker `text-[10px] … tracking-[0.22em] text-highlight`, name `font-display text-3xl`, line `text-[13px] opacity-90`).
7. **Why travel with me** — `bg-hero px-5 py-14 text-hero-foreground`; `.eyebrow !text-highlight`; accordion in `divide-y divide-highlight/25 border-y border-highlight/25`. Trigger: `accordion-trigger !py-4 text-left font-display text-xl font-medium hover:no-underline`, chevron `svg.!text-highlight`, `aria-expanded`. Panel: `animate-fade-in pb-4 text-sm leading-relaxed text-hero-foreground/75`. Single-open: tapping the open item closes it; first item open by default. Six items.
8. **Guest stories** — `bg-secondary/60 px-5 py-14 text-center`; stars `text-lg tracking-[3px] text-highlight` (`aria-label="5 out of 5 stars"`); `blockquote` `font-display text-[26px] italic leading-snug`; author row with `.avatar`; pager: prev/next `btn btn-outline btn-icon-lg rounded-full` (text arrows) around "`1 / 3`". Wraps around; no auto-advance, no swipe.
9. **Final CTA** — `relative overflow-hidden bg-hero px-5 py-20 text-center text-hero-foreground` with background image `opacity-55`; `h2` 40 px; two stacked `btn-xl` CTAs ("Book Your Tour", "WhatsApp Leyla" → `https://wa.me/…`).
10. **Footer** — `bg-hero px-5 pb-28 pt-10 text-[13px] text-hero-foreground/75`: wordmark, contact line, wrap of links (About, Reviews, Contact, Privacy, Terms), copyright with `border-t border-hero-foreground/15`.
11. **Bottom tab bar** (`aria-label="App"`): Home (current), Explore → MExperiences, Journey → `Journey.dc.html` (the responsive desktop page; there is no `MJourney`), Book → MBooking.

**Open-menu state** (`menuOpen`)

- Container: `absolute inset-0 z-50 flex animate-fade-in flex-col bg-hero px-6 pb-10 pt-5 text-hero-foreground`. It is `absolute` relative to the 390 px artboard (so it spans the whole 4300 px page in the design); implement as a fixed, viewport-height overlay with scroll lock.
- Top row `mb-10 flex items-center justify-between`: wordmark `font-display text-2xl` and close button `btn btn-icon btn-hero-outline rounded-full` ("✕", `aria-label="Close menu"`).
- Links (`nav aria-label="Mobile"`, `flex flex-col`): each `animate-menu-item border-b border-hero-foreground/15 py-3 font-display text-4xl`, staggered by inline `animation-delay` .04 s → .24 s. Current page (Home) adds `text-highlight`. Items: Home, About Me, Experiences, My Journey, Reviews, Contact. (The desktop menu has a seventh, "Special offers"; it is missing here.)
- Footer `mt-10 flex flex-col gap-3`: "Book a Tour" (`btn-highlight btn-xl`), "Chat on WhatsApp" (`btn-hero-outline btn-xl`).
- Opening the menu also forces the header into its solid state.

**Interactions summary.** Scroll > 40 px → solid header; chip → filter carousel; accordion toggle; review prev/next; menu open/close. No form, no validation.

---

### A.3 MExperiences — "Mobile — Experiences + filter sheet"

**Purpose.** Searchable, filterable catalogue of tours with live promotional pricing.

**State.** `q:''`, `cat:'All'`, `dur:'any'`, `price:'any'`, `sort:'pop'`, `sheet`.

**Layout**

1. **Sticky header** (`sticky top-0 z-40 border-b bg-background/95 backdrop-blur`), three rows:
   - App bar `flex h-14 items-center justify-between px-4`: back (`btn btn-ghost btn-icon rounded-full`, "←", → MHome), title `font-semibold`, WhatsApp icon link (`btn btn-ghost btn-icon rounded-full`).
   - Search row `flex gap-2 px-4 pb-3`: `label.relative.flex-1` with `sr-only` text, search icon `pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground`, `input.input.rounded-full.pl-9[type=search]` (placeholder "Search Baku, Sheki, wine…"); filter button `btn btn-outline btn-icon-lg relative shrink-0 rounded-full` (`aria-label="Filters"`) with a counter dot `absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground` shown only when the count > 0.
   - Category chip rail (`role="group" aria-label="Category"`, `px-4 pb-3`): All, Cultural, Historical, Adventure, Food & Local, Family, Private.
2. **Result meta** — `flex items-center justify-between px-4 py-4`: "**N** experience(s)" (`aria-live="polite"`, singular/plural handled) and the current sort label `text-[13px] font-semibold text-muted-foreground`.
3. **List** — `flex flex-col gap-5 px-4 pb-28`. Card: `a.card.animate-rise.overflow-hidden`:
   - Image `relative h-52`; `badge badge-overlay absolute left-3 top-3` (category); when a public unconditional offer applies, `badge badge-highlight absolute right-3 top-3 text-sm` (e.g. "−15%" or "$300 off per booking").
   - Body `p-4`: meta row `text-xs text-muted-foreground` ("place · duration" / "★ 4.9 (71)"); `h2` `font-display text-[26px] font-semibold leading-tight text-primary`; description `line-clamp-2 text-sm text-muted-foreground`; footer `mt-3 flex items-center justify-between border-t pt-3`: "from ~~$690~~ **$586** / person" and "Details →" `text-sm font-semibold text-eyebrow`.
4. **Empty state** — `card border-dashed p-10 text-center`: "No matches" (`font-display text-2xl text-primary`), "Try fewer filters, or ask for a custom trip.", `Clear filters` (`btn btn-outline rounded-full`).
5. **Bottom tab bar** — Explore is current.

**Filter sheet** (`sheetOpen` / filter button)

- Scrim + sheet as in A.1; sheet has fixed height `h-[560px]`.
- Header `flex items-center justify-between px-5 pb-2 pt-3`: `h2` "Filters" (`text-lg font-bold`) and `Reset` (`btn btn-ghost btn-sm`).
- Scroll body `flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-2`, three `fieldset`s with `legend.label.mb-3`:
  - **Duration** — chips: Any, Up to 1 day, 2–3 days, 4+ days.
  - **Budget per person** — chips: Any, Under $300, $300–1,000, $1,000+.
  - **Sort by** — `flex flex-col divide-y rounded-lg border` of `button[role=radio]` rows `flex h-12 items-center justify-between px-4 text-sm font-medium aria-checked:font-bold aria-checked:text-primary`, selected row shows "✓". Options: Most popular, Highest rated, Price: low to high, Price: high to low.
- Footer `border-t p-4 pb-7`: `Show N experience(s)` — `btn btn-default btn-xl w-full rounded-full`; closes the sheet.

**Rules**

- Filters apply live behind the sheet (no draft/apply step); the CTA count updates as you tap.
- Search matches `title + place`, case-insensitive, trimmed.
- Duration buckets: day ≤ 1 day; short > 1 and ≤ 3; long > 3. Price buckets: `< 300`; `300–1000` inclusive; `> 1000`.
- Filter counter = number of non-default values among duration, price, sort (category and search text are not counted).
- `Reset` / `Clear filters` reset **all five** values, including search text and category.
- Price display (`listPrice`): best active public campaign with no guest-count conditions. Percent offer → strike-through original + reduced price + "−N%" badge. Fixed offer → price unchanged, badge "$N off per booking", no strike-through. Promotions are read from `localStorage` key `aj-promo` (see B.3) so admin changes show up live.

---

### A.4 MTour — "Mobile — Tour detail + booking sheet"

**Purpose.** Tour detail for one departure-based tour ("Silk Road to Sheki") with a swipeable gallery, tabbed content and a booking bottom sheet.

**State.** `tab:'ov'`, `open:{0:true}` (itinerary days), `gal:0`, `book`, `dep:'2027-04-17'`, `fullPick:''`, `wl:{}` (waitlist), `adults:2`, `saved:false`, `toast:''`.

**Layout**

1. **Gallery** (no app bar) — `no-scrollbar flex h-[420px] snap-x snap-mandatory overflow-x-auto`; slides `h-full w-[390px] shrink-0 snap-center object-cover`. `onScroll` computes `index = round(scrollLeft / 390)` to drive the counter (use the container width, not 390, in production).
   - Top scrim `pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/40 to-transparent`.
   - Floating controls `absolute inset-x-4 top-4 flex justify-between`: back, share, save — each `btn btn-icon rounded-full bg-background/95 shadow`. Save has `aria-pressed` and toggles the heart's SVG `fill` between `none` and `currentColor`.
   - Counter `badge absolute bottom-8 right-4 border-transparent bg-black/60 text-white` ("1 / 4").
2. **Content panel** — `relative -mt-5 rounded-t-2xl bg-background px-5 pt-6` (overlaps the gallery by 20 px with rounded top corners).
   - Tags: `badge badge-default` "Featured", `badge badge-outline` category.
   - `h1` `font-display text-[38px] font-medium leading-none text-primary`.
   - Meta `text-sm text-muted-foreground` (rating bold in `text-foreground`).
   - Facts rail `no-scrollbar -mx-5 mt-5 flex gap-2 overflow-x-auto px-5` of `badge badge-secondary shrink-0 px-3 py-1.5 text-[13px]`.
   - Host card `my-6 flex items-center gap-3 rounded-xl border p-3`: `avatar h-12 w-12`, two text lines, WhatsApp `btn btn-outline btn-icon rounded-full`.
   - Tabs `tabs-list sticky top-0 z-20 mb-6 grid w-full grid-cols-3` (`role="tablist"`), three `tabs-trigger` buttons (`role="tab"`, `aria-selected`): Overview, Itinerary, Reviews. The tab strip sticks to the top of the viewport while scrolling.
3. **Overview panel** (`animate-fade-in`): intro paragraph `text-[15px] leading-relaxed text-foreground/85`; "Highlights" (`h2` `font-display text-2xl font-medium text-primary`) list with `h-5 w-5 rounded-full bg-primary text-[10px] text-primary-foreground` check bullets; "Included" (✓ items); "Not included" (✕ items, `text-muted-foreground`); note `alert mt-7 bg-secondary/60 text-[13px] leading-relaxed`.
4. **Itinerary panel**: `ol` of `li.border-b`; trigger `accordion-trigger` with `.eyebrow` "Day n" + title `font-display text-xl font-medium text-primary` + chevron; panel `animate-fade-in pb-4` (text + `text-xs text-muted-foreground` meta). Multi-open; day 1 open by default.
5. **Reviews panel**: summary `flex items-center gap-4 rounded-xl bg-secondary/60 p-4` (score `font-display text-5xl text-primary`, stars `tracking-[2px] text-highlight`, count); review `article.card.p-4` (avatar `h-9 w-9 text-xs`, name, "country · date", text); `See all reviews` `btn btn-outline btn-lg rounded-full`.
6. Spacer `h-32`.
7. **Sticky action bar** — left: "From" + `badge badge-highlight ml-1` (offer), then ~~original~~ `text-sm text-muted-foreground line-through` + price `font-display text-[26px] font-semibold text-primary` + "/ adult"; right: `Check dates` (`btn btn-default btn-lg rounded-full px-7`). This screen has no tab bar.

**Booking sheet** (`bookingSheet` / "Check dates"; `aria-label="Choose date and guests"`)

- Auto-height sheet with `pb-7`; grabber; header "Choose your departure" + close `btn btn-ghost btn-icon` ("✕").
- Departure list `role="radiogroup" aria-label="Departure date"`, `flex max-h-72 flex-col gap-2 overflow-y-auto px-5 py-4`. Each row is `button[role=radio][aria-checked][aria-disabled]`:
  - default: `flex items-center justify-between rounded-lg border-2 border-border p-3 text-left`
  - selected: `… border-2 border-primary bg-accent …`
  - sold out: `… border-2 border-dashed bg-muted/50 … text-muted-foreground line-through decoration-destructive/50`
  - Left: label `text-sm font-bold` ("Sat, 17 Apr 2027 – 19 Apr 2027") and note: "N of 8 seats left" (`text-xs text-emerald-700 dark:text-emerald-400`), "Only N seats left" when ≤ 3 (`text-xs font-semibold text-amber-700 dark:text-amber-400`), "Fully booked" (`text-xs text-muted-foreground`).
  - Right: price `text-sm font-semibold` or `badge badge-cancelled` "Sold out".
- Tapping a sold-out row does not select it; it shows `p[role=status]` `mx-5 -mt-2 mb-3 rounded-md bg-muted p-2.5 text-[13px]`: "{date} is sold out." + inline link button `font-semibold text-primary underline underline-offset-4` "Join waitlist" → "✓ On the waitlist" and toast "Added to the waitlist".
- Seat warning `p.field-error.mx-5.mb-3[role=alert]`: "Only N seats left on this departure." when adults exceed remaining seats. (Warning only — the CTA is not disabled.)
- Adults stepper row `flex items-center justify-between border-y px-5 py-3`: label + "$690 each"; `−` / `+` are `btn btn-outline btn-icon rounded-full` with `aria-label`; value `w-5 text-center font-bold` with `aria-live="polite"`. Range 1–8. No children stepper here.
- Discount line (when a discount applies) `flex justify-between px-5 pt-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400`: label and "−$amount".
- Total row `flex items-center justify-between px-5 py-4`: "Estimated total" + `font-display text-2xl font-semibold text-primary`.
- CTA `Continue to request` (`btn btn-default btn-xl w-full rounded-full` → MBooking) and footnote `mt-2 text-center text-xs text-muted-foreground` "No payment now · Leyla confirms within 24 h".
- The selected departure and guest count are **not** passed to MBooking in the prototype (plain link); the real flow must carry them.

**Toasts** (2600 ms): "Saved to wishlist" / "Removed from wishlist", "Link copied" (share is a stub), "Added to the waitlist".

**Availability model used by the samples** (shared helper `dayInfo`): statuses `open`, `limited` (≤ 3 seats left on a departure), `full`, `hold` (private tours only), `closed`, `past`. Capacity 8 per departure. The prototype's "today" is fixed (dates before 2026-11-16 are `past`).

---

### A.5 MBooking — "Mobile — Booking request"

**Purpose.** Three-step booking **request** (not payment) for a pre-selected tour, plus a confirmation screen.

**State** (`fresh()`): `step:1`, `loading`, `touched:{}`, `ref`, `fullPick`, `wl`, `extraFull`, `conflict`, and form `f = { date:'2027-04-17', alt:'', adults:2, kids:0, name:'', email:'', cc:'+44', phone:'', lang:'English', pickup:'', method:'WhatsApp', notes:'', agree:false }`.

**Chrome**

- Header `sticky top-0 z-30 border-b bg-background/95 backdrop-blur`:
  - Row `flex h-14 items-center justify-between px-4`: Back (`btn btn-ghost btn-icon rounded-full`, "←") goes to the previous step (no-op on step 1 and on the confirmation), title "Request booking" (or "Confirmation"), Close ("✕" → MHome).
  - Progress (hidden on confirmation) `px-4 pb-3`: caption `flex justify-between text-xs text-muted-foreground` ("Step n of 3" / step name) and `div.progress.h-1.5` containing `div.h-full.rounded-full.bg-primary.transition-all.duration-500` with inline `width` 33.3% / 66.7% / 100%.
- Body: `form[novalidate].flex.flex-1.flex-col` → `div.flex-1.px-5.py-6`. Each step wrapper is `flex animate-rise flex-col gap-5` (`gap-4` on step 3), so each step change replays the rise animation.
- Sticky action bar (steps 1–3): left "N adults · est." (`text-xs text-muted-foreground`) + total `font-display text-2xl font-semibold text-primary`; right CTA `btn btn-default btn-lg rounded-full px-7` — "Continue", "Continue", "Send request"; while submitting: `disabled`, spinner `svg.animate-spin`, label "Sending…".
- No bottom tab bar on this screen.

**Step 1 — "Date & guests"**

- Tour summary `flex gap-3 rounded-xl border p-3`: thumbnail `h-16 w-20 shrink-0 rounded-lg object-cover`, title `font-display text-xl font-semibold leading-tight text-primary`, meta `text-xs text-muted-foreground`.
- `fieldset` + `legend.label.mb-3` "Departure": `role="radiogroup"` list of rows with the same three visual states as MTour plus `text-sm`. Label "17 Apr 2027 – 19 Apr 2027" (no weekday); note "N of 8 left" (emerald), "N left" (`text-xs font-bold text-amber-700 dark:text-amber-400`), "Fully booked" (`text-xs font-bold text-destructive no-underline`).
- Legend row `mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground`: "● Available" (emerald), "● Few seats left" (amber), "● Fully booked" (`text-destructive`).
- Sold-out tap → `div.alert.alert-destructive.mt-3.text-[13px][role=alert]`: "**{Sat, 12 Dec 2026} is fully booked (8 of 8 seats).**" / "Next available: {date}" / buttons `Choose it` (`btn btn-default btn-sm`, selects the next available date) and `Join waitlist` (`btn btn-outline btn-sm bg-background text-foreground`, becomes "✓ On waitlist").
- Guests `flex flex-col divide-y rounded-lg border`, two rows `flex items-center justify-between p-3`: Adults (1–8) and Children ("Under 12 · half price", 0–6) with `−`/`+` `btn btn-outline btn-icon rounded-full`.
- Conflict alert (after a simulated conflict): `alert alert-destructive text-[13px]`: "**Sorry — {date} was just booked by another guest.**" / "Your selection was released to avoid a double booking. Please choose another departure."

**Step 2 — "Your details"** (each field is `label.flex.flex-col.gap-2` with `span.label`)

| Field | Control | Notes |
| --- | --- | --- |
| Full name | `input.input`, `autocomplete="name"`, `aria-invalid` | required |
| Email | `input.input[type=email][inputmode=email][autocomplete=email]`, `aria-invalid` | required |
| Phone | `select.select.w-28.shrink-0` (country code, `aria-label="Country code"`; +44 default, +1, +994, +971, +90, with flag emoji) + `input.input[type=tel][inputmode=tel]`, `aria-invalid`, `aria-labelledby` | required |
| Preferred language | `select.select`: English, Azerbaijani, Russian, Turkish | |
| Pickup location | `input.input`, placeholder "e.g. Four Seasons, Baku" | "(optional)" suffix `font-normal text-muted-foreground` |
| Contact me by | `role="radiogroup"` `grid grid-cols-3 gap-2` of `button[role=radio]` `h-11 rounded-lg border-2 border-border text-sm font-semibold aria-checked:border-primary aria-checked:bg-accent`: WhatsApp (default), Email, Call | |
| Special requests | `textarea.textarea[rows=3]`, placeholder "Dietary needs, celebrations, mobility…" | optional |

**Step 3 — "Review"**

- Summary `card divide-y`; rows `flex justify-between gap-4 px-4 py-3 text-sm` (`text-muted-foreground` key, `text-right font-semibold` value): Tour, Departure, Travellers ("2 adults, 0 children"), Lead traveller, Email, Phone, Contact via.
- Total panel `rounded-xl bg-hero p-4 text-hero-foreground`: optional discount row (label + "−$amount" in `text-highlight`), "Estimated total" with optional struck base `text-sm line-through opacity-60` and total `font-display text-3xl text-highlight`, optional note `text-[11px] opacity-75` "One discount per booking — best offer applied."
- Consent `label.flex.cursor-pointer.items-start.gap-3.rounded-lg.bg-secondary/60.p-4.text-sm.leading-relaxed` with `input.checkbox.mt-0.5.h-5.w-5[type=checkbox]`: "I understand this is a **booking request**, confirmed personally by Leyla."

**Validation** — computed on every render, displayed only for fields marked `touched`; a step's fields become touched when the user presses the CTA on that step. If any field of the current step is invalid, the step does not advance. Error element: `span.field-error[role=alert]`; inputs get `aria-invalid="true"`.

| Step | Field | Rule | Error copy |
| --- | --- | --- | --- |
| 1 | date | a date is selected and its status is `open` or `limited` | "Choose an available departure." |
| 1 | seats | `adults + kids ≤ seats left` | "Only N seats left on this departure — reduce your group or choose another." |
| 2 | name | trimmed length ≥ 2 | "Please enter your full name." |
| 2 | email | `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` | "Enter a valid email." |
| 2 | phone | ≥ 7 digits after stripping non-digits | "At least 7 digits, please." |
| 3 | agree | checkbox ticked | "Please confirm to continue." |

Errors are shown inline only; there is no error summary and no focus management in the prototype (add focus-to-first-error in the port).

**Pricing.** `quote(tour, adults, kids, {date, email})`: base = adults × price + kids × price ÷ 2. Exactly one discount applies — the largest among eligible public/private campaigns, personal discounts and approved discount requests (the latter two matched by the email typed in step 2, so the total can change after the email is entered).

**Submit.** Step 3 CTA → `loading` for 1300 ms → confirmation with reference `AJ-SHE-` + 4 random digits. With `simulateConflict`: return to step 1, mark the date sold out, clear the selected date and `touched`, show the conflict alert.

**Confirmation** (`flex flex-col items-center pt-8 text-center`): check circle `inline-flex h-20 w-20 animate-pop items-center justify-center rounded-full bg-primary text-highlight` (`svg.size-9`); `h1[role=status]` "Request sent!" `font-display text-4xl font-medium text-primary`; "Leyla will confirm availability by {WhatsApp|Email|Call} within 24 hours."; `card mt-7 w-full p-5` with "Booking reference", the reference `font-display text-3xl tracking-wider text-primary`, and `badge badge-pending mt-2` "Pending confirmation"; "Message Leyla on WhatsApp" (`btn btn-default btn-xl mt-6 w-full rounded-full`); "Back to home" (`btn btn-ghost btn-lg mt-2 w-full`).

Not present on mobile (present on desktop Booking): tour picker, month calendar with per-day status, time-slot selection, the `simulateError` (submit failure) and `simulateTamper` states. The helper `calCells()` is included in the MBooking script but unused there.

---

### A.6 MAdmin — "Mobile — Admin + appearance sheet"

**Purpose.** A condensed owner "companion app": triage pending requests, scan bookings, publish/unpublish packages, change the site appearance.

**State.** `tab` (`home` | `bookings` | `content`), `theme` (appearance sheet open), `filter:'All'`, `toast`, `items` (7 sample bookings), `pub` (publish flags).

**Layout**

1. **Header** — `sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur`. Left: `avatar h-9 w-9 text-xs` + "Aurelia Admin" (`font-display text-lg font-semibold text-primary`) with the current tab title (`text-[11px] text-muted-foreground`). Right (`flex gap-1`): colour-scheme toggle (`btn btn-ghost btn-icon rounded-full`; sun icon when dark, moon when light; `aria-label` "Switch to light mode"/"Switch to dark mode") and Appearance button (palette icon).
2. **Main** — `flex-1 p-4`; each tab panel is wrapped in `animate-fade-in`.
3. **Bottom nav** (`aria-label="Admin"`, same bar classes, z-30): four `button`s — Overview, Bookings, Content, Appearance — each with `aria-current="page"` when active. Bookings carries a count bubble `absolute right-6 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-highlight px-1 text-[10px] text-highlight-foreground` (pending count, hidden at 0). Appearance opens the sheet rather than switching tab, and is "current" while the sheet is open.

**Overview tab**

- Date line `text-sm text-muted-foreground`; `h1` `font-display text-3xl font-semibold text-primary` ("Good evening, Leyla").
- KPI grid `grid grid-cols-2 gap-3`, each `card p-4`: label `text-xs font-medium text-muted-foreground`, value `font-display text-3xl font-semibold text-primary`, trend `text-xs font-semibold` coloured `text-amber-700 dark:text-amber-400` (attention), `text-emerald-700 dark:text-emerald-400` (positive) or `text-muted-foreground` (neutral). KPIs: Pending, Confirmed, Booked (month), Rating.
- "Needs your reply" + `badge badge-pending` "N pending".
- Pending cards `card animate-rise p-4`: name `font-bold`; "tour · date · pax" `text-xs text-muted-foreground`; age `text-xs` right; optional guest note `mt-2 rounded-md bg-muted/60 p-2 text-xs leading-relaxed`; actions `mt-3 grid grid-cols-3 gap-2`: `Confirm` (`btn btn-default btn-sm`), `WhatsApp` (`a.btn.btn-outline.btn-sm`), `Decline` (`btn btn-ghost btn-sm text-destructive hover:text-destructive`).
  - Confirm → status Confirmed, toast "{First name}’s booking confirmed". Decline → status Cancelled, toast "Request declined". No confirmation dialog and no decline reason on mobile (desktop AdminBookings uses a `.dialog` alertdialog) — decide deliberately in the port; an undo toast or confirm step is advisable for a destructive action.
- Empty state `card p-8 text-center`: "✓", "All caught up", "No pending requests right now."

**Bookings tab**

- `h1` "Bookings"; status rail `role="tablist"` `no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4` of `chip h-9 shrink-0 px-3.5 text-[13px] aria-selected:border-primary aria-selected:bg-primary aria-selected:text-primary-foreground` ("All · 7", "Pending · 3", "Confirmed · 2", "Completed · 1", "Cancelled · 1").
- List `card divide-y overflow-hidden`; row `flex items-center gap-3 p-4`: `min-w-0 flex-1` text block (name `truncate font-bold`, tour `truncate text-xs`, "date · pax") and status badge (`badge-pending` | `badge-confirmed` | `badge-completed` | `badge-cancelled`). Rows are not tappable in the mock.
- `Open full bookings manager` (`btn btn-ghost mt-3 w-full` → AdminBookings).

**Content tab**

- "Packages" + `+ New` (`btn btn-default btn-sm` → AdminPackages).
- List `card divide-y overflow-hidden`; row `flex items-center gap-3 p-3`: thumbnail `h-12 w-14 shrink-0 rounded-md object-cover`, title `truncate text-sm font-bold`, meta `text-xs text-muted-foreground`, `button.switch[role=switch][aria-checked][aria-label="Published: {title}"]` containing `span.switch-thumb`. Toggle → toast "{title} is live" / "{title} unpublished".
- `Manage reviews, customers & journey` (`btn btn-ghost mt-3 w-full` → AdminPackages).

**Appearance sheet** (`appearanceSheet` / header button / nav item; `aria-label="Appearance"`)

- Auto-height sheet, `pb-7`; grabber; header: "Appearance" (`text-lg font-bold`) + "Applies to your website and dashboard" (`text-xs text-muted-foreground`) + close.
- Theme `role="radiogroup"` `grid grid-cols-2 gap-3 px-5 pt-4`; option `button[role=radio]` `flex flex-col gap-2 rounded-xl border-2 border-border p-2.5 text-left aria-checked:border-primary`. Swatch strip: `<span data-theme="{id}" class="{light|dark} flex h-12 overflow-hidden rounded-md border">` holding `flex-1 bg-hero`, `w-5 bg-primary`, `w-5 bg-highlight`, `w-5 bg-background` — i.e. a nested `data-theme` scope re-resolves the tokens for the preview. Name `text-sm font-bold`. Pick → saved immediately + toast "{name} applied".
- Colour scheme: `p.label.mb-2` + `div.tabs-list.grid.w-full.grid-cols-3[role=radiogroup]` with `tabs-trigger` buttons (`role="radio"`, both `aria-selected` and `aria-checked`): Light, Dark, System. Saved immediately, no toast.
- `More appearance options` (`btn btn-outline btn-lg w-full` → AdminSettings). Corner style and heading font are only on the desktop settings screen.

**Toast**: `toast w-max max-w-[340px]` with a leading `h-2 w-2 rounded-full bg-emerald-500` dot.

---

### A.7 Dedicated mobile flows vs. responsive desktop pages

| Aspect | `M*` flow | Desktop page at phone width |
| --- | --- | --- |
| Primary navigation | Bottom tab bar (4 destinations) | Sticky `h-20` header: wordmark, `Book` pill (`sm:hidden` short label), hamburger (`xl:hidden`). Inline nav only at `xl`. No tab bar. |
| Menu | MHome: full-screen `bg-hero` overlay with fade + staggered links, 6 links | `.overlay` + `.sheet-right border-hero bg-hero p-6 text-hero-foreground sm:max-w-md` drawer, 7 `.mnav` links (adds "Special offers"), CTAs pinned with `mt-auto` |
| Header over hero | `h-16`, `-mt-16` on hero, threshold 40 px | `h-20`, `-mb-20` on header, same 40 px threshold, `bg-background/90 backdrop-blur-md` |
| Hero | Fixed `h-[640px]`, 46 px headline, stacked CTAs | `min-h-[640px] lg:h-[92vh] lg:max-h-[960px]`, headline `text-[52px] sm:text-7xl lg:text-[92px]`, CTAs `flex-col sm:flex-row`, `.parallax` image |
| Carousels | Fixed card widths (300 px / 280 px), always carousels | Percentage widths (`w-[82%]`, `w-[78%]`) that become grids (`md:grid md:grid-cols-…`, `md:overflow-visible`) |
| Scroll effects | None beyond entry animations | `.reveal` (scroll-in), `.parallax`, `.img-zoom`, `.lift` hover effects |
| Experiences filters | Chips + radio list in an `h-[560px]` custom sheet; 4 sort options | Below `md`: search + `Filters` button (`btn btn-outline h-11`) opening `.sheet-bottom` with native `<select>`s (5 sort options, adds "Shortest first"); `md`+: inline grid of selects |
| Tour detail booking | Sticky bar (`pb-7`) + sheet with adults only | `lg:hidden` sticky bar with `safe-b` and an upward shadow + `.sheet-bottom lg:hidden` with adults **and** children; `lg`+: in-page booking column |
| Tour detail gallery | Full-bleed snap gallery with counter and floating buttons | Grid gallery with lightbox; breadcrumb; header stays |
| Booking | 3 steps + progress bar, departure list for one tour | 4-label stepper ("Tour & date", "Your details", "Review", "Confirmation"), progress bar only `sm:hidden`, tour picker, month calendar, time slots; sticky `safe-b` bar that becomes `sm:static` |
| Admin | 3 tabs + appearance sheet, card lists only | Sidebar `lg:w-64` → `h-14` top bar + `.sheet-left` drawer below `lg`; tables `hidden md:block` with `md:hidden` stacked lists; `.sheet-right` panels full-width on phones |
| Safe area | Fixed `pb-5` / `pb-7` | `safe-b` class |
| Sheets | Utility-composed (`fixed … animate-sheet-bottom`) | Shared `.sheet-bottom` / `.overlay` classes |

Open product question: the two mobile concepts overlap. Either the `M*` flows are the intended phone UI (then routes need a responsive switch around `md`), or they are an exploration and the responsive pages are canonical. The canvas note says the desktop pages "adapt down to phone width", which suggests the `M*` flows are a parallel, app-style concept; confirm before building both.

---

## Part B — Design-system inventory (all 19 files)

### B.1 Fonts

All 19 files load the same single Google Fonts stylesheet (inside `<helmet>`, with a `preconnect` to `fonts.googleapis.com`):

```
https://fonts.googleapis.com/css2
  ?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500
  &family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500
  &family=Manrope:wght@400;500;600;700
  &display=swap
```

| Family | Axes / weights loaded | Role |
| --- | --- | --- |
| Manrope | 400, 500, 600, 700 (roman only) | Sans / body / UI. `font-sans` is on every root element (19×). The settings screen states: "Body text stays Manrope." |
| Cormorant Garamond | 500, 600, italic 500 | Display serif |
| Fraunces | optical size 9–144; 500, 600, italic 500 | Display serif (variable `opsz`) |

Font utilities used: `font-display` 271×, `font-sans` 19×, `font-mono` 3× (admin code inputs; no mono webfont is loaded, so it falls back to the system monospace stack).

Display usage matches the loaded weights exactly: `font-display` is only ever combined with `font-medium` (500) or `font-semibold` (600) — never `font-bold` — and italics appear as `<em>` inside display headings (10×) and `italic` (7×). Body weights in use: `font-normal` 29×, `font-medium` 63×, `font-semibold` 283×, `font-bold` 142×.

`data-font` (root attribute on all 19 files; bound to `{{uiFont}}`, plus one preview binding `data-font="{{f.id}}"` in AdminSettings):

| Value | Label in settings ("Heading font") | Display family (inferred) |
| --- | --- | --- |
| `classic` (default) | Classic | Cormorant Garamond |
| `modern` | Modern | Fraunces |
| `sans` | Sans | Manrope |

The mapping is **inferred**: there are exactly three values and three families, the default is a classic serif, and the settings preview renders `<span data-font="{id}" class="font-display text-3xl">Aa</span>` for each. The actual rule (presumably `[data-font="classic"] { --font-display: "Cormorant Garamond", serif }` etc.) lives in the missing stylesheet. Because `data-font` can be nested (the preview does this), the display family must be a CSS variable scoped by attribute, not a build-time constant. Note that Cormorant Garamond sets visibly smaller than Fraunces at the same `font-size`; headline sizes in this design were evidently tuned for the default (`classic`).

### B.2 Colour tokens

**Semantic tokens referenced through Tailwind utilities** (markup + script strings; script strings such as the header link classes are counted once per file).

| Token | Uses | Main utilities | Role (inferred from usage) |
| --- | --- | --- | --- |
| `muted-foreground` | 363 | `text-muted-foreground` 345, `/40` 6, `/25` 5; `bg-muted-foreground/15` 4, `/40` 3 | Secondary text, meta lines, placeholders; very faint for disabled calendar days; as a background for inactive pager dots |
| `hero-foreground` | 357 | `text-hero-foreground` 87, `hover:text-…` 138, `/85` 7, `/80` 10, `/75` 5, `/70` 9; `border-hero-foreground/15` 79; `hover:bg-hero-foreground/10` 19 | Text on the dark "hero" surface; hairlines and hover washes on that surface |
| `highlight` | 243 | `text-highlight` 92 (+ `!text-highlight` 31, `aria-[current=page]:text-highlight` 82); `bg-highlight` 25, `/15` 2; `border-highlight` 4, `/25`, `/30`; `ring-highlight/20`, `/30`; `divide-highlight/25` | Brand accent (champagne/gold in the default theme): eyebrows on dark, emphasised headline words, stars, stat numerals, the primary marketing CTA (`btn-highlight`), count bubbles, current nav item on dark |
| `primary` | 225 | `text-primary` 163; `bg-primary` 34; `border-primary` 5 (+ `aria-checked:border-primary` 8); `ring-primary` 6 | Brand colour: headings on light surfaces, prices, default buttons, selected states, progress fill, check bullets |
| `background` | 81 | `bg-background` 32, `/95` 22, `/90` 19; `ring-offset-background` 6 | Page background; translucent sticky bars (`/95` + `backdrop-blur`, `/90` + `backdrop-blur-md`) |
| `eyebrow` | 64 | `text-eyebrow` 64 | Small uppercase label colour on light surfaces, "Details →" links, italic subtitles (a darker, text-safe sibling of `highlight`) |
| `hero` | 63 | `bg-hero` 42, `/85` 3, `/50` 1; `border-hero` 9; gradient stops `from-hero/60`, `via-hero/10`, `to-hero/90`, `to-hero/95` | Dark brand surface: hero sections, footer, mobile menu, CTA bands, booking total panel; image scrims |
| `foreground` | 59 | `text-foreground` 36, `/85` 21 | Body text; `/85` for long-form paragraphs |
| `muted` | 35 | `bg-muted` 9, `/40` 11, `/50` 4, `/60` 4; `hover:bg-muted` 3, `hover:bg-muted/50` 4 | Subtle fills: admin page background (`/40`), note boxes, sheet grabber, disabled rows, row hover |
| `destructive` | 27 | `text-destructive` 13, `hover:text-destructive` 9; `decoration-destructive/50` 3, `/60` 1; `bg-destructive` 1 | Errors, destructive ghost actions, strike-through colour on sold-out rows |
| `secondary` | 23 | `bg-secondary/60` 17, `bg-secondary` 3, `/40`, `/70`; `border-secondary` 1 | Warm tinted section backgrounds, info/consent panels |
| `primary-foreground` | 23 | `text-primary-foreground` 21 | Text on `bg-primary` |
| `border` | 16 | `border-border` 13; `bg-border` 2; `text-border` 1 | Explicit border colour on `border-2` selectable tiles; hairline dividers; decorative SVG stroke (bare `border`/`border-b`/`border-t` — 250+ uses — rely on the default border colour being this token) |
| `highlight-foreground` | 15 | `text-highlight-foreground` 15 | Text on `bg-highlight` |
| `accent` | 12 | `bg-accent` 4; `aria-checked:bg-accent` 5; `hover:bg-accent` 2; `aria-pressed:bg-accent` 1 | Selected/hover fill of selectable rows and tiles |
| `card` | 8 | `bg-card` 7, `bg-card/95` 1 | Card/sidebar surface |
| `ring` | 4 | `hover:border-ring` 4 | Hover border of selectable tiles (focus rings themselves are in the missing CSS) |
| `popover` | 1 | `bg-popover` 1 | Floating surface |
| `secondary-foreground` | 1 | `text-secondary-foreground` 1 | Text on `bg-secondary` (one avatar) |

**Tokens never referenced by a utility** in the 19 files: `card-foreground`, `popover-foreground`, `accent-foreground`, `destructive-foreground`, `input`, `success`, `warning`. They may still exist in the missing stylesheet and be used inside component classes (e.g. `.input` border, `.btn-destructive` text), but that cannot be verified. There are **no** `success`/`warning` semantic tokens in use: success, warning, sold-out and on-hold states are drawn with literal Tailwind palette colours (below).

**`hsl(var(--x))` usages** (6, all inside decorative inline SVG maps):

| File | Usage |
| --- | --- |
| Contact | `fill="hsl(var(--primary))"` (`fill-opacity=".08"`), `fill="hsl(var(--highlight))"` (map pin dot) |
| Journey | `fill="hsl(var(--highlight))"` (`.08`), `fill="hsl(var(--hero-foreground))"` (`.06`), `stroke="hsl(var(--highlight))"` (`.55`), `stroke="hsl(var(--hero-foreground))"` (`.25`) |

This shows the original tokens are stored as space-separated HSL channel triplets (`--primary: H S% L%`) consumed as `hsl(var(--primary))`. If the port stores full colour values in the variables instead, these six SVG attributes must be rewritten to `var(--primary)` etc.

**Literal colours**

- Hex: `#6FA3B5` — one decorative route line in the Journey map SVG.
- `rgba(0,0,0,.4)` — one arbitrary shadow: `shadow-[0_-12px_30px_-18px_rgba(0,0,0,.4)]` (TourDetail mobile bar).
- Black/white utilities: `bg-black/60` 4 (sheet scrims), `bg-black/90` 1 (lightbox), `from-black/40` 1, `text-white` 7, `border-white/40` 3, `bg-white/10` 3, plus `border-transparent` 24 / `bg-transparent` 21.
- Tailwind palette families (status colours, always with explicit `dark:` variants — `dark:` appears 119×):

| Family | Uses | Meaning | Typical classes |
| --- | --- | --- | --- |
| emerald | 104 | available / success / positive trend / discount applied / toast dot | `text-emerald-700 dark:text-emerald-400`, `bg-emerald-50`, `border-emerald-600/40`, `dark:bg-emerald-500/15`, `bg-emerald-500` (dot) |
| amber | 96 | few seats left / warning / attention | `text-amber-700 dark:text-amber-400`, `bg-amber-50`, `border-amber-500/50`–`/60`, `text-amber-900 dark:text-amber-200`, `bg-amber-500` |
| rose | 43 | fully booked (calendar) | `border-rose-300`, `bg-rose-50`, `text-rose-800/70`, `dark:bg-rose-500/10` |
| violet | 38 | on hold (calendar) | `border-dashed border-violet-400`, `bg-violet-50`, `text-violet-900/80`, `dark:bg-violet-500/15` |
| sky | 3 | search-result preview link colour (admin SEO) | `text-sky-700 dark:text-sky-400` |

Recommendation: promote emerald/amber/rose/violet to semantic status tokens (`success`, `warning`, `unavailable`, `hold`) so the four themes and dark mode control them centrally.

### B.3 Theme system

**Theme ids** (from AdminSettings; names also used in MAdmin and the mobile-drawer `<select>`):

| id | Name | Description |
| --- | --- | --- |
| `emerald` (default) | Emerald & Gold | Deep emerald, ivory and champagne |
| `caspian` | Caspian Blue | Sea blue, sand and copper |
| `pomegranate` | Pomegranate | Garnet red, cream and saffron |
| `graphite` | Graphite | Neutral shadcn zinc with amber |

The actual colour values per theme are in the missing stylesheet; only the names/descriptions above are known. Each theme must define every token in B.2 for both light and dark.

**Mode values:** `light` (default), `dark`, `system` — labels "Light", "Dark", "System"; card description "Light, dark, or follow each visitor’s device setting."

**`data-radius` values** ("Corner style — Buttons, cards and inputs."):

| id | Label | Preview radius |
| --- | --- | --- |
| `none` | Sharp | 2px |
| `sm` | Subtle | 6px |
| `md` (default) | Soft | 12px |
| `lg` | Round | 20px |

The px value is what the settings swatch draws (`style="border-top-left-radius: {px}"`); it is inferred to be the base `--radius` for that setting. Elements with explicit `rounded-full` (234 uses: pills, avatars, icon buttons) are unaffected by this setting.

**`data-font` values:** `classic` (default), `modern`, `sans` — see B.1.

**Where the attributes live.** Every screen's root element carries `data-theme`, `data-font`, `data-radius` and the class `dark` or `light`. Theme swatches re-scope tokens with a nested `data-theme="{id}"` + `light|dark` class (AdminSettings, MAdmin). So the CSS must scope tokens by `[data-theme=…]` (and `.dark` within it) on any element, not only on `<html>`.

**Resolution and persistence** (the helper block `uiDefault / loadUi / uiInit / uiDestroy / saveUi / uiVals` is byte-identical in all 19 files):

1. Defaults: `{ theme: 'emerald', mode: 'light', radius: 'md', font: 'classic' }`.
2. Load: on mount, read `localStorage['aj-ui']` (JSON). If present, merge over the defaults into `state.ui`. Errors are swallowed.
3. Per-artboard override: props `theme` and `mode`; the value `'admin'` (default) means "use the saved setting", any other value overrides for that artboard only (not persisted). `radius` and `font` have no prop override.
4. Dark resolution: `dark = mode === 'dark'`, or, if `mode === 'system'`, `matchMedia('(prefers-color-scheme: dark)').matches`. Root class = `dark` or `light`.
5. Save (`saveUi(patch)`): merge defaults ← current ← patch; write `localStorage['aj-ui']`; post the full object on `BroadcastChannel('aj-ui')`; set state.
6. Live sync listeners (all removed on unmount):
   - `window` `storage` event with key `aj-ui` (or no key) → reload.
   - `BroadcastChannel('aj-ui').onmessage` → merge message data over defaults.
   - `matchMedia('(prefers-color-scheme: dark)')` `change` → re-render (matters for `system`).
   - `window` `scroll` (passive) → `scrolled = scrollY > 40`, used for the transparent-over-hero header.
7. Controls that write: AdminSettings radio groups (theme, mode, radius, font — each with a toast: "{Name} theme applied to your website", "{Label} colour scheme applied", "{Label} corners applied", "{Label} headings applied"); `Reset to default` → saves the defaults, toast "Appearance reset to default"; header toggle `cycleMode` → saves `mode: dark ? 'light' : 'dark'` (an explicit value — it leaves `system`); `pickTheme` → `<select>` in the admin mobile drawer; MAdmin appearance sheet (theme, mode).

A second persisted store exists with the same mechanics: `localStorage['aj-promo']` + `BroadcastChannel('aj-promo')` holds promotions data (campaigns, personal discounts, discount requests, audit log, settings) and is read by 10 files so admin edits update public prices live.

Porting notes: this is a prototype mechanism. In a multi-tenant product the four values are per-tenant settings stored server-side and rendered into the root attributes on the server (to avoid a flash of the default theme); `mode: 'system'` still needs client-side resolution. The key name `aj-ui` is tenant-specific ("Aurelia Journeys") and should not be carried over.

**Transparent-over-hero header** (`uiVals(overHero)`; `overHero` is `true` only for Main and MHome):

- solid: `sticky top-0 z-40 border-b bg-background/90 backdrop-blur-md transition-colors duration-300` (+ ` -mb-20` when the page has a hero), logo `text-primary`, sub-label `text-eyebrow`, icon buttons `btn-outline`.
- transparent (hero page, not scrolled, menu closed): `sticky top-0 z-40 -mb-20 border-b border-transparent bg-transparent transition-colors duration-300`, nav links `text-hero-foreground hover:bg-hero-foreground/10 hover:text-hero-foreground aria-[current=page]:text-highlight`, logo `text-hero-foreground`, sub-label `text-highlight`, icon buttons `btn-hero-outline`.

### B.4 Shared component classes

Every class below is defined in the missing stylesheet. "Observed" lists what the markup proves; "Inferred" is the reconstruction. **No `focus:` / `focus-visible:` utility appears anywhere in the 19 files**, so all focus styling (or its absence) is inside the missing CSS — the port must define visible focus rings explicitly. Likewise no `disabled:` utilities are used; disabled styling is in the component CSS.

Component names in the "shadcn/ui" column were checked against the `@shadcn` registry listing (shadcn MCP, `registry:ui` items); only the **existence of the item name** was verified, not its API, props or styling.

#### Buttons

`.btn` — 292 markup uses (`button` 169, `a` 118, `span` 3 as non-interactive previews, `label` 2 wrapping a hidden file input).

- Observed: normally paired with one variant class and optionally one size class. `rounded-full` is added on 169 uses — every public-site and mobile CTA and most icon buttons are pills/circles; admin buttons keep the theme radius. Icons are inline SVGs **without size classes** (144 of 180 SVGs), so `.btn svg` is sized by the CSS. `disabled` attribute on 14 uses; `aria-expanded` 15; `aria-pressed` 3; `aria-label` on all 125 icon-only buttons.
- Inferred base: `inline-flex items-center justify-center gap-2 whitespace-nowrap`, `text-sm font-semibold`, radius from the theme radius, `transition-colors`, `svg { size ≈ 16–18px; shrink-0 }`, `:disabled { opacity ≈ .5; pointer-events: none }`, focus-visible ring.
- A bare `btn` with no variant occurs only with ad-hoc utilities (`btn btn-icon rounded-full bg-background/95 shadow`, `btn btn-icon-lg rounded-full border border-white/40 hover:bg-white/10`), so the base has no fill of its own.

| Variant | Uses | Elements | Observed pairing | Inferred look |
| --- | --- | --- | --- | --- |
| `btn-default` | 42 (+1 script) | button 27, a 14 | all sizes; `w-full` 8; `disabled` 5 | `bg-primary text-primary-foreground`, hover slightly darker |
| `btn-highlight` | 26 | a 25 | always `rounded-full`; `btn-xl` 15, header pill `px-4 sm:px-5` 9, `btn-sm` 2 | `bg-highlight text-highlight-foreground` — the marketing/booking CTA |
| `btn-outline` | 86 (+20 script) | button 70, a 13, label 2 | `btn-icon` 31, `btn-sm` 22, `btn-lg` 7, `btn-icon-lg` 5; `aria-pressed` 2 | `border bg-background`, hover `bg-accent` |
| `btn-hero-outline` | 52 (+20 script) | a 42, button 10 | always `rounded-full`; `btn-icon` 37 (footer socials, header on hero), `btn-xl` 15 | Transparent with a `hero-foreground` hairline border and text, hover wash `hero-foreground/10`; only on `bg-hero` surfaces |
| `btn-ghost` | 44 | button 35, a 9 | `btn-icon` 25, `btn-sm` 15; `text-destructive hover:text-destructive` 8 (destructive ghost) | No border/fill, hover `bg-accent` |
| `btn-secondary` | 2 | button | — | `bg-secondary text-secondary-foreground` |
| `btn-destructive` | 4 (+1 script) | button | only inside confirm dialogs / danger actions in admin | `bg-destructive` + light text |
| `btn-link` | 9 | a 5, button 4 | `px-0` 5, `text-[15px]` 3, once `h-auto py-1` | Text-only, `text-primary`, underline on hover (`underline-offset-4`) |

| Size | Uses | Observed pairing | Inferred size |
| --- | --- | --- | --- |
| (none) | — | `h-11` is added explicitly 3× when a 44 px button is wanted, so the default is smaller | ≈ 40 px high, `px-4` |
| `btn-sm` | 45 | outline 22, ghost 15, default 5 | ≈ 32–36 px, `px-3`, `text-xs`/`text-[13px]` |
| `btn-lg` | 16 | `rounded-full` 13; padding overrides `px-6/7/8` | ≈ 44–48 px, `px-6`, `text-base`/`text-[15px]` |
| `btn-xl` | 41 | always `rounded-full`; highlight 15, hero-outline 15, default 10 | ≈ 52–56 px, `px-8`, `text-base` — hero/sheet CTAs |
| `btn-icon` | 114 | always has `aria-label`; `rounded-full` 83 | square ≈ 40 px, no padding |
| `btn-icon-lg` | 11 | always `rounded-full` | square ≈ 44–48 px |

shadcn/ui: `button`.

#### Badges

`.badge` — 78 markup + 44 script uses, always on `span`. Inferred base: `inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold` (callers enlarge with `px-3 py-1`, `px-3 py-1.5 text-[13px]`, `text-sm`, or add `uppercase tracking-wider`). A bare `.badge` with `border-transparent bg-black/60 text-white` is used for the gallery counter.

| Variant | Uses (markup / script) | Where | Inferred look |
| --- | --- | --- | --- |
| `badge-default` | 5 / 0 | "Featured", filter count | `bg-primary text-primary-foreground`, transparent border |
| `badge-secondary` | 8 / 3 | fact pills, "Expired", campaign log kind | `bg-secondary text-secondary-foreground` |
| `badge-outline` | 10 / 5 | language tags, category, "Inactive" (with `text-muted-foreground`) | Transparent, `border`, `text-foreground` |
| `badge-highlight` | 17 / 0 | discount flags on cards, sidebar counts (`ml-auto`) | `bg-highlight text-highlight-foreground` |
| `badge-overlay` | 5 / 0 | category label on photos (`absolute left-3 top-3`) | Translucent dark or light glass on imagery (e.g. `bg-background/85` + blur, or `bg-black/50 text-white`) — exact treatment unknown |
| `badge-pending` | 17 / 7 | booking/request "Pending", "N left", sidebar count | Amber tint (soft amber background, dark amber text, amber border) |
| `badge-confirmed` | 3 / 8 | "Confirmed", "Approved", "Active" | Emerald tint |
| `badge-completed` | 0 / 6 | "Completed", "Used", "Scheduled" (script only) | Neutral/blue-grey tint |
| `badge-cancelled` | 5 / 9 | "Cancelled", "Rejected", "Revoked", "Sold out" | Red/rose tint |
| `badge-verified` | 2 / 2 | review "Verified" | Emerald/primary tint, possibly with check |
| `badge-manual` | 1 / 2 | review "Added manually" | Muted/neutral tint |

Status → class maps used in scripts: Pending→`pending`; Confirmed/Approved/Active→`confirmed`; Completed/Used/Scheduled→`completed`; Cancelled/Rejected/Revoked→`cancelled`; Expired→`secondary`; Inactive→`outline text-muted-foreground`. All status badges need dark-mode pairs.

shadcn/ui: `badge` (status variants are custom).

#### Cards

`.card` — 63 uses on `div` 31, `section` 15, `article` 7, `a` 6, `form` 2, `button` 1, `aside` 1. Padding is always supplied by the caller (`p-4`, `p-5`, `p-6`, `p-7`, `p-10`, `p-14`), or by `card-header`/`card-content`. Common co-classes: `overflow-hidden` 21, `flex flex-col` 12, `border-dashed` 5 (empty states), `divide-y` 3, `shadow-xl` 3 (floating search panel), `lift group` 3, `animate-rise` 5, `transition-shadow hover:shadow-md` 2. Inferred: `rounded-(theme lg) border bg-card text-card-foreground shadow-sm`.

- `.card-header` — 13, `div`; twice overridden to a row (`flex-row items-center justify-between space-y-0`), which implies base `flex flex-col space-y-1.5 p-6`.
- `.card-title` — 16, `h2` 15 / `h3` 1; never extended. Inferred `text-lg font-semibold leading-none` (sans, not display).
- `.card-description` — 13, `p`; `mt-1.5` added 3×. Inferred `text-sm text-muted-foreground`.
- `.card-content` — 13, `div`; usually `flex flex-col gap-4`. Inferred `p-6 pt-0`.
- No `card-footer` is used.

Used only in admin screens and Offers. shadcn/ui: `card`.

#### Chip

`.chip` — 13, always `button[type=button]`. State attribute: `aria-pressed` (11), or `role="radio"` + `aria-checked` (1), or `role="tab"` + `aria-selected` (1) — in the latter two the caller repeats the selected styling as utilities (`aria-checked:border-primary aria-checked:bg-primary aria-checked:text-primary-foreground`), which tells us the built-in selected style is keyed to `[aria-pressed="true"]` only and is exactly that: `border-primary bg-primary text-primary-foreground`. Mobile adds `h-9 px-3.5 text-[13px]` (8×) and `shrink-0` in scroll rails. Inferred base: `inline-flex items-center rounded-full border bg-background px-3 text-sm font-medium`, hover `bg-accent`. Port tip: key the selected style to one data/aria state for all three semantics.

shadcn/ui: `toggle` / `toggle-group`.

#### Form controls

| Class | Uses | Element | Observed | Inferred |
| --- | --- | --- | --- | --- |
| `.input` | 58 | `input` | types text, number 11, search 5, date 5, email 4, tel 3, month 1; `aria-invalid` 21; `pl-9` with a leading icon at `left-3 top-3.5 size-4` (4×) — this icon offset implies a 44 px control (14 + 16 + 14); `rounded-full` 1; `font-mono uppercase` 1; `disabled` 1 | `h-11 w-full rounded-(theme) border border-input bg-background px-3 text-sm`, placeholder `text-muted-foreground`, focus ring, `[aria-invalid="true"] { border-destructive }` |
| `.select` | 37 | native `select` | `h-10` override 5× (so default ≠ 40 px, consistent with 44 px); widths `w-28`, `w-40`, `sm:w-44`, `w-64`; `disabled` 2 | Same box as `.input` with a custom chevron |
| `.textarea` | 21 | `textarea` | `rows` 2–4; `aria-invalid` 4; `min-h-[150px]`, `font-mono text-sm` once each | Same border/focus as input, `min-h` ≈ 80 px, `py-2` |
| `.checkbox` | 6 | `input[type=checkbox]` | `h-5 w-5` 4×, `mt-0.5` 2× | Custom-styled native checkbox, `accent`/`bg-primary` when checked, default ≈ 16 px |
| `.label` | 108 | `span` 95, `legend` 11, `label` 1, `p` 1 | wrapped by `label.flex.flex-col.gap-2`; `mb-2`/`mb-3` on legends; optional suffix `span.font-normal.text-muted-foreground` | `text-sm font-semibold leading-none` |
| `.field-error` | 37 | `span` 32, `p` 5 | **always** `role="alert"` | `text-[13px] font-medium text-destructive` |
| `.field-hint` | 4 | `span` 3, `p` 1 | `ml-auto` once (character counter) | `text-xs text-muted-foreground` |

Field anatomy: `<label class="flex flex-col gap-2"><span class="label">…</span><input class="input" aria-invalid><span class="field-error" role="alert">…</span></label>`.

shadcn/ui: `input`, `native-select` (the design uses native selects), `textarea`, `checkbox`, `label`, `field`.

#### Switch

`.switch` — 10, `button[type=button][role=switch][aria-checked][aria-label]` containing `span.switch-thumb`; `disabled` 3 (assistant/view-only role). Never extended with utilities. Inferred: track ≈ 24 × 44 px `rounded-full`, `bg-input` off → `bg-primary` when `[aria-checked="true"]`; thumb 20 px white circle translating ≈ 20 px with a ~150–200 ms transition; disabled ≈ 50 % opacity. shadcn/ui: `switch`.

#### Tabs

`.tabs-list` — 8, `div[role=tablist]` 7 / `[role=radiogroup]` 1. Two layouts: scrollable (`no-scrollbar max-w-full justify-start overflow-x-auto`, 4×) and equal segments (`grid w-full grid-cols-3`, 3×; MTour adds `sticky top-0 z-20`). Inferred: `inline-flex h-10/h-11 items-center rounded-(theme) bg-muted p-1 text-muted-foreground`.

`.tabs-trigger` — 8, `button[role=tab][aria-selected]` (once `role=radio` with both `aria-selected` and `aria-checked`); once with `aria-disabled:cursor-not-allowed aria-disabled:opacity-40`. Inferred: `rounded-(theme sm) px-3 py-1.5 text-sm font-semibold`, `[aria-selected="true"] { bg-background text-foreground shadow-sm }`.

shadcn/ui: `tabs`.

#### Table

`.table` — 7 `table` elements (21 raw mentions incl. script), admin only, always with a `min-w-[600–1040px]` inside `div.hidden.overflow-x-auto.md:block` (a `md:hidden` stacked list is the phone version). Cells carry only spacing/typography utilities (`pl-6`, `pr-6`, `text-right`, `whitespace-nowrap`, `align-top`, `font-semibold`, `text-muted-foreground`), so header/row styling comes from `.table th/td/tr`. Inferred: `w-full text-sm`, `th` = `h-11 px-3 text-left text-xs font-semibold text-muted-foreground` with bottom border, `td` = `px-3 py-3`, row `border-b` + `hover:bg-muted/50`. shadcn/ui: `table`.

#### Overlay, dialog, sheets, toast

| Class | Uses | Element / ARIA | Observed | Inferred |
| --- | --- | --- | --- | --- |
| `.overlay` | 27 | `div`, click = close | bare 17, `lg:hidden` 6, `!z-[60]` 4 (when stacked above a sheet) | `fixed inset-0 z-50 bg-black/50–60` with a fade-in (and possibly `backdrop-blur-sm`) |
| `.dialog` | 4 | `div[role=alertdialog][aria-modal][aria-label]` | always `!z-[60]`; content = title `text-lg font-bold`, text, right-aligned `btn-outline` + `btn-destructive` | Centred modal: `fixed left-1/2 top-1/2 -translate-x/y-1/2 z-50 w-full max-w-md grid gap-4 rounded-(theme lg) border bg-background p-6 shadow-lg`, scale/fade-in |
| `.sheet-right` | 15 | `div` 9 / `aside` 6, `role=dialog aria-modal aria-label` | public menu: `border-hero bg-hero p-6 text-hero-foreground sm:max-w-md` (9); admin panels: `overflow-y-auto` + `sm:max-w-xl` / `sm:max-w-2xl` / `sm:max-w-[520px]` (6) | `fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col border-l bg-background shadow-xl`, slide-in from the right (~300 ms); full-width on phones, `max-w` from `sm` |
| `.sheet-left` | 5 | `aside`, same ARIA | always `overflow-y-auto lg:hidden` (admin nav) | Mirror of `sheet-right`; width ≈ 280–320 px, `border-r` |
| `.sheet-bottom` | 2 | `div`, same ARIA | Experiences filters; TourDetail (`lg:hidden`); children: grabber, header, `flex-1 overflow-y-auto` body, footer with `safe-b` | `fixed inset-x-0 bottom-0 z-50 flex max-h-[85–90vh] flex-col rounded-t-2xl border-t bg-background`, slide-up animation |
| `.toast` | 7 | `div[role=status]` | optional leading dot `h-2 w-2 rounded-full bg-emerald-500`; mobile adds `w-max max-w-[340px]`; auto-dismiss 2600 ms (mobile) / 3000 ms (AdminSettings) | `fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg`, rise/fade-in. Position (centre vs corner) is unknown |

Z-index ladder (observed utilities): sticky headers `z-40`; sticky bars/tab bars `z-20`–`z-40`; sheets/overlays `z-50`; dialogs and their overlays `!z-[60]`; lightbox `z-[60]`.

Not in the prototype and required in the port: focus trap, `Escape` to close, scroll lock, focus return, exit animations.

shadcn/ui: `sheet` (right/left), `drawer` (bottom), `alert-dialog` (`.dialog`), `dialog`, `sonner` (toast).

#### Navigation

| Class | Uses | Element | Observed | Inferred |
| --- | --- | --- | --- | --- |
| `.nav-link` | 63 (9 public pages × 7) | `a`, `aria-current="page"` on the active one | always followed by `{{hdr.link}}` (empty when solid; hero colours when transparent). Parent `nav.hidden.items-center.gap-0.5.xl:flex` | `rounded-full px-3 py-2 text-sm font-semibold text-foreground/80`, hover `bg-accent text-foreground`, `[aria-current=page] { text-primary }` |
| `.mnav` | 63 | `a` in the mobile drawer | always `mnav animate-menu-item border-b border-hero-foreground/15 py-3 font-display text-4xl aria-[current=page]:text-highlight` + inline `animation-delay` (.04, .08, .12, .14, .16, .2, .24 s) | Mostly a hook class; possibly `transition-colors` + hover `text-highlight` |
| `.side-link` | 50 (5 admin pages × 10) | `a`, `aria-current="page"` | always `side-link h-11 lg:h-10`; leading SVG without size class; optional trailing `badge … ml-auto` | `flex items-center gap-3 rounded-(theme) px-3 text-sm font-medium text-muted-foreground`, `svg { size ≈ 18px }`, hover `bg-accent text-foreground`, `[aria-current=page] { bg-accent/secondary text-primary font-semibold }` |
| `.breadcrumb` | 3 | `nav[aria-label=Breadcrumb]` | children: links `hover:text-foreground`, `/` separators (`aria-hidden`), current `span[aria-current=page].text-foreground`; on hero `!text-hero-foreground/75` | `flex flex-wrap items-center gap-2 text-sm text-muted-foreground` |

shadcn/ui: `navigation-menu` (optional), `sidebar`, `breadcrumb`.

#### Typography / layout helpers

| Class | Uses | Element | Observed | Inferred |
| --- | --- | --- | --- | --- |
| `.eyebrow` | 51 | `p` 49, `span` 2 | `mb-4` 37, `mb-3` 10; `!text-highlight` 30 on dark surfaces (the `!` proves the class sets its own colour) | `text-xs font-semibold uppercase tracking-[0.2–0.28em] text-eyebrow` |
| `.container-x` | 52 | `div` (public pages only) | header row `container-x flex h-20 items-center justify-between gap-4`; narrowed with `max-w-4xl` | `mx-auto w-full max-w-7xl` (≈ 1280 px) with responsive gutters `px-5 sm:px-8 lg:px-12` — exact max-width unknown |
| `.no-scrollbar` | 17 | `div` | always with `overflow-x-auto` | `scrollbar-width: none; ::-webkit-scrollbar { display: none }` |
| `.safe-b` | 3 | `div` | on sticky bottom bars / sheet footers that have `pt-3` but no `pb-*` | `padding-bottom: max(0.75rem, env(safe-area-inset-bottom))` |
| `.separator` | 2 | `div` | bare | `h-px w-full bg-border` |
| `.avatar` | 32 | `span` with initials | default (13) ≈ 40 px; sized with `h-8 w-8 text-xs` … `h-16 w-16 text-lg`; recoloured once each with `bg-secondary text-secondary-foreground` and `bg-highlight text-highlight-foreground` | `inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground` |
| `.alert` | 15 | `div` 14, `p` 1 | `role="alert"` 10 / `status` 1; neutral (`bg-secondary/60`, `bg-background`), amber warning via utilities (`border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200`), or `.alert-destructive` (8) | `rounded-(theme lg) border p-4 text-sm`; destructive = `border-destructive/50 bg-destructive/5–10 text-destructive` |
| `.accordion-trigger` | 4 | `button[aria-expanded]` with trailing chevron SVG | `!py-4`, `!py-2` overrides; `hover:no-underline` added once (so the base underlines on hover) | `flex w-full items-center justify-between py-4 text-left font-medium hover:underline`; `svg { size 16–20px; transition: transform .2s }`; `[aria-expanded="true"] svg { rotate(180deg) }` |
| `.progress` | 4 | `div` 3, `span` 1 | default height used on Booking; `h-1.5` on mobile; child bar `h-full rounded-full bg-primary` (or `bg-highlight`) with inline `width` | `h-2 w-full overflow-hidden rounded-full bg-muted` |

shadcn/ui: `avatar`, `alert`, `accordion`, `progress`, `separator`.

#### Motion / effect helpers (public site)

| Class | Uses | Element | Observed | Inferred |
| --- | --- | --- | --- | --- |
| `.lift` | 3 | `a.card.lift.group` | tour cards on Main, Experiences, TourDetail | Hover: `translateY(-4px)` + larger shadow, ~300 ms ease; no effect on touch |
| `.img-zoom` | 14 | `img` inside an `overflow-hidden` wrapper whose ancestor is `.group` | always `h-full w-full object-cover` | `transition: transform .6–.7s ease`; `.group:hover .img-zoom { transform: scale(1.05–1.08) }` |
| `.parallax` | 2 | `img.absolute.inset-0` (Main hero and CTA band) | hero copy also has `animate-hero-zoom` | Scroll-linked vertical drift (CSS `animation-timeline: scroll()/view()` or JS in `support.js`), slightly oversized image. Mechanism unknown |
| `.reveal` | 18 | `div` 11, `article` 4, `h2`, `li`, `a` (Main 9, About 6, Reviews 2, Offers 1) | no script in the pages toggles a class | Scroll-into-view reveal: from `opacity: 0; translateY(~24px)` to visible over ~600–700 ms; driven by CSS view-timeline or by an `IntersectionObserver` in `support.js`. Mechanism unknown |

No page script contains `IntersectionObserver` or `classList` code, so `.reveal`/`.parallax` are implemented either purely in CSS or in the unexported `support.js`. All four must be disabled under `prefers-reduced-motion`.

#### Animation and delay classes

Keyframes are not available; direction, distance and duration below are inferred from names, placement and the inline delays that accompany them.

| Class | Uses | Elements / context | Inferred keyframes |
| --- | --- | --- | --- |
| `animate-rise` | 36 | hero text stacks (with `delay-N`), list cards, step containers, admin cards | `from { opacity: 0; transform: translateY(12–20px) } to { opacity: 1; transform: none }`; ≈ 0.6–0.7 s, ease-out (`cubic-bezier(.2,.7,.2,1)`-like), `animation-fill-mode: both` (required for the delays) |
| `animate-fade-in` | 16 | scrims, tab/accordion panels, menu overlay, lightbox | `opacity 0 → 1`, ≈ 0.2–0.3 s ease-out |
| `animate-menu-item` | 69 | `a` links in mobile menus, inline `animation-delay` .04–.24 s | `from { opacity: 0; transform: translateX(16–24px) }` (or small `translateY`) `to { none }`, ≈ 0.4–0.5 s, `both` |
| `animate-sheet-bottom` | 4 | bottom sheets (MExperiences, MTour, MAdmin, Journey story sheet) | `from { transform: translateY(100%) } to { transform: none }`, ≈ 0.3–0.35 s, decelerating curve (`cubic-bezier(.32,.72,0,1)`-like) |
| `animate-hero-zoom` | 2 | hero `img` (Main, MHome) | Slow settle: `from { transform: scale(1.08–1.12) } to { scale(1) }`, ≈ 8–14 s ease-out, runs once, `both` |
| `animate-pop` | 3 | success check circle (Booking, Contact, MBooking) | `0% { scale(.6); opacity 0 } 60% { scale(1.08) } 100% { scale(1); opacity 1 }`, ≈ 0.4–0.5 s, overshoot |
| `animate-grow` | 2 | chart bars in AdminOverview: `origin-bottom`, inline `height` + per-bar `animation-delay` | `from { transform: scaleY(0) } to { scaleY(1) }`, ≈ 0.6–0.8 s ease-out, `both` |
| `animate-spin` | 3 | submit spinners | Not custom — Tailwind built-in: `spin 1s linear infinite`, `to { transform: rotate(360deg) }` (verified, Tailwind docs v4.3) |
| `animate-pulse` | 1 (script, Offers) | "in review" step dot | Not custom — Tailwind built-in: `pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite`, `50% { opacity: 0.5 }` (verified, Tailwind docs v4.3) |
| `delay-1` | 6 | with `animate-rise` | `animation-delay` ≈ 0.08–0.12 s |
| `delay-2` | 5 | with `animate-rise` | ≈ 0.16–0.24 s |
| `delay-3` | 4 | with `animate-rise` | ≈ 0.24–0.36 s |
| `delay-4` | 3 | with `animate-rise` | ≈ 0.32–0.48 s |

`delay-1…4` are custom single-digit classes (always on an `animate-rise` element) and are **animation** delays. **Name collision to resolve in the port:** the Tailwind v4.3 documentation defines `delay-<number>` as `transition-delay: <number>ms`, so a class literally named `delay-1` would be read by Tailwind as a 1 ms *transition* delay, not a staggered *animation* delay (the docs page does not list which numbers are accepted, so confirm in a build). Rename these to something unambiguous (for example an `animation-delay` utility or an inline `animation-delay` style, which is what the menu links already use). Custom keyframe animations themselves are declared in Tailwind v4 as `--animate-<name>` theme variables with their `@keyframes` inside `@theme` (verified, Tailwind docs v4.3 "animation" page), which is the natural home for `rise`, `fade-in`, `menu-item`, `sheet-bottom`, `hero-zoom`, `pop` and `grow`. Other timing utilities are standard Tailwind: `transition-colors` 40, `transition-all` 16, `transition-shadow` 2, `transition-opacity` 1, `duration-300` 39, `duration-500` 2, `group-hover:scale-125` 1.

All animations need a `prefers-reduced-motion: reduce` fallback (none is evidenced in the files).

#### Complete list of non-Tailwind classes (markup count)

`btn` 292 · `btn-icon` 114 · `label` 108 · `btn-outline` 86 · `badge` 78 · `card` 63 · `mnav` 63 · `nav-link` 63 · `input` 58 · `btn-hero-outline` 52 · `container-x` 52 · `eyebrow` 51 · `side-link` 50 · `btn-sm` 45 · `btn-ghost` 44 · `btn-default` 42 · `btn-xl` 41 · `field-error` 37 · `select` 37 · `avatar` 32 · `overlay` 27 · `btn-highlight` 26 · `textarea` 21 · `reveal` 18 · `badge-highlight` 17 · `badge-pending` 17 · `no-scrollbar` 17 · `btn-lg` 16 · `card-title` 16 · `alert` 15 · `sheet-right` 15 · `img-zoom` 14 · `card-content` 13 · `card-description` 13 · `card-header` 13 · `chip` 13 · `btn-icon-lg` 11 · `badge-outline` 10 · `switch` 10 · `switch-thumb` 10 · `btn-link` 9 · `alert-destructive` 8 · `badge-secondary` 8 · `tabs-list` 8 · `tabs-trigger` 8 · `table` 7 · `toast` 7 · `checkbox` 6 · `badge-cancelled` 5 · `badge-default` 5 · `badge-overlay` 5 · `sheet-left` 5 · `accordion-trigger` 4 · `btn-destructive` 4 · `dialog` 4 · `field-hint` 4 · `progress` 4 · `badge-confirmed` 3 · `breadcrumb` 3 · `lift` 3 · `safe-b` 3 · `badge-verified` 2 · `btn-secondary` 2 · `parallax` 2 · `separator` 2 · `sheet-bottom` 2 · `badge-manual` 1.

Script-only: `badge-completed` (6). Custom animation/delay classes: `animate-menu-item` 69, `animate-rise` 36, `animate-fade-in` 16, `animate-sheet-bottom` 4, `animate-pop` 3, `animate-grow` 2, `animate-hero-zoom` 2, `delay-1` 6, `delay-2` 5, `delay-3` 4, `delay-4` 3. Root state classes set from script: `dark` / `light`.

Collision warning: `label`, `input`, `select`, `textarea`, `table`, `dialog`, `progress`, `switch`, `card`, `badge`, `alert`, `separator` are plain class names that are also HTML element names or Tailwind/shadcn concepts (`table` is a Tailwind `display` utility). Do not re-create them as global classes; map them to components.

### B.5 Layout and typography scale

**Breakpoints** (variant usage): `sm:` 250, `lg:` 203, `md:` 65, `xl:` 25, `2xl:` 4. Roles: `sm` = small type/padding bumps and row↔column switches; `md` = carousel → grid, table ↔ card list, inline filter bar; `lg` = admin sidebar, two-column page layouts, large type; `xl` = inline public nav and wide admin grids; `2xl` = settings live-preview side column. Other variants: `hover:` 257, `dark:` 119, `aria-[current=page]:` 84, `aria-checked:` 18, `aria-selected:` 3, `aria-disabled:` 2, `aria-pressed:` 1, `group-hover:` 1. No `focus:`/`focus-visible:`/`disabled:` variants.

**Display headings** (`font-display`, weight 500 unless noted)

| Role | Classes |
| --- | --- |
| Home hero h1 (desktop) | `text-[52px] leading-[0.98] sm:text-7xl lg:text-[92px]` |
| Home hero h1 (mobile flow) | `text-[46px] leading-[0.98]` |
| Page hero h1 | `text-5xl leading-none sm:text-6xl lg:text-7xl` (3×); variants ending `lg:text-[76px]` (2×), `sm:text-7xl lg:text-[80px]`, `lg:text-6xl`, `text-[44px] sm:text-6xl` |
| Mobile tour h1 | `text-[38px] leading-none` |
| Admin page h1 | `text-3xl font-semibold sm:text-4xl` (5×); mobile admin `text-3xl font-semibold` |
| Section h2 (most common) | `text-4xl` (13×); `text-4xl sm:text-5xl` (5×); `text-4xl leading-tight sm:text-5xl lg:text-[56px]` (3×) |
| Mobile section h2 | `text-[34px] leading-tight` (3×), `text-[40px] leading-none` (2×) |
| Sub-section h2 | `text-3xl` (7×, `font-semibold` 6×), `text-2xl` (3×) |
| Card titles (h2/h3) | `text-2xl font-semibold leading-tight`, `text-[26px]`/`text-[27px]`/`text-[28px] font-semibold` |
| Numerals / prices | `text-3xl`, `text-2xl`, `text-xl`, `text-[26px]`, `text-5xl` (rating), `text-[104px]` (one oversized numeral) |
| Sheet / dialog titles (sans) | `text-lg font-bold` (10×) |

**Body sizes** (all uses): `text-xs` 197, `text-sm` 174, `text-[13px]` 107, `text-[15px]` 71, `text-[10px]` 39, `text-[9px]` 26 (calendar cell captions, `sm:text-[10px]`), `text-lg` 19, `text-[11px]` 17, `text-[17px]` 13, `text-base` 6. The in-between sizes 13/15/17 px are deliberate and frequent; define them as named sizes rather than arbitrary values.

**Line height:** `leading-relaxed` 62 (paragraphs), `leading-none` 58 (display), `leading-tight` 16, `leading-snug` 5, `leading-[0.98]` 3, `leading-[1.02]` 1, `leading-[.9]` 1.

**Letter spacing:** `tracking-[0.28em]` 16 ("Admin" sub-label), `tracking-widest` 14, `tracking-wider` 10, `tracking-wide` 10, `tracking-[0.32em]` 9 ("Journeys" sub-label), `tracking-[0.24em]` 6, `tracking-[0.3em]` 2, `tracking-[0.26em]`, `tracking-[0.22em]`, `tracking-[0.2em]` 1 each (uppercase kickers); star rows `tracking-[2px]` 3, `tracking-[3px]` 4, `tracking-[4px]` 1. Uppercase micro-labels are always `text-[9–11px] font-semibold uppercase` with 0.22–0.32 em tracking.

**Section rhythm:** `py-20` 12 with `lg:py-32` 7 or `lg:py-28` 4 (standard public section); `py-16` 4, `py-24` 1, `py-28 lg:py-40` (CTA band); mobile flows `py-14` 6. Page-hero paddings `pt-16`/`pt-20` + `lg:pt-24`, `pb-24`/`pb-28`. Horizontal gutters: mobile flows `px-5` (content) / `px-4` (app bars, lists); public pages via `container-x`; admin `p-5 sm:p-8`.

**Gaps:** `gap-2` 256, `gap-3` 165, `gap-4` 75, `gap-1` 36, `gap-5` 34, `gap-1.5` 33, `gap-6` 29, `gap-12` 11; large layout gaps `gap-14`, `lg:gap-16`, `lg:gap-20`.

**Fixed heights:** `h-11` 58 (44 px controls), `lg:h-10` 50, `h-20` 17 (public header), `h-12` 17, `h-9` 16 (chips), `h-14` 14 (mobile/admin bars), `h-16` 6. Tables `min-w-[600–1040px]`. Mobile specifics: `h-[640px]` hero, `h-[420px]` gallery, `h-[560px]` filter sheet, `w-[300px]`/`w-[280px]` carousel cards.

**Radii:** `rounded-full` 234, `rounded-lg` 51, `rounded-xl` 32, `rounded-md` 22, `rounded-2xl` 6 (+ `rounded-t-2xl` 5 for sheets), `rounded` 5, `rounded-sm` 3. Whether `rounded-md/lg/xl` scale with `data-radius` depends on how the missing CSS maps Tailwind's radius scale to `--radius` (inferred: yes, as in shadcn's convention).

**Shadows:** deliberately sparse — `shadow-lg` 7 (selected calendar day, floating elements), `shadow-xl` 4 (floating search card, portrait), `shadow` 3 (floating gallery buttons), `hover:shadow-md` 2, `aria-checked:shadow-md` 1, and one arbitrary upward shadow `shadow-[0_-12px_30px_-18px_rgba(0,0,0,.4)]`. Depth otherwise comes from borders and translucent `backdrop-blur` bars (`backdrop-blur` 16, `backdrop-blur-md` 19).

**Aspect ratios:** `aspect-[4/5]` 6 (portraits), `aspect-[4/3]` 5 (tour cards), `aspect-[16/10]` 4, `aspect-[16/11]` 2, `aspect-square` 2, `aspect-[3/4]` 1; Journey masonry uses `columns-1 sm:columns-2 lg:columns-3`. Mobile flows use fixed image heights (`h-48`, `h-52`, `h-72`, `h-96`) instead.

**Grids:** `sm:grid-cols-2` 35, `grid-cols-2` 13, `grid-cols-3` 8, `lg:grid-cols-2` 6, `lg:grid-cols-3` 4, `grid-cols-7` 2 (calendar), footer `lg:grid-cols-[2fr_1fr_1fr_1.4fr]` 9, asymmetric splits `lg:grid-cols-[5fr_6fr]`, `[5fr_7fr]`, `xl:grid-cols-[3fr_2fr]`, `2xl:grid-cols-[1fr_420px]`.

**Opacity conventions:** body on dark `text-hero-foreground/85`; secondary on dark `/70–/80`; long-form on light `text-foreground/85`; sticky bars `bg-background/95` (mobile, with `backdrop-blur`) or `/90` (desktop, `backdrop-blur-md`); hairlines on dark `border-hero-foreground/15`.

### B.6 Images

- Every file defines the same method on the component class:

  ```js
  img(){ return { baku:'/_blob/53de…', oldcity:'/_blob/71ba…', gobustan:'/_blob/1d3b…', yanardag:'/_blob/caa9…',
                  sheki:'/_blob/99ce…', khinalug:'/_blob/b1e6…', caspian:'/_blob/feb9…', lankaran:'/_blob/b1af…' }; }
  ```

  `renderVals()` calls `const I = this.img()` and either exposes `I` to the template (`<img src="{{I.oldcity}}">`) or copies URLs into sample records (`img: I.sheki`, `photos: [I.sheki, I.lankaran, …]`).
- The values are design-tool blob URLs (`/_blob/<32-hex>`). **The image binaries were not exported**, so all eight photographs must be re-sourced; the stylesheet uses the same `/_blob/` scheme.
- There are no `srcset`, `sizes`, `loading`, `width`/`height` attributes and no art-direction variants: one URL per key is reused at every size and crop (`object-cover` everywhere).
- Decorative images use `alt=""`; content images in lists bind `alt` to the record title/name.

| Key | Full blob path | Subject (from alt text and usage) |
| --- | --- | --- |
| `baku` | `/_blob/53de85c911d3fd172f7f056fc041c3f6` | "Baku skyline at dusk"; used for the Baku food & wine tour and CTA backgrounds |
| `oldcity` | `/_blob/71ba1da1636ea18bc8040e2f214c9564` | "Maiden Tower and the walls of Icherisheher at golden hour" (home hero); also stands in for "Caravanserai courtyard" |
| `gobustan` | `/_blob/1d3b95a6d499c80338e0cfbcce073964` | "Gobustan rock landscape" (rock art / mud volcanoes); also stands in for "Lahij copper workshops" |
| `yanardag` | `/_blob/caa98c1d37e045432aedeba5937e3fb1` | "Yanar Dag at night" (burning hillside) |
| `sheki` | `/_blob/99cec70a9ac8cc922169a9d4cda6cfd7` | "Sheki beneath the Greater Caucasus"; "Leyla leading a walk in Sheki"; the Sheki tour thumbnail |
| `khinalug` | `/_blob/b1e6bea4cb0d3847910a8759889b2e6b` | "Khinalug village" (mountain village); also "Mountain road above Sheki" and the Grand Azerbaijan tour |
| `caspian` | `/_blob/feb92edafca2a9ad4057997c2c80419b` | "Caspian coast" |
| `lankaran` | `/_blob/b1af8e934de14e2a69509a83bda2b0e7` | Lankaran tea / Hirkan forest tour; also "Walnut groves near Kish" and a draft package thumbnail |

Several keys are reused as stand-ins for different subjects (same photo, different alt text), so the sample gallery contains fewer distinct photos than captions. There is no real portrait or logo asset: the guide portrait is a monogram placeholder ("LM" in a ring over a dimmed photo, labelled "Portrait"), and the logo is typeset text ("Aurelia" in the display font + a tracked uppercase sub-label).

### B.7 Icons

- 180 inline `<svg>` elements; no icon font or sprite. Standard form:

  ```html
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" aria-hidden="true">…</svg>
  ```

- `viewBox="0 0 24 24"` 178/180 (the two others are decorative map illustrations, 400×260 and 800×600). `fill="none"` + `stroke="currentColor"` on 174–176. Icons are always `aria-hidden="true"`; the accessible name is on the parent (`aria-label`) or adjacent text.
- Stroke widths: **1.7** (66; admin nav, WhatsApp, share, save), **1.8** (60; menu, close, tab bar, mode toggle), **1.6** (28; social icons, upload), **2** (19; search, filters, chevrons, check, spinner, warning), and one each of 1.4, 1.5, 2.4. A single width of 1.75 would normalise this.
- `stroke-linecap="round"` on about half (86); `stroke-linejoin="round"` on 13.
- Size: 144 of 180 have **no size class** and inherit their size from the parent component CSS (`.btn svg`, `.side-link svg`, `.accordion-trigger svg` — inferred 16–20 px). Explicit sizes: `size-5` (tab bars, mode tiles), `size-4` (search icon inside inputs), `size-3.5`, `size-3`, `size-6`, `size-8`, `size-9` (success check), `size-10`.
- Some icon paths are supplied from script data (`{{n.icon}}` MAdmin nav, `{{m.icon}}` colour-scheme tiles, `{{w.icon}}` home feature list), i.e. a single `<path d>` string per icon.
- The geometry is close to the Lucide/Feather style (24 px grid, round strokes) but hand-simplified; an off-the-shelf outline set at ~1.75 px stroke would match.

Distinct icons by apparent meaning:

| Group | Icons |
| --- | --- |
| Navigation / chrome | menu (three lines, short third line), close (X), chevron down (accordion), arrow right, search (magnifier), filter (three decreasing lines) |
| Mobile tab bar | home (house), explore (magnifier), journey (framed photo/landscape), book (calendar) |
| Admin navigation | overview (dashboard tiles), bookings (calendar), packages/content (map pin), discounts & offers (price tag), settings & appearance (palette) |
| Appearance | sun (light / switch to light), moon (dark), monitor (system), palette |
| Actions | share (tray with up arrow), save (heart; `fill` toggles `none` ↔ `currentColor`), upload (arrow into tray), play (filled triangle) |
| Status / feedback | check (success, highlights), spinner (three-quarter arc + `animate-spin`), warning triangle, lock (view-only / private), clock (time left), shield with check (licensed guide) |
| Contact / social | WhatsApp (speech bubble; a detailed variant with handset in the header), Instagram, YouTube, Facebook, map pin (filled, with accent dot) |
| Illustration | two abstract inline map drawings (Contact location card, Journey route map) coloured with `hsl(var(--token))` |

Text glyphs used as icons (not SVG): `←` 7, `→` 24, `✕` 25, `✓` 31, `★` 61 (ratings; star rows spaced with `tracking-[2–4px]`), `−` and `+` (steppers), `↗` 11 (external link), `↑` 4 (trend), `●` 4 (legend dots), `✎` 3, `⚠` 3, and flag emoji, mainly in the phone country-code selects (🇬🇧 🇺🇸 🇦🇿 🇦🇪 🇹🇷, plus one 🇩🇪). Glyph rendering varies by platform font; replace arrows, close, check and stepper symbols with SVG icons in the port, and treat the rating stars as a component with an accessible label (the design already supplies `aria-label="5 out of 5 stars"` in places).

---

## Open questions and ambiguities

1. **Stylesheet and runtime not exported.** Every "inferred" value in B.4 (control heights, paddings, badge colours, keyframes, focus rings, `container-x` width, toast position, `badge-overlay` treatment) needs confirmation from a rendered reference or the original CSS.
2. **Theme palettes unknown.** Only theme ids, names and one-line descriptions exist; the token values for 4 themes × light/dark must be authored (or recovered).
3. **`data-font` → family mapping** is inferred (classic → Cormorant Garamond, modern → Fraunces, sans → Manrope).
4. **`data-radius` → px mapping** comes from the settings swatches (2 / 6 / 12 / 20 px); how component radii derive from it is unknown.
5. **`.reveal` / `.parallax` mechanism** (CSS scroll timelines vs. script in `support.js`) is unknown.
6. **Two mobile concepts.** Dedicated `M*` flows vs. responsive desktop pages; the `Phone*.dc.html` previews named in `canvas.json` are the desktop pages' code in a 390 px frame.
7. **Mobile gaps vs. desktop:** no "Special offers" link in the MHome menu; no children stepper in the MTour sheet; no calendar/time slots/tour picker/submit-error state in MBooking; no confirm step for Decline in MAdmin; the "Journey" tab links to the desktop page; MTour → MBooking does not carry the chosen date and guests.
8. **Prototype shortcuts to replace:** fixed 390 px width and `min-h` values, `absolute` full-page menu overlay, gallery index based on a literal 390, static carousel dots, hard-coded "today", client-side storage (`aj-ui`, `aj-promo`), random booking references, stub share/wishlist/waitlist actions.
9. **Accessibility items not evidenced in the files:** focus-visible styles, focus trapping and `Escape` handling for sheets/dialogs, scroll lock, `prefers-reduced-motion` handling, 44 px minimum for chips (36 px) and possibly `btn-sm`/`btn-icon`.
10. **Image assets missing** (blob URLs only); no portrait or logo artwork exists.
