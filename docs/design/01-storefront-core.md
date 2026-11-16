# 01 — Storefront core screens (design reference)

Source: `design-reference/{Main,About,Journey,Reviews,Contact,Experiences}.dc.html`.
The design shows one tenant ("Aurelia Journeys", guide Leyla Mammadova, Azerbaijan). In Wayfold these six screens are the **public storefront template**; every tenant renders them with its own data and theme.

Conventions used in this doc

- "Script" = the `class Component extends DCLogic` block at the bottom of each file; `renderVals()` returns the view model.
- `hint-placeholder-val` / `hint-placeholder-count` attributes are design-tool preview hints only — not runtime behaviour.
- The CSS for shared component classes (`btn`, `card`, `chip`, `reveal`, …) and `support.js` are **not available**. Anything said about what those classes do is **inferred from usage** and marked as such.
- Images are opaque blob URLs keyed `baku, oldcity, gobustan, yanardag, sheki, khinalug, caspian, lankaran` (`this.img()`), i.e. placeholders for tenant media.
- shadcn/ui component names suggested below were checked against the `@shadcn` registry via the shadcn MCP (items exist: `sheet, drawer, dialog, tabs, toggle, toggle-group, select, native-select, badge, button, card, avatar, progress, alert, breadcrumb, input, textarea, label, field, empty, spinner, carousel`). No Next.js or Tailwind API is asserted here; verify those against official docs at implementation time.

Route map (tenant-relative)

| Design file | Canvas title | Route | Header mode |
|---|---|---|---|
| `Main.dc.html` | Home | `/` | transparent over hero → solid on scroll |
| `Experiences.dc.html` | Experiences | `/experiences` | solid |
| `About.dc.html` | About me | `/about` | solid |
| `Journey.dc.html` | My Journey | `/journey` | solid |
| `Reviews.dc.html` | Reviews | `/reviews` | solid |
| `Contact.dc.html` | Contact | `/contact` | solid |

Linked but out of scope here: `TourDetail` (`/experiences/[slug]`), `Booking` (`/book`), `Offers` (`/offers`).

---

## 1. Shared chrome

Identical markup in all six files; only `aria-current="page"` moves.

### 1.1 Page root

```html
<div data-theme="{{uiTheme}}" data-font="{{uiFont}}" data-radius="{{uiRadius}}"
     class="{{uiDark}} min-h-screen overflow-x-clip bg-background font-sans text-foreground antialiased">
```

`uiDark` is the literal class `dark` or `light`. Fonts loaded (Google Fonts): Cormorant Garamond (500, 600, italic 500), Fraunces (opsz 9–144; 500, 600, italic 500), Manrope (400–700). `font-display` = serif heading face (switches with `data-font`), `font-sans` = Manrope (inferred).

### 1.2 Header

`<header class="{{hdr.cls}}">` → inner `container-x flex h-20 items-center justify-between gap-4`.

| Part | Markup / classes | Notes |
|---|---|---|
| Logo | `<a aria-label="Aurelia Journeys home" class="flex items-baseline gap-2">`: word 1 `font-display text-[24px] font-semibold leading-none sm:text-[26px] {{hdr.logo}}` ("Aurelia"), word 2 `text-[10px] font-semibold uppercase tracking-[0.32em] {{hdr.sub}}` ("Journeys") | Text wordmark split into primary word + tracked sub-word. No image logo in design. |
| Desktop nav | `<nav aria-label="Main" class="hidden items-center gap-0.5 xl:flex">`, links `nav-link {{hdr.link}}` | **Shown from `xl` (1280px) only.** Order: Home, About Me, Experiences, Offers, My Journey, Reviews, Contact. Active link gets `aria-current="page"`. |
| Offers count pill | inside the Offers link: `ml-1.5 rounded-full bg-highlight px-1.5 text-[10px] font-bold text-highlight-foreground` → `{{offerCount}}` | Count of active public campaigns (see 1.6). |
| WhatsApp | `<a href="https://wa.me/…" aria-label="Chat on WhatsApp" class="btn btn-icon hidden rounded-full sm:inline-flex {{hdr.icon}}">` | Hidden below `sm`. |
| Book CTA | `btn btn-highlight rounded-full px-4 sm:px-5`; label "Book" (`sm:hidden`) / "Book a Tour" (`hidden sm:inline`) | Always visible. → Booking. |
| Menu button | `btn btn-icon rounded-full xl:hidden {{hdr.icon}}`, `aria-label="Open menu"`, `aria-expanded="{{menuExpanded}}"`; three-line icon with shorter last line (`M4 7h16M4 12h16M4 17h10`) | Toggles `state.menu`. |

Two header modes, chosen in `uiVals(overHero)`:

```js
const solid = !overHero || st.scrolled || st.menu;   // scrolled = window.scrollY > 40 (passive scroll listener)
```

| | Solid | Transparent (over hero, not scrolled, menu closed) |
|---|---|---|
| `hdr.cls` | `sticky top-0 z-40 border-b bg-background/90 backdrop-blur-md transition-colors duration-300` (+ ` -mb-20` when `overHero`) | `sticky top-0 z-40 -mb-20 border-b border-transparent bg-transparent transition-colors duration-300` |
| `hdr.link` | `''` | `text-hero-foreground hover:bg-hero-foreground/10 hover:text-hero-foreground aria-[current=page]:text-highlight` |
| `hdr.logo` / `hdr.sub` | `text-primary` / `text-eyebrow` | `text-hero-foreground` / `text-highlight` |
| `hdr.icon` | `btn-outline` | `btn-hero-outline` |

`-mb-20` cancels the 80px header height so the hero starts at the top of the viewport underneath the sticky header. Only `Main` calls `uiVals(true)`; the other five call `uiVals(false)` (always solid, no negative margin). `Experiences` has a dark hero but still uses the solid header.

### 1.3 Mobile menu sheet

Rendered only while `menuOpen` (`<sc-if>`), below `xl`.

- Backdrop: `<div class="overlay" onClick=toggleMenu>` (click closes).
- Panel: `<div role="dialog" aria-modal="true" aria-label="Menu" class="sheet-right border-hero bg-hero p-6 text-hero-foreground sm:max-w-md">` — right-side sheet, full width on phones, max `md` from `sm`. Always the dark "hero" surface regardless of light/dark mode.
- Top row (`mb-10 flex items-center justify-between`): wordmark `font-display text-2xl font-semibold` "Aurelia <span class="text-highlight">Journeys</span>" + close button `btn btn-icon btn-hero-outline rounded-full` (`aria-label="Close menu"`).
- Nav (`<nav aria-label="Mobile" class="flex flex-col">`), each link: `mnav animate-menu-item border-b border-hero-foreground/15 py-3 font-display text-4xl aria-[current=page]:text-highlight` with inline `animation-delay` staggered **.04s, .08s, .12s, .14s, .16s, .2s, .24s**. Labels: Home, About Me, Experiences, **Special offers** (desktop says "Offers" + count pill; mobile has no pill), My Journey, Reviews, Contact.
- Footer block (`mt-auto flex flex-col gap-3 pt-8`): `btn btn-highlight btn-xl rounded-full` "Book a Tour"; `btn btn-hero-outline btn-xl rounded-full` "Chat on WhatsApp"; line `text-center text-sm text-hero-foreground/70` "email · phone".
- Opening the menu also forces the header into solid mode.
- Not in script (must be added in implementation): Escape to close, focus trap, body scroll lock, close on route change. shadcn `sheet` (side right) covers these.

### 1.4 Footer

`<footer class="bg-hero pb-10 pt-20 text-hero-foreground/80">` → `container-x` → `grid gap-12 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1.4fr]`.

| Column | Content |
|---|---|
| Brand | Wordmark `font-display text-3xl text-hero-foreground` (second word `text-highlight`); blurb `mt-4 max-w-sm text-[15px] leading-relaxed`; social row `mt-6 flex gap-2` of `btn btn-icon btn-hero-outline rounded-full` icon links (Instagram, YouTube, Facebook; each has `aria-label`). |
| Explore | Heading `eyebrow mb-4 !text-highlight`; list `flex flex-col gap-3 text-[15px]`, links `hover:text-hero-foreground`: Experiences, Special offers, About Me, My Journey, Reviews, Contact. |
| Destinations | Same styling: Baku & Absheron, Sheki, Gobustan, Khinalug & Quba, Lankaran — **all link to plain Experiences** (no filter param). |
| Get in touch | mailto link, WhatsApp link "+994 50 123 45 67 (WhatsApp)", plain text address "Icherisheher, Baku", plain text hours "Mon–Sat · 9:00–19:00 (AZT)". |

Bottom bar: `mt-16 flex flex-wrap justify-between gap-4 border-t border-hero-foreground/15 pt-7 text-[13px]` — "© 2026 Aurelia Journeys. Licensed tour guide, Azerbaijan Tourism Board." + links "Privacy Policy", "Terms & Conditions" (`underline-offset-4 hover:underline`; both point at Contact as placeholders — no legal pages are designed).

### 1.5 Shared component classes (inferred intent)

| Class | Seen variants / usage | Inferred meaning → shadcn mapping |
|---|---|---|
| `container-x` | every section | Centered max-width wrapper with horizontal gutter. Gutter is 20px on mobile (carousels cancel it with `-mx-5 … px-5`). Exact max-width unknown. |
| `btn` | variants `btn-default` (primary fill), `btn-highlight` (accent/gold fill, main CTA), `btn-outline`, `btn-hero-outline` (outline for dark hero surfaces), `btn-ghost`, `btn-link`; sizes default, `btn-sm`, `btn-lg`, `btn-xl`, `btn-icon`, `btn-icon-lg`; almost always `rounded-full`; `disabled` on Contact submit | `button` with two extra variants (`highlight`, `heroOutline`) and extra sizes (`xl`, `icon-lg`). `btn-xl`/`btn-icon-lg` targets look ≥44px (inferred). |
| `badge` | `badge-default` (count in Filters button), `badge-highlight` (offer), `badge-overlay` (category label on images), `badge-outline` (skills), `badge-verified`, `badge-manual` (review provenance); ad-hoc `badge border-transparent bg-hero/85 text-hero-foreground` (photo counts) | `badge` + custom variants. |
| `card` | plain, with `lift`, with `border-dashed` (empty states), with `shadow-xl` (floating) | `card`. |
| `chip` | `chip shrink-0` buttons using `aria-pressed="true|false"` | Pill toggle; pressed style driven by `aria-pressed`. → `toggle`/`toggle-group`. |
| `tabs-list` / `tabs-trigger` | Journey view switch, `role="tablist"`/`role="tab"`, `aria-selected` | Segmented control → `tabs`. |
| `input`, `select`, `textarea`, `label`, `field-error`, `field-hint` | forms and filter bars; invalid state via `aria-invalid="true"` | Native `<select>` is used everywhere → `native-select` (or `select`); `field`, `input`, `textarea`, `label`. |
| `avatar` | initials circles (`h-11 w-11`, `h-12 w-12`, `h-14 w-14`), or icon holder | `avatar` (fallback initials). |
| `progress` | track; inner bar is a plain child with inline `width` | `progress` or plain divs. |
| `alert alert-destructive` | Contact send failure | `alert` destructive. |
| `overlay` | modal backdrop, click closes | Dialog/Sheet overlay. |
| `sheet-right`, `sheet-bottom` | mobile menu; Experiences mobile filters | `sheet` (right) / `drawer` or `sheet` (bottom). |
| `breadcrumb` | Experiences hero | `breadcrumb`. |
| `eyebrow` | small label above headings; coloured with the `eyebrow` token; overridden with `!text-highlight` on hero surfaces | Custom utility (uppercase, tracked, small — inferred). |
| `nav-link`, `mnav` | desktop / mobile nav links | Custom; active state through `aria-current="page"`. |
| `no-scrollbar` | horizontal scrollers | Hide scrollbar utility. |
| Motion: `reveal`, `animate-rise`, `animate-hero-zoom`, `animate-menu-item`, `animate-sheet-bottom`, `animate-pop`, `animate-spin`, `delay-1…delay-4`, `parallax`, `lift`, `img-zoom` | see 1.7 | Custom keyframes/utilities. |

### 1.6 Shared script state and values (`uiVals`)

| Value | Source | Used by these screens? |
|---|---|---|
| `uiTheme`, `uiFont`, `uiRadius`, `uiDark` | see section 8 | yes (root div) |
| `hdr`, `menuOpen`, `menuExpanded`, `toggleMenu` | `state.scrolled`, `state.menu` | yes |
| `offerCount` | `promoData().campaigns.filter(c => campStatus(c)==='Active' && c.visibility==='public').length`; **falls back to the literal `4`** when the page has no `promoData` method (About, Journey, Reviews, Contact) or on error | yes (nav pill) |
| `navOpen`, `navExpanded`, `toggleNav`, `cycleMode`, `modeLabel`, `pickTheme`, `isDark`, `isLight` | — | **no** — exposed but not bound in any of these six templates (no visitor-facing theme or mode switch) |

No toasts exist in any of the six screens. The only loading state is the Contact submit button; there are no skeletons.

### 1.7 Motion vocabulary

| Class | Where | Trigger (inferred unless noted) |
|---|---|---|
| `animate-rise` + `delay-1…4` | above-the-fold hero copy; cards that re-render after filtering (Experiences cards, Reviews cards, Journey gallery items); Contact success card | CSS keyframe on mount: fade + translate up; `delay-N` staggers. Re-fires when a filtered list re-mounts. |
| `reveal` | below-the-fold section headers and items | Scroll-into-view reveal (observer presumably in `support.js`). |
| `animate-hero-zoom` | Main hero image | Slow one-off scale on load (Ken Burns). |
| `parallax` | Main hero image, Main final-CTA image | Scroll-linked vertical offset. |
| `lift` | tour cards (`card lift group`) | Hover raise/shadow. |
| `img-zoom` | images inside a `group` | Scale on parent hover. |
| `animate-menu-item` | mobile menu links | Staggered slide/fade using inline `animation-delay`. |
| `animate-sheet-bottom` | Journey entry dialog | Slide up from bottom. |
| `animate-pop` | Contact success check badge | Scale pop. |
| `animate-spin` | Contact submit spinner | Tailwind spin. |
| count-up | Main stats band | **Explicit in script**: `requestAnimationFrame`, 1600ms, ease-out cubic `1-(1-k)^3`, starts on mount (not on scroll). |

Reduced motion is handled explicitly only in `Main.componentDidMount` (`prefers-reduced-motion: reduce` → counters jump to final values). Side effect of the early `return`: the review auto-rotate timer is also never started under reduced motion. All other classes need their own reduced-motion fallback in the reimplementation.

---

## 2. Home — `Main.dc.html` → `/`

`<title>`: "Aurelia Journeys — Private Tours in Azerbaijan". Section rhythm `py-20 lg:py-32`, alternating `bg-background` / `bg-secondary/60` / `bg-hero`. Standard H2: `font-display text-4xl font-medium leading-tight text-primary sm:text-5xl lg:text-[56px]`.

State: `{ cat: 'All', idx: 0, k: 0 }` + shared `ui`, `promo`, `scrolled`, `menu`.

### 2.1 Sections

1. **Hero** (`aria-label="Introduction"`): `relative flex min-h-[640px] items-end overflow-hidden bg-hero lg:h-[92vh] lg:max-h-[960px]`.
   - Image: `parallax absolute inset-0 h-full w-full animate-hero-zoom object-cover`, descriptive alt.
   - Scrim: `absolute inset-0 bg-gradient-to-b from-hero/60 via-hero/10 to-hero/90`.
   - Content: `container-x relative w-full pb-16 pt-32 lg:pb-24` → `max-w-3xl`.
   - Kicker: `mb-6 flex animate-rise items-center gap-3 text-xs font-semibold uppercase tracking-[0.3em] text-highlight delay-1` preceded by a rule `h-px w-10 bg-highlight` — "Private & small-group journeys · Azerbaijan".
   - H1: `animate-rise font-display text-[52px] font-medium leading-[0.98] text-hero-foreground delay-2 sm:text-7xl lg:text-[92px]` — "Discover the world *through local eyes.*" (italic `<em class="text-highlight">` tail — recurring headline pattern).
   - Lede: `mt-7 max-w-xl animate-rise text-base leading-relaxed text-hero-foreground/85 delay-3 sm:text-lg` (one sentence on regions + guide name).
   - CTAs: `mt-10 flex animate-rise flex-col gap-3 delay-4 sm:flex-row` — `btn btn-highlight btn-xl rounded-full` "Explore Experiences →" (→ Experiences), `btn btn-hero-outline btn-xl rounded-full` "Book Your Private Tour" (→ Booking).
   - "Now guiding" caption: `absolute bottom-24 right-10 hidden text-right text-hero-foreground/85 lg:block` — label "Now guiding" (`text-[11px] font-semibold uppercase tracking-[0.28em] text-highlight`), place `font-display text-2xl` "Sheki, Greater Caucasus", meta `text-[13px]` "41.19° N · 47.17° E · Autumn harvest season". Static copy.
2. **Stats band** (`aria-label="Highlights"`): `bg-primary text-primary-foreground` → `container-x grid grid-cols-2 gap-6 py-8 lg:grid-cols-4`. Each: value `font-display text-4xl text-highlight`, label `text-[13px] opacity-80`. Values: `{{c1}}+` "Guests guided since 2014", `{{c2}}` "Tours completed", `{{c3}}` "Places explored", static "4.9 / 5" "From 386 guest reviews". Counters animate to 2,900 / 940 / 48 (formatted `en-US`).
3. **Promo strip** (only if `promo` truthy): `border-b bg-highlight/15` → `container-x flex flex-col items-start gap-3 py-4 sm:flex-row sm:items-center sm:justify-between`. Left: `badge badge-highlight px-3 py-1 text-sm` `{{promo.big}}`, then "**{{promo.name}}** — {{promo.line}}", then `text-muted-foreground` `{{promo.ends}}`. Right: `btn btn-outline btn-sm rounded-full` "See all {{promoCount}} offers →" (→ Offers).
4. **Featured experiences** (`aria-labelledby="feat"`):
   - Header row `reveal mb-10 flex flex-wrap items-end justify-between gap-6`: eyebrow "Featured experiences"; H2 "Journeys our guests return for, again and again."; `btn btn-link px-0 text-[15px]` "View all 9 experiences →" (count is hard-coded).
   - Category chips: `role="group" aria-label="Filter by category"`, `no-scrollbar -mx-5 mb-8 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:px-0` — horizontal scroll on mobile, wrap from `sm`.
   - Card rail/grid: `no-scrollbar -mx-5 flex snap-x snap-mandatory gap-5 overflow-x-auto px-5 pb-2 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 lg:grid-cols-3 lg:gap-7` — snap carousel below `md` (cards `w-[82%] shrink-0 snap-start`), 2 columns at `md`, 3 at `lg`.
   - Tour card: see 2.2.
   - Empty state (`noneFeatured`): `rounded-xl border border-dashed p-12 text-center` — "Nothing in this category yet" (`font-display text-3xl text-primary`) + "Every journey can be tailored — request a custom itinerary." (link → Contact, `font-semibold text-eyebrow underline underline-offset-4`).
5. **Your guide** (`aria-labelledby="about"`, `bg-secondary/60`): `container-x grid items-center gap-12 lg:grid-cols-2 lg:gap-20`.
   - Left (`reveal relative`): portrait frame `relative aspect-[4/5] overflow-hidden rounded-2xl bg-hero`; in the design this is a placeholder (background photo at `opacity-50`, initials "LM" in a `h-32 w-32 rounded-full border border-highlight font-display text-5xl text-highlight` circle, caption "Portrait of Leyla Mammadova"). Floating stat card `absolute -bottom-6 right-4 rounded-xl bg-primary p-6 text-primary-foreground shadow-xl sm:right-[-20px]`: "12" (`font-display text-5xl leading-none text-highlight`) + "years guiding / across Azerbaijan".
   - Right (`reveal`): eyebrow "Your guide"; H2 = guide name (`font-display text-5xl font-medium text-primary lg:text-[56px]`); credential line `font-display text-2xl italic text-eyebrow` "Licensed guide · Art historian · Mountain leader"; two bio paragraphs `text-[17px] leading-relaxed text-foreground/85`; fact grid `mb-9 grid grid-cols-2 gap-x-8 gap-y-6 border-y py-7` with micro-labels `text-xs uppercase tracking-widest text-muted-foreground` — Languages, Specialisms (values `font-semibold`), Guests served "2,900+", Places explored "48" (values `font-display text-3xl text-primary`); CTA `btn btn-default btn-xl rounded-full` "Discover My Story →" (→ About).
6. **Popular destinations** (`id="destinations"`): centered header `reveal mx-auto mb-12 max-w-2xl text-center` — eyebrow "Popular destinations", H2 "From the Caspian shore to the roof of the Caucasus."
   - Layout: `no-scrollbar -mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 md:mx-0 md:grid md:grid-cols-4 md:grid-rows-[280px_280px] md:gap-5 md:overflow-visible md:px-0`. Mobile: snap rail of tiles `h-[420px] w-[78%] shrink-0 snap-start`. From `md`: bento grid, first tile `md:col-span-2 md:row-span-2`, four 1×1 tiles (exactly 5 tiles fit).
   - Tile: `group relative block overflow-hidden rounded-xl text-hero-foreground`; image `img-zoom absolute inset-0`; scrim `bg-gradient-to-b from-transparent via-transparent to-hero/90`; caption block `absolute inset-x-6 bottom-6`: "{{region}} · {{tours}}" (`text-[11px] font-semibold uppercase tracking-[0.24em] text-highlight`), name `font-display text-[32px] leading-tight`, line `mt-1 text-sm opacity-90`. All tiles link to Experiences (unfiltered).
7. **Why travel with me** (`bg-hero text-hero-foreground`): header `reveal mb-14 grid items-end gap-8 lg:grid-cols-2 lg:gap-16` — left eyebrow (`!text-highlight`) "Why travel with me" + H2 "A guide, a host and a friend on the road."; right paragraph `text-[17px] leading-relaxed text-hero-foreground/80`. Feature grid `grid sm:grid-cols-2 lg:grid-cols-3` (no gap; separation by top rules): item `reveal border-t border-highlight/30 px-1 py-9 sm:pr-8` with icon chip `mb-5 inline-flex h-12 w-12 items-center justify-center rounded-full border border-highlight/50 text-highlight` (22px stroke icon, `stroke-width=1.5`), title `mb-2 font-display text-[28px]`, text `text-[15px] leading-relaxed text-hero-foreground/75`. 6 items.
8. **Recent adventures**: header row (same pattern as featured) — eyebrow "Recent adventures", H2 "Pages from the travel journal.", link "Open My Journey →". Grid `grid gap-10 md:grid-cols-12 md:gap-6`, editorial asymmetric layout driven by per-item `cls`/`ratio`: row 1 = 7 cols (`aspect-[16/10]`) + 5 cols (`aspect-[4/5]`); row 2 = 5 + 7. Item (`reveal group flex flex-col gap-4`, whole item links to Journey): image `relative overflow-hidden rounded-xl {{ratio}}` with `img-zoom` and photo-count badge `badge absolute bottom-4 right-4 border-transparent bg-hero/85 text-hero-foreground` "{{photos}} photos"; title row `flex items-baseline justify-between gap-4` (H3 `font-display text-[28px] font-semibold text-primary` + date `whitespace-nowrap text-[13px] text-muted-foreground`); description `-mt-2 text-[15px] leading-relaxed text-muted-foreground`; "Related: {{rel}}" `text-[13px] font-semibold text-eyebrow`.
9. **Guest stories** (`bg-secondary/60`): `container-x max-w-4xl text-center`. Eyebrow "Guest stories"; H2 (`mb-12 font-display text-4xl font-medium text-primary`) "4.9 average from 386 reviews". Slide region `aria-live="polite" class="min-h-[300px]"`: stars `mb-7 text-xl tracking-[4px] text-highlight` (always "★★★★★", `aria-label="5 out of 5 stars"`), quote `font-display text-2xl italic leading-snug sm:text-[34px]` wrapped in curly quotes, attribution row `mt-10 flex items-center justify-center gap-4`: `avatar h-14 w-14` initials + "**Name** · Country" / "Tour · Date". Controls `mt-10 flex items-center justify-center gap-4`: prev/next `btn btn-outline btn-icon-lg rounded-full` ("←"/"→", `aria-label` "Previous review"/"Next review"); dots: each a `h-11 w-7` hit target with `aria-label="Show review N"`, `aria-current`, inner pill active `block h-2.5 w-7 rounded-full bg-primary transition-all`, inactive `block h-2.5 w-2.5 rounded-full bg-muted-foreground/40 transition-all`. Link `btn btn-link mt-6 text-[15px]` "Read all 386 reviews" (→ Reviews).
10. **Final CTA**: `relative overflow-hidden bg-hero py-28 lg:py-40`; image `parallax absolute inset-0 … object-cover opacity-60` + flat scrim `bg-hero/50`; `container-x reveal relative max-w-4xl text-center text-hero-foreground`. H2 `font-display text-5xl font-medium leading-[1.02] sm:text-6xl lg:text-[76px]` — "Your next unforgettable journey *starts here.*"; paragraph `mx-auto mt-7 max-w-xl text-lg leading-relaxed text-hero-foreground/85` (promise: request in two minutes, personal reply within 24 hours); buttons `btn btn-highlight btn-xl rounded-full` "Book Your Tour", `btn btn-hero-outline btn-xl rounded-full` "Contact Me".

### 2.2 Tour card (shared by Home and Experiences)

```
<a class="card lift group flex flex-col overflow-hidden">            // whole card is the link → TourDetail
  media   relative aspect-[4/3] overflow-hidden
          img.img-zoom  + badge.badge-overlay (top-left: category)
          [if lp.has]   badge.badge-highlight.text-sm (top-right: lp.badge, e.g. "−15%")
  body    flex flex-1 flex-col gap-3 p-6            (Experiences: gap-2.5)
          row   place (13px muted) | "★ {rating} ({count})"
          title font-display text-[28px] font-semibold leading-tight text-primary   (h3; Experiences: h2, text-[27px])
          desc  text-[15px] leading-relaxed text-muted-foreground                   (Experiences: text-sm)
          foot  mt-auto flex items-center justify-between border-t pt-4
                duration (13px muted) | "from " [if lp.strike: <span line-through>{lp.orig}</span>] <strong font-display text-2xl text-primary>{lp.now}</strong>
          [Experiences only, if lp.has]     p.-mt-1.text-xs.font-semibold.text-emerald-700.dark:text-emerald-400  "{lp.name} · {lp.ends}"
          [Experiences only, if lp.hasNote] p.-mt-1.text-xs.text-muted-foreground  "Offer: {lp.badge}"
          "View details →"  text-sm font-semibold text-eyebrow
```

### 2.3 Interactions and state

| Interaction | Behaviour |
|---|---|
| Category chips | `cats = ['All','Cultural','Historical','Adventure','Food & Local','Private','Family','Customized']`. Single-select; `aria-pressed`. `featured = (cat==='All' ? tours : tours.filter(t => t.cat===cat)).slice(0,3)`. Client-only, instant, no URL sync. |
| Featured empty state | When the filtered list is empty (cannot happen with the sample data — every category has exactly one tour). |
| Review carousel | `idx` in `0..3`; prev = `(idx+3)%4`, next = `(idx+1)%4`, dots jump. **Auto-advance every 8000ms** (`setInterval`), not paused on hover/focus/interaction; region is `aria-live="polite"`. Length 4 is hard-coded in the modulo. |
| Count-up | See 1.7. |
| Header | Transparent ↔ solid at `scrollY > 40`. |
| Promo strip + nav count + card prices | Derived from promo data (2.5), re-computed live when `localStorage['aj-promo']` changes. |

### 2.4 Data shapes (script)

```ts
// tours (Home sample has 7 of the 9 catalogue tours)
type HomeTour = {
  tid: 'fire'|'old'|'sheki'|'food'|'grand'|'lank'|'bespoke'; // join key into promo pricing
  title: string;      // 'Fire & Stone: Gobustan & Yanar Dag'
  place: string;      // 'Absheron' | 'Baku' | 'Sheki' | 'Nationwide' | 'You choose'
  cat: string;        // one of the category labels
  dur: string;        // '1 day' | '6 hours' | '3 days' | '4 hours' | '8 days' | '7–14 days'
  price: string;      // '$165' — NOT rendered (lp.now is used instead)
  rating: string;     // '5.0'
  count: number;      // review count, 128
  badge: string;      // 'Most loved' | 'Popular' | 'Featured' | 'Tailor-made' | '' — NOT rendered
  img: string; desc: string;
  lp: ListPrice;      // added by listPrice(tid), see 2.5
};

type HomeReview = { text: string; name: string; country: string; tour: string; date: string /* 'October 2026' */; init: string /* 'EW' */ }; // 4 items, all implicitly 5★

type Destination = { cls: string /* '' | 'md:col-span-2 md:row-span-2' */; name: string; region: string; tours: string /* '3 tours' — preformatted, hard-coded */; line: string; img: string }; // 5 items

type WhyItem = { t: string; d: string; icon: string /* raw SVG path `d`, 24×24 viewBox */ }; // 6 items

type RecentEntry = { cls: 'md:col-span-7'|'md:col-span-5'; ratio: 'aspect-[16/10]'|'aspect-[4/5]'; title: string; date: string /* 'Oct 2026' */; photos: number; rel: string /* related tour title */; img: string; desc: string }; // 4 items

// stats: literals 2900, 940, 48 animated by k∈[0,1]; '4.9 / 5' and '386' are static markup
// promo strip view model
type PromoStrip = { name: string; big: string /* '15% off' | '$300 off' */; line: string /* tour names joined with ' & ' */; ends: string /* 'Ends 15 December' (en-GB, day + long month) */ } | '';
```

Sample: `destinations` = Baku & Icherisheher (Absheron, 3 tours), Sheki (Shaki-Zagatala, 2), Gobustan (Absheron, 1), Khinalug (Quba, 2), Lankaran (South coast, 1). `why` titles = Local expertise, Personalised journeys, Flexible itineraries, Professional guidance, Safe & comfortable, Memorable moments.

### 2.5 Promo / pricing rules (shared script block in Main and Experiences)

Storage: `localStorage['aj-promo']` (JSON) + `BroadcastChannel('aj-promo')` + `storage` event; falls back to `promoDefaults()`. "Today" is frozen: `promoNow() = '2026-11-15'`.

```ts
type PromoData = {
  settings: { requestsEnabled: boolean; maxRequestPct: number /* 30 */; notify: 'email+whatsapp'; responseDays: number /* 2 */; stacking: 'best' };
  campaigns: Campaign[]; manual: ManualDiscount[]; requests: DiscountRequest[]; log: AuditEntry[];
};
type Campaign = {
  id: string;            // 'c1'
  name: string;          // 'Autumn in the Caucasus'
  code: string;          // '' or 'WELCOMEBACK'
  type: 'percent'|'fixed'; value: number;         // 15 (%), 300 ($)
  tours: string[];       // tour ids, or ['all']
  start: string; end: string;                      // ISO dates 'YYYY-MM-DD'
  visibility: 'public'|'private'; assigned: string[]; // emails for private
  minGuests: number; minChildren: number; bookAhead: number; // 0 = no condition; bookAhead in days
  active: boolean; uses: number; blurb: string;
};
// Also present, not consumed by these six screens (Offers/Booking/Admin):
// ManualDiscount { id,name,email,booking,tour:'any'|tid,type,value,expiry,note,by,at,usedBy }
// DiscountRequest { id:'DR-1046',name,email,phone,tour,booking,guests,type,value,reason,status:'Pending'|'Approved'|'Rejected',at,decision:null|{type?,value?,note?,reason?,by,at,notified} }
// AuditEntry { at, who, what, kind:'request'|'approve'|'reject'|'campaign'|'manual'|'used' }
// promoTours(): Record<tid,{ n: title, p: basePriceUSD }> — sheki 690, khin 480, grand 2450, fire 165, old 120, food 85, wine 210, lank 560, bespoke 3200
```

Rules:

- `campStatus(c)`: `!active → 'Inactive'`; `end < today → 'Expired'`; `start > today → 'Scheduled'`; else `'Active'` (string comparison of ISO dates).
- `offerCount` / `promoCount` = number of Active + public campaigns (4 with sample data: c1–c4).
- Home promo strip = the **first** Active public campaign in array order (not the best or soonest-ending). Sample: badge "15% off", "**Autumn in the Caucasus** — Silk Road to Sheki & Khinalug & Quba Highlands", "Ends 15 December". Hidden when none.
- `money(n)` = `'$' + Math.round(n).toLocaleString('en-US')` (USD only, whole dollars).
- `discAmt(type,value,base)` = percent → `Math.round(base*value/100)`; fixed → `min(value, base)`.
- `discLabel` = `'15% off'` / `'$300 off'`. `eligText(c)` joins `'6+ guests'`, `'at least 1 child'`, `'booked 90+ days ahead'`, `'assigned guests only'` with ` · `, else `'Everyone'`.
- `listPrice(tid)` (card price display):
  1. Candidates = Active, public, applies to tour (`'all'` or includes tid), **and no `minGuests`/`minChildren`** (note: `bookAhead` is *not* excluded).
  2. Best candidate = largest `discAmt` against the single-guest base price.
  3. No best → `{ has:false, now: money(base), orig:'' }`; if any Active public campaign still targets the tour (conditional one), also `badge = discLabel + ' · ' + eligText`, `hasNote:true`, `name`.
  4. Best is percent → `{ has:true, strike:true, orig: money(base), now: money(base-amt), badge:'−15%', name, ends:'Ends 15 Dec' }` (en-GB, day + short month).
  5. Best is fixed → `{ has:true, strike:false, fixedWhole:true, orig: money(base), now: money(base), badge:'$300 off per booking', name, ends }` — fixed discounts apply per booking, so the per-person "from" price is not reduced or struck through.

```ts
type ListPrice = { has: boolean; now: string; orig: string; badge?: string; name?: string; ends?: string; strike?: boolean; fixedWhole?: boolean; hasNote?: boolean };
```

Resulting sample display: sheki "−15%" ~~$690~~ **$586**; khin "−15%" ~~$480~~ **$408**; grand and bespoke "$300 off per booking" (price unchanged); fire and lank → note "10% off · at least 1 child"; old and food → note "8% off · 6+ guests"; wine → no offer.

`quote()`, `serverSubmitRequest()`, `serverDecide()` are also in the block (booking totals: adults full price, children half; only the single best discount applies; request validation with HTTP-like codes) but nothing in these six screens calls them.

---

## 3. Experiences — `Experiences.dc.html` → `/experiences`

`<title>`: "Experiences & Tour Packages in Azerbaijan — Aurelia Journeys". Catalogue listing with search, filters, sort.

State: `{ q:'', cat:'All', dur:'any', price:'any', sort:'pop', sheet:false, offers:false }`.

### 3.1 Sections

1. **Page hero**: `relative overflow-hidden bg-hero`; background image `absolute inset-0 … object-cover opacity-45` (no parallax/zoom); `container-x relative pb-24 pt-16 text-hero-foreground lg:pb-28 lg:pt-24`. Breadcrumb `breadcrumb mb-6 !text-hero-foreground/75`: Home / Experiences (`aria-current="page"`). H1 `animate-rise font-display text-5xl font-medium leading-none sm:text-6xl lg:text-7xl` — "Experiences & *tour packages*". Lede `mt-5 max-w-xl animate-rise … delay-1 sm:text-lg` ("Nine carefully designed journeys…" — count hard-coded in copy).
2. **Filter bar** (`aria-label="Search and filter"`, `relative -mt-10` so it overlaps the hero): `card p-4 shadow-xl sm:p-6`.
   - Mobile row (`flex gap-2 md:hidden`): search input with leading icon (`input pl-9`, `type="search"`, placeholder "Tour or destination", sr-only label "Search experiences") + `btn btn-outline h-11 shrink-0` "Filters" with icon and, when non-zero, `badge badge-default` count.
   - Desktop grid (`hidden gap-4 md:grid md:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]`): labelled Search (placeholder "Tour name or destination"), Duration, Price, Sort by — all native `<select class="select">`.
   - Chip row (`role="group" aria-label="Category"`, `no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0`): first an **"On offer"** toggle chip with a tag icon (`size-4`), then the 8 category chips.
3. **Results** (`aria-label="Results"`, `pb-28 pt-12`):
   - Bar `mb-6 flex flex-wrap items-center justify-between gap-3`: `aria-live="polite"` "**{count}** experience(s)"; when `filtered`, `btn btn-ghost btn-sm` "Clear all filters ✕".
   - Grid `grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-7` of tour cards (2.2) with `animate-rise`.
   - Empty state: `card flex flex-col items-center border-dashed px-6 py-16 text-center` — search icon `mb-4 size-10 text-eyebrow`, "No journeys match those filters" (`font-display text-3xl text-primary`), "Try a wider budget or length — or let me design one just for you.", buttons `btn btn-outline btn-lg rounded-full` "Clear filters" + `btn btn-default btn-lg rounded-full` "Request a custom trip" (→ Contact).
4. **Mobile filter sheet** (when `sheet`): `overlay` + `<div role="dialog" aria-modal="true" aria-label="Filters" class="sheet-bottom">` — grab handle `mx-auto mt-3 h-1.5 w-12 rounded-full bg-muted`; header `flex items-center justify-between px-5 pb-2 pt-4` ("Filters" `text-lg font-bold` + `btn btn-ghost btn-sm` "Reset"); body `flex flex-col gap-5 overflow-y-auto px-5 pb-4` with the same Duration / Price / Sort selects; sticky footer `border-t p-4` with `btn btn-default btn-xl w-full rounded-full` "Show {count} {countLabel}". Changes apply live; the footer button only closes the sheet. No drag-to-dismiss in script.

### 3.2 Filter, sort and search rules

| Control | Options (`value` → label) | Rule |
|---|---|---|
| Search `q` | free text | `(title + ' ' + place).toLowerCase().includes(q.trim().toLowerCase())`; filters on every keystroke, no debounce |
| Category `cat` | All + 7 labels | exact match on `t.cat`; single-select |
| On offer `offers` | toggle | keep tours where `listPrice(t.tid).has || .hasNote` |
| Duration `dur` | `any` Any length · `day` Up to 1 day · `short` 2–3 days · `long` 4+ days | `day`: `days <= 1`; `short`: `1 < days <= 3`; `long`: `days > 3` |
| Price `price` | `any` Any budget · `u300` Under $300 · `u1000` $300 – $1,000 · `o1000` $1,000+ | `< 300` · `300..1000` inclusive · `> 1000`; tested against **base** price, not discounted |
| Sort `sort` | `pop` Most popular · `rating` Highest rated · `low` Price: low to high · `high` Price: high to low · `short` Shortest first | `pop` desc · `rating` desc then `count` desc · `price` asc · `price` desc · `days` asc |

Derived: `count`, `countLabel` (`'experience'` when 1, else `'experiences'`), `empty`.
`activeCount` (mobile Filters badge) = `(dur≠any) + (price≠any) + (sort≠pop)` — sort counts as a filter; category, search and "On offer" do not.
`filtered` (shows "Clear all filters") = `q || cat≠'All' || activeCount` — "On offer" alone does not show it.
`reset` restores `q, cat, dur, price, sort, offers` to defaults (leaves the sheet open).
No pagination, no loading state, no URL/query-string sync in the design.

### 3.3 Data shape

```ts
type CatalogueTour = {
  title: string; place: string; cat: string;
  days: number;       // sortable duration: 0.17 (4h), 0.25 (6h), 1, 2, 3, 8, 10
  durL: string;       // display: '6 hours' | '1 day' | '3 days' | '7–14 days'
  price: number;      // base USD per person: 85 … 3200
  rating: number;     // 4.8 – 5.0 → ratingL = rating.toFixed(1)
  count: number;      // reviews
  pop: number;        // popularity rank score 3–10 (higher = more popular)
  badge: string;      // 'Popular' | 'Most loved' | 'Featured' | 'Tailor-made' | '' — NOT rendered
  img: string; desc: string;
  // derived: priceL ('$2,450', NOT rendered), ratingL, lp: ListPrice
};
```

9 sample tours: Icherisheher & Flame Towers (Baku, Historical, 6 hours, $120, 4.9/164), Fire & Stone: Gobustan & Yanar Dag (Absheron, Adventure, 1 day, $165, 5.0/128), Silk Road to Sheki (Sheki, Cultural, 3 days, $690, 4.9/71), Khinalug & Quba Highlands (Quba, Adventure, 2 days, $480, 4.9/39), Baku Food & Wine Evening (Baku, Food & Local, 4 hours, $85, 4.9/212), Shamakhi Wine Route (Shamakhi, Food & Local, 1 day, $210, 4.8/46), Lankaran Tea & Hirkan Forest (Lankaran, Family, 3 days, $560, 4.8/33), Private Grand Azerbaijan (Nationwide, Private, 8 days, $2,450, 5.0/22), Bespoke Azerbaijan (You choose, Customized, 7–14 days, $3,200, 5.0/19).

**Defect in the design file:** the catalogue objects have **no `tid`**, yet the template renders `{{t.lp.now}}` from `listPrice(t.tid)`. `listPrice(undefined)` returns `{ orig:'', now:'', has:false }`, so as written the price is blank, no offer badges/notes appear, and "On offer" always yields the empty state. Intent is clear from Home (which has `tid`): every tour needs a stable id that joins to pricing/promotions, and the card shows `lp.now`.

---

## 4. About — `About.dc.html` → `/about`

`<title>`: "About Leyla Mammadova — Licensed Guide in Azerbaijan — Aurelia Journeys". Fully static; state is only shared chrome.

### 4.1 Sections

1. **Intro split** (`py-16 lg:py-28`): `container-x grid items-center gap-12 lg:grid-cols-[5fr_6fr] lg:gap-20`.
   - Left (`relative animate-rise`): portrait frame `relative aspect-[4/5] overflow-hidden rounded-2xl bg-hero` (placeholder: dimmed photo + "LM" in `h-36 w-36 rounded-full border border-highlight font-display text-6xl text-highlight` + caption "Professional portrait"). Floating credential card `card absolute -bottom-6 left-4 flex items-center gap-3 p-4 shadow-xl sm:-left-5`: `avatar h-11 w-11` with shield-check icon, "**Licensed guide**" + `text-[13px] text-muted-foreground` "Azerbaijan Tourism Board · No. AZ-2014-318".
   - Right: eyebrow `animate-rise delay-1` "About me"; H1 `animate-rise font-display text-5xl font-medium leading-none text-primary delay-2 sm:text-6xl lg:text-[76px]` — "I’m Leyla — and this is the Land of Fire."; two bio paragraphs `text-[17px] leading-relaxed text-foreground/85` (`delay-3`); stat row `mt-10 flex flex-wrap gap-10 animate-rise delay-4`, each value `font-display text-5xl leading-none text-primary` + label `mt-1 text-[13px] text-muted-foreground`: "12" Years guiding, "2,900+" Guests from 41 countries, "940" Tours completed (static, no count-up).
2. **Philosophy quote**: `bg-hero py-24 text-hero-foreground lg:py-32` → `container-x reveal max-w-4xl text-center`; eyebrow (`!text-highlight`) "My travel philosophy"; blockquote `font-display text-3xl italic leading-snug sm:text-[44px]`.
3. **Credentials** (`py-20 lg:py-28`): `container-x grid gap-14 lg:grid-cols-2`, both columns `reveal`. Section H2 style here: `font-display text-4xl font-medium text-primary`.
   - Left: "Qualifications & certifications" — list rows `flex gap-5 border-t py-4`: year `w-14 shrink-0 font-display text-2xl text-eyebrow`, title `font-bold`, issuer `text-sm text-muted-foreground`.
   - Right: "Languages" — rows with name `font-bold` / level `text-muted-foreground` and a bar: `progress h-1.5` containing `h-full rounded-full bg-primary` with inline `width`. Then "Areas of expertise" — `flex flex-wrap gap-2` of `badge badge-outline px-4 py-2 text-sm font-medium`.
4. **Milestones** (`bg-secondary/60 py-20 lg:py-28`): centered H2 `reveal mb-12 text-center font-display text-4xl font-medium text-primary sm:text-5xl` "Milestones along the way". Horizontal timeline `<ol class="grid gap-y-8 border-t border-border sm:grid-cols-2 lg:grid-cols-5">` (the top border is the line); item `reveal relative pr-6 pt-7` with node `absolute -top-[7px] left-0 h-3.5 w-3.5 rounded-full border-[3px] border-secondary bg-primary`, year `font-display text-3xl text-eyebrow`, title `mt-1 font-bold`, text `mt-1 text-sm leading-relaxed text-muted-foreground`. Five columns at `lg` assumes exactly 5 items.
5. **Memorable moments** (`py-20 lg:py-28`): H2 "Memorable moments" + intro `mb-10 max-w-2xl text-[17px] text-muted-foreground`. Story cards `mb-14 grid gap-5 md:grid-cols-3`: `article.card.reveal.p-7` with eyebrow `{{m.w}}` ("Khinalug · 2019"), H3 `mb-3 font-display text-[28px] font-semibold text-primary`, text `text-[15px] leading-relaxed text-foreground/85`. Photo mosaic `grid auto-rows-[200px] grid-cols-2 gap-3 md:auto-rows-[220px] md:grid-cols-4 md:gap-4`: 6 tiles `group overflow-hidden rounded-xl`, tiles 1 and 4 are `row-span-2`; images `img-zoom`, each with a descriptive alt. Not clickable (no lightbox).
6. **CTA band**: `bg-hero py-20 text-hero-foreground` → `container-x flex flex-wrap items-center justify-between gap-8`: H2 `max-w-2xl font-display text-4xl font-medium sm:text-5xl` "Let’s plan something *unforgettable* together."; buttons `btn btn-highlight btn-xl rounded-full` "Explore Experiences", `btn btn-hero-outline btn-xl rounded-full` "Contact Me".

### 4.2 Data shapes

```ts
type Qualification = { y: string /* '2014' */; t: string /* 'Licensed Tour Guide' */; d: string /* issuer: 'Azerbaijan Tourism Board' */ }; // 5; listed in authored order (2014, 2013, 2016, 2018, 2022 — not sorted)
type Language      = { n: string /* 'English' */; lvl: string /* 'Native'|'Fluent'|'Professional' */; w: string /* '92%' bar width */ }; // 4
type Skill         = string;                                   // 8, e.g. 'Silk Road history'
type Milestone     = { y: string; t: string; d: string };      // 5: 2014, 2017, 2020, 2023, 2025
type Moment        = { w: string /* 'Place · Year' */; t: string; d: string }; // 3
```

Static (markup-only) content: portrait, licence body + number, H1, both bio paragraphs, the three headline stats, the philosophy quote, the 6 mosaic images + alts, CTA copy.

---

## 5. My Journey — `Journey.dc.html` → `/journey`

`<title>`: "My Journey — Travel Portfolio — Aurelia Journeys". A travel journal/portfolio with three views of the same entries plus a detail dialog.

State: `{ view:'gallery', dest:'All', open:-1, ph:0, pin:'Sheki' }`.

### 5.1 Sections

1. **Header** (`pb-10 pt-16 lg:pt-24`): `container-x flex flex-wrap items-end justify-between gap-8`. Left `max-w-3xl`: eyebrow `animate-rise` "My Journey · Travel journal"; H1 `animate-rise font-display text-5xl font-medium leading-[0.98] text-primary delay-1 sm:text-7xl lg:text-[80px]` — "Twelve years, *forty-eight* places." (here the `<em>` is `text-eyebrow`, since the surface is light); lede `mt-6 animate-rise text-lg leading-relaxed text-foreground/85 delay-2`. Right: view switch `role="tablist" aria-label="View" class="tabs-list"` with `tabs-trigger px-4` buttons Gallery / Timeline / Map (`aria-selected`).
2. **Destination filter** (`aria-label="Filter by destination"`, `border-b pb-8`): chip rail `no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:px-0`; chip text "{label} <span class="opacity-60">{n}</span>" (entry count per destination).
3. **Content** (`aria-live="polite"`, `pb-28 pt-10`): exactly one of
   - **Gallery** (`isGallery`): CSS-columns masonry `columns-1 gap-6 sm:columns-2 lg:columns-3`; each item a `<button class="group mb-7 block w-full break-inside-avoid animate-rise text-left">` with `aria-label="Open {title}, {date}"`: image `relative block overflow-hidden rounded-xl {{ratio}}` (`img-zoom`), `badge badge-overlay absolute left-3.5 top-3.5` category, optional video marker (`absolute right-3.5 top-3.5 flex h-9 w-9 items-center justify-center rounded-full bg-hero/85 text-hero-foreground` play glyph); meta row `mt-4 flex justify-between gap-3 text-[13px] text-muted-foreground` (location | date); title `mt-1 block font-display text-[26px] font-semibold leading-tight text-primary`; teaser `mt-1 block text-sm leading-relaxed text-muted-foreground`.
   - **Timeline** (`isTimeline`): `mx-auto max-w-4xl`; per year a row `mb-6 flex gap-5 sm:gap-8`: year `w-16 shrink-0 font-display text-4xl leading-none text-eyebrow sm:w-24 sm:text-5xl`; items column `flex flex-1 flex-col gap-5 border-l pb-4 pl-6 sm:pl-8`; each item a `<button class="group relative flex items-center gap-4 text-left sm:gap-5">` with node `absolute -left-[31px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-[3px] border-background bg-primary sm:-left-[39px]`, thumbnail `h-20 w-28 shrink-0 overflow-hidden rounded-lg sm:h-24 sm:w-36`, and text: "{date} · {loc}" (13px muted), title `font-display text-2xl font-semibold text-primary`, teaser `hidden text-sm text-muted-foreground sm:block`.
   - **Map** (`isMap`): `flex flex-col gap-6 lg:flex-row`. Map panel `relative aspect-[4/3] min-w-0 flex-1 overflow-hidden rounded-2xl bg-hero` with a **stylised inline SVG** country outline (not a real map; uses `hsl(var(--highlight))`, `hsl(var(--hero-foreground))` and one raw river colour `#6FA3B5`), caption top-left "Azerbaijan · places I have guided" (`text-xs font-semibold uppercase tracking-[0.24em] text-highlight`), legend bottom-right (`text-xs text-hero-foreground/60`). Pins: absolutely positioned `<button>`s (`min-h-11 min-w-11 -translate-x-1/2 -translate-y-1/2`, inline `left`/`top` %), `aria-pressed`, `aria-label="{name}, {n} entries"`; dot selected `block h-5 w-5 rounded-full bg-highlight ring-8 ring-highlight/30 transition-all`, unselected `block h-3.5 w-3.5 rounded-full bg-hero-foreground ring-4 ring-highlight/20 transition-all group-hover:scale-125`; label selected `whitespace-nowrap text-xs font-bold text-highlight`, unselected `hidden … text-xs font-semibold text-hero-foreground sm:block`. Side card `card w-full overflow-hidden lg:w-80`: image `h-48 w-full object-cover`, body `p-6`: eyebrow region, name `font-display text-3xl text-primary`, "{count} journal entries · last visited {last}", `btn btn-default btn-lg w-full rounded-full` "Show these entries".
   - **Empty** (`empty`): `card border-dashed p-14 text-center text-muted-foreground` "No journal entries for this destination yet."
4. **Entry dialog** (when `modal`): `overlay` (click closes) + `<div role="dialog" aria-modal="true" aria-label="{title}" class="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[92vh] w-full max-w-5xl animate-sheet-bottom overflow-y-auto rounded-t-2xl bg-background sm:bottom-6 sm:rounded-2xl">` — bottom sheet on phones, floating panel from `sm`.
   - Media: image `h-72 w-full object-cover sm:h-[440px]`, alt "{title}, photo {n / total}"; close `btn btn-icon-lg absolute right-4 top-4 rounded-full bg-background/95 hover:bg-background` ("✕"); pager `absolute bottom-4 right-4 flex items-center gap-2`: prev/next `btn btn-icon-lg rounded-full bg-background/95` + counter `badge border-transparent bg-hero/85 px-3 py-1.5 text-hero-foreground` "1 / 3".
   - Body `flex flex-col gap-8 p-6 sm:p-10 md:flex-row`: main column — meta "{loc} · {date} · {cat}", H2 `mb-4 mt-2 font-display text-4xl font-medium text-primary sm:text-5xl`, description, thumbnail strip `grid grid-cols-3 gap-2.5` of buttons `aspect-[4/3] … rounded-lg border-2 border-transparent aria-[current=true]:border-primary` (`aria-label="Show photo N"`). Side column `md:w-72` — eyebrow "Memorable moments" + bulleted list `mb-7 flex list-disc flex-col gap-2 pl-5 text-[15px] leading-relaxed text-foreground/85`; if `cur.rel`: related-tour card `rounded-xl bg-hero p-5 text-hero-foreground` ("Related tour" micro-label `text-highlight`, title `font-display text-2xl`, link "View experience →" → TourDetail).

### 5.2 Interactions and state

| Interaction | Behaviour |
|---|---|
| View tabs | `view ∈ gallery | timeline | map`. Keeps `dest`. |
| Destination chips | `dests = ['All','Baku','Absheron','Gobustan','Sheki','Quba','Lankaran']` (hard-coded list); filter `e.dest === dest`. Counts computed from all entries. Affects Gallery and Timeline; **Map ignores it** (pins always show all destinations) though the chips stay visible. |
| Timeline grouping | Distinct `y` sorted descending; items within a year stay in authored array order (not date-sorted). |
| Map pin | Sets `pin` (default `'Sheki'`); side card shows that destination: `count = entries with dest`, `last = first matching entry's date` (array order; `'—'` if none). "Show these entries" → `{ dest: pin, view: 'gallery' }`. |
| Open entry | `open = original index`, `ph = 0`. |
| Dialog photos | prev/next wrap around (`(ph ± 1) mod photos.length`); thumbnails jump; counter "n / total". |
| Close dialog | overlay click or ✕ → `open = -1`. Not in script: Escape, focus trap/restore, scroll lock, swipe, deep link per entry. |
| Empty state | Gallery/Timeline with zero matches (unreachable with sample data). |
| Video marker | `video:true` only shows a play glyph on the gallery tile; the dialog has no video player. |

### 5.3 Data shapes

```ts
type JournalEntry = {
  title: string;        // 'Autumn in Sheki'
  dest: string;         // filter + map key: 'Sheki' | 'Absheron' | 'Baku' | 'Gobustan' | 'Quba' | 'Lankaran'
  loc: string;          // display location: 'Old City, Baku', 'Khinalug, Quba'
  date: string;         // 'Oct 2026' (preformatted)
  y: number;            // 2026 (timeline grouping)
  cat: string;          // 'Cultural' | 'Adventure' | 'Family' | 'Private'
  ratio: string;        // tile aspect class: 'aspect-[4/5]' | 'aspect-square' | 'aspect-[3/4]' | 'aspect-[16/11]'
  img: string;          // cover
  video: boolean;
  rel: string;          // related tour title (links to tour detail)
  short: string;        // one-line teaser
  desc: string;         // paragraph in dialog
  moments: string[];    // 3 bullets
  photos: string[];     // 3 gallery images
};
type MapPin = { x: string /* '83%' */; y: string /* '52%' */; region: string /* 'Shaki-Zagatala' */; img: string }; // keyed by destination name
```

7 sample entries: Autumn in Sheki (Sheki, Oct 2026, video), Yanar Dag by night (Absheron, Aug 2026), Novruz in Icherisheher (Baku, Mar 2026, video), Mud volcanoes at dawn (Gobustan, Jun 2026), Snow in Khinalug (Quba, Jan 2026), Tea harvest in Lankaran (Lankaran, May 2025, video), Caspian sunset sail (Baku, Sep 2025). Chip counts: All 7, Baku 2, others 1.

---

## 6. Reviews — `Reviews.dc.html` → `/reviews`

`<title>`: "Guest Reviews — Aurelia Journeys".

State: `{ star:0, tour:'all', sort:'new', limit:6 }`.

### 6.1 Sections

1. **Header + summary** (`pb-16 pt-16 lg:pt-24`): eyebrow "Guest reviews"; H1 `mb-12 max-w-3xl font-display text-5xl font-medium leading-none text-primary sm:text-6xl lg:text-7xl` — "In the words of those who travelled with me." (no entrance animation on this page's header). Summary card `card grid gap-8 p-6 sm:p-10 md:grid-cols-[300px_1fr] md:items-center md:gap-14`:
   - Score block `text-center md:border-r md:pr-10`: "4.9" `font-display text-[104px] leading-[.9] text-primary`; stars `mb-1 mt-3 text-2xl tracking-[3px] text-highlight` (`aria-label="Average 4.9 out of 5"`); "**386** reviews · **95%** five-star".
   - Distribution `flex flex-col gap-1`: hint "Rating distribution · select a row to filter"; five row **buttons** `flex min-h-11 cursor-pointer items-center gap-4 rounded-md px-3 text-sm font-medium transition-colors hover:bg-accent aria-pressed:bg-accent`: "{n} star" (`w-14 text-left font-semibold`), bar `progress flex-1` with inner `block h-full rounded-full bg-highlight` (inline width), count `w-10 text-right text-muted-foreground`.
2. **Featured stories** (`aria-labelledby="ft"`, `pb-16`): H2 `mb-6 font-display text-4xl font-medium text-primary`; `grid gap-5 md:grid-cols-2` of two `article.reveal.flex.flex-col.gap-5.rounded-2xl.p-8.sm:p-10` — first on `bg-hero text-hero-foreground` (avatar `bg-highlight text-highlight-foreground`), second on `bg-secondary`. Each: stars, blockquote `font-display text-2xl italic leading-snug sm:text-3xl`, footer `mt-auto flex items-center gap-3` with `avatar h-12 w-12` + "Name · Country" / "Tour · Mon YYYY". Hard-coded in markup.
3. **All reviews** (`aria-labelledby="all"`, `pb-28`):
   - Toolbar `mb-6 flex flex-wrap items-end justify-between gap-5`: H2 "All reviews" + `aria-live="polite"` status "Showing {shown} of {matching} {ratingNote}" (`ratingNote` = "· 4-star only" when a star filter is on); right side two labelled native selects: Tour (`select w-64`, "All tours" + one option per distinct tour) and Sort (`select w-40`: Newest / Highest rated / Lowest rated).
   - Legend `mb-6 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted-foreground`: `badge badge-verified` "✓ Verified booking" — "matched to a completed Aurelia booking"; `badge badge-manual` "✎ Added by guide" — "shared by email or in person, entered manually".
   - Grid `grid items-start gap-5 sm:grid-cols-2 lg:grid-cols-3` of `article.card.flex.animate-rise.flex-col.gap-3.p-6`: author row (`avatar h-11 w-11` initials, name `font-bold`, "Country · Mon YYYY" `text-[13px] text-muted-foreground`); stars `tracking-[2px] text-highlight` ("★★★★☆", `aria-label="4 out of 5 stars"`); H3 title `font-display text-2xl font-semibold text-primary`; body `text-[15px] leading-relaxed text-foreground/85`; optional guest photo `h-40 w-full rounded-lg object-cover` (alt "Guest photo from {tour}"); footer `mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-4`: tour link `text-[13px] font-semibold text-eyebrow underline-offset-4 hover:underline` (→ TourDetail) + provenance badge.
   - Empty: `card border-dashed p-14 text-center text-muted-foreground` "No reviews match these filters yet." + `btn btn-link` "Show all reviews".
   - More: `mt-10 text-center` → `btn btn-outline btn-lg rounded-full` "Load more reviews" (only while `matching > limit`).

### 6.2 Interactions and rules

| Interaction | Behaviour |
|---|---|
| Star row | Toggle: click sets `star = n`, clicking the active row clears it (`0`); resets `limit` to 6. |
| Tour select | `tour = value` (matches on tour **title string**); resets `limit` to 6. |
| Sort | `new`: date desc · `high`: stars desc, then date desc · `low`: stars asc, then date desc. Does not reset `limit`. |
| Load more | `limit += 6` (client-side append; no spinner). |
| Reset ("Show all reviews") | `star = 0`, `tour = 'all'` (keeps sort and limit). |
| Filtering | `(!star || r.stars === star) && (tour === 'all' || r.tour === tour)`. |

Display derivations: date `new Date(d).toLocaleDateString('en-GB', { month:'short', year:'numeric' })` → "Sep 2026"; `starStr = '★'.repeat(stars) + '☆'.repeat(5-stars)`; badge text/class from `v`.

Aggregates are **hard-coded and independent of the list**: average 4.9, total 386, "95% five-star", `counts = {5:367, 4:15, 3:3, 2:1, 1:0}`; bar width = `count / 386 * 100` to 1 decimal (95.1%, 3.9%, 0.8%, 0.3%, 0.0%). The filters operate only on the 10 sample rows (so e.g. the 3-star row shows count 3 but filtering yields the empty state).

### 6.3 Data shape

```ts
type Review = {
  name: string;      // 'Daniel Okafor'
  init: string;      // 'DO'
  country: string;   // 'Canada'
  d: string;         // ISO date '2026-09-18'
  stars: 1|2|3|4|5;
  tour: string;      // tour title (should be a tour reference)
  title: string;     // 'Baku through a historian’s eyes'
  text: string;
  v: boolean;        // true = verified booking, false = added manually by guide
  photo: string;     // image URL or ''
};
// 10 samples: 8 five-star, 2 four-star; 8 verified, 2 manual; 5 with photo
```

---

## 7. Contact — `Contact.dc.html` → `/contact`

`<title>`: "Contact Leyla — Aurelia Journeys". Design prop `simulateError: boolean` (default false) forces the failure path.

State: `{ f:{ name:'', email:'', phone:'', date:'', tour:'', msg:'' }, touched:false, loading:false, sent:false, failed:false }`.

### 7.1 Layout

Single section `pb-28 pt-16 lg:pt-24`: eyebrow "Contact"; H1 `mb-12 max-w-3xl font-display text-5xl font-medium leading-none text-primary sm:text-6xl lg:text-[76px]` — "Let’s talk about your *journey.*" (`<em class="text-eyebrow">`). Then `grid gap-10 lg:grid-cols-[5fr_7fr] lg:gap-14`.

**Left column** (`flex flex-col gap-5`)

1. WhatsApp card (primary channel): `<a class="flex items-center gap-4 rounded-xl bg-primary p-6 text-primary-foreground transition-opacity hover:opacity-95">` — icon disc `h-12 w-12 shrink-0 rounded-full bg-highlight text-highlight-foreground`, "Chat on WhatsApp" (`text-[17px] font-bold`), "Fastest reply · usually within 2 hours" (`text-sm opacity-85`).
2. Details card `card flex flex-col gap-5 p-6 text-[15px]`, each block with micro-label `mb-1 text-xs uppercase tracking-widest text-muted-foreground`:
   - Email → `mailto:` link (`font-semibold text-primary underline-offset-4 hover:underline`)
   - Phone → `tel:` link
   - Service locations → "Baku · Absheron · Gobustan · Sheki · Quba · Khinalug · Shamakhi · Lankaran"
   - Working hours (AZT, UTC+4) → "Mon – Sat · 9:00 – 19:00 / Sunday · WhatsApp only" + live status line `mt-2 flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400` with dot `h-2 w-2 rounded-full bg-emerald-500`: "Currently guiding in Sheki — replies may take a little longer"
   - Social links: `btn btn-outline btn-sm rounded-full` Instagram / YouTube / Facebook (text buttons here, icons in footer)
3. Map placeholder: `relative h-64 overflow-hidden rounded-xl border bg-muted` with decorative SVG streets (`text-border`, `hsl(var(--primary))`), a pin (`text-primary` with `hsl(var(--highlight))` centre) and an info bar `absolute inset-x-4 bottom-4 flex items-center justify-between gap-3 rounded-lg bg-background/95 p-3 text-sm` — "**Icherisheher, Baku** / Google Maps embed" + `btn btn-outline btn-sm` "Open map" (→ `https://maps.google.com/?q=…`). The label says a real Google Maps embed is intended.

**Right column** — either the form or the success panel.

Form (`notSent`): `<form novalidate class="card flex flex-col gap-5 p-6 sm:p-9">`

- Heading: H2 `font-display text-3xl font-medium text-primary` "Send an inquiry" + `mt-1 text-sm text-muted-foreground` "I reply personally within 24 hours."
- Rows are `grid gap-5 sm:grid-cols-2`; every field is a `<label class="flex flex-col gap-2">` with `<span class="label">`.

| Field | Control | Required | Constraints | Error message |
|---|---|---|---|---|
| Name | `input`, `autocomplete="name"` | yes | trimmed length ≥ 2; max 200 chars (input is sliced) | "Please tell me your name." |
| Email | `input type="email"`, `autocomplete="email"` | yes | `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` on trimmed value; max 200 | "Enter a valid email address." |
| Phone *(optional)* | `input type="tel"`, placeholder "+44 7700 900123" | no | max 200; no format check | — |
| Preferred date *(optional)* | `input type="date"` | no | no min/max (past dates allowed) | — |
| Interested tour | `select`; first option value `""` "Not sure yet — help me choose", then 6 tour titles | no | — | — |
| Message | `textarea min-h-[150px]`, placeholder "Tell me who’s travelling, what you love and anything I should know…" | yes | trimmed length ≥ 10; max 1000 (sliced); counter `field-hint ml-auto` "{n} / 1000" | "A short message (10+ characters) helps me prepare." |

- Errors render as `<span class="field-error" role="alert">` under the field and set `aria-invalid="true"` on the control.
- Failure banner (`failed`): `<div role="alert" class="alert alert-destructive">` "Something went wrong sending your message. Please try again or reach me on WhatsApp."
- Submit: `btn btn-default btn-xl rounded-full` (`type="button"`), label "Send message" → "Sending…" with a leading `animate-spin` arc icon; `disabled` while loading.
- Consent line: `text-center text-[13px] text-muted-foreground` "By sending, you agree to the Privacy Policy. I never share your details." (link is a placeholder).

Success panel (`sent`): `<div role="status" class="card animate-rise p-10 text-center sm:p-14">` — check badge `inline-flex h-16 w-16 animate-pop items-center justify-center rounded-full bg-primary text-highlight`; H2 `mb-3 mt-6 font-display text-4xl font-medium text-primary` "Message sent — thank you, {first}." (`first` = first word of the trimmed name); "I’ll reply to {email} within 24 hours. For anything urgent, WhatsApp is quickest."; `btn btn-outline btn-lg rounded-full` "Send another message".

### 7.2 Behaviour

- Validation runs on every render but errors are **hidden until the first submit attempt** (`touched`); after that they update live as the user types.
- Submit: ignored while `loading`; if any error → set `touched` and stop; else `{ loading:true, failed:false }`, then after a simulated **1200ms** → success (`sent:true`) or, with `simulateError`, `{ loading:false, failed:true }` (form stays filled for retry).
- "Send another message" clears all fields, `touched` and `sent`.
- Not in the design: focus-to-first-error, anti-spam (honeypot/captcha/rate limit), explicit consent checkbox, success toast.

### 7.3 Data

No list data in script. Everything on the page except the form is static markup: WhatsApp number, email, phone, service locations, hours + timezone, availability status line, social URLs, map location, response-time promises ("within 2 hours", "within 24 hours"), and the tour options in the select.

```ts
type Inquiry = { name: string; email: string; phone?: string; date?: string /* 'YYYY-MM-DD' */; tour?: string /* tour title or '' */; msg: string };
```

---

## 8. Theme mechanics

### 8.1 How the values are resolved

```js
uiDefault() → { theme:'emerald', mode:'light', radius:'md', font:'classic' }
```

1. **Stored tenant appearance**: `localStorage['aj-ui']` (JSON object, merged over the defaults). Read on mount (`loadUi`), re-read on the window `storage` event, and pushed live through `BroadcastChannel('aj-ui')`. `saveUi(patch)` writes both. In the prototype this is how the admin "Settings & appearance" screen drives every storefront page live — it stands in for a per-tenant settings record.
2. **Per-artboard props** (design-tool overrides, `data-props`): `theme ∈ admin | emerald | caspian | pomegranate | graphite` and `mode ∈ admin | light | dark | system`, both default `admin`. `'admin'` means "use the stored value"; any other value overrides it. There are no props for radius or font.
3. **Dark mode**: `dark = mode === 'dark'`; for `mode === 'system'` it is `matchMedia('(prefers-color-scheme: dark)').matches`, with a `change` listener that forces a re-render.
4. **Output** on the page root: `data-theme={theme}`, `data-font={font}`, `data-radius={radius}`, class `dark` or `light`. All colour, heading font and corner radius changes are then pure CSS keyed off those attributes (stylesheet not available).

Known option sets: themes `emerald` (default), `caspian`, `pomegranate`, `graphite`. Radius and font options are **not enumerated in these six files** (only the defaults `md` and `classic`); `AdminSettings.dc.html` lists radius `none` (Sharp, 2px), `sm` (Subtle, 6px), `md` (Soft, 12px), `lg` (Round, 20px) and heading font `classic`, `modern`, `sans` — confirm in that screen's doc. Which Google font each `data-font` value selects is not determinable here (Cormorant Garamond and Fraunces are both loaded as serif display faces; Manrope is the sans).

Visitors have **no** theme or dark-mode control on these screens (`cycleMode` / `pickTheme` exist in script but are unbound).

### 8.2 Semantic colour tokens referenced

CSS variables are HSL triplets consumed as `hsl(var(--token))` (seen inline for `--highlight`, `--hero-foreground`, `--primary`).

| Token | Utilities seen | Role |
|---|---|---|
| `background` | `bg-background`, `bg-background/90` (header), `bg-background/95` (floating controls), `border-background` (timeline node ring), `hover:bg-background` | Page surface |
| `foreground` | `text-foreground`, `text-foreground/85` (long body copy) | Body text |
| `primary` / `primary-foreground` | `bg-primary`, `text-primary` (all light-surface headings, prices, big numerals), `text-primary-foreground`, `aria-[current=true]:border-primary` | Brand colour; stats band, WhatsApp card, progress fill, active carousel dot |
| `secondary` | `bg-secondary`, `bg-secondary/60` (alternating section tint), `border-secondary` | Soft tinted surface |
| `muted` / `muted-foreground` | `bg-muted`, `text-muted-foreground`, `bg-muted-foreground/40` (inactive dots) | Meta text, placeholders |
| `accent` | `hover:bg-accent`, `aria-pressed:bg-accent` | Row hover/pressed (rating distribution) |
| `border` | default `border`, `border-t`, `border-b`, `border-y`, `border-l`, `border-border`, `text-border` | Hairlines |
| `hero` / `hero-foreground` | `bg-hero`, `bg-hero/50`, `bg-hero/85`, `from-hero/60`, `via-hero/10`, `to-hero/90`, `border-hero`; `text-hero-foreground` at `/60 /70 /75 /80 /85`, `border-hero-foreground/15`, `hover:bg-hero-foreground/10`, `bg-hero-foreground` | **Custom.** Always-dark dramatic surface (hero, scrims, footer, menu sheet, quote/CTA bands, image badges) — stays dark in light mode |
| `highlight` / `highlight-foreground` | `bg-highlight`, `bg-highlight/15` (promo strip), `text-highlight`, `text-highlight-foreground`, `border-highlight`, `border-highlight/30`, `border-highlight/50`, `ring-highlight/20`, `ring-highlight/30` | **Custom.** Accent (gold-like): main CTA fill, stars, italic headline tails on dark, offer badges, count pill |
| `eyebrow` | `text-eyebrow`, class `eyebrow` | **Custom.** Accent text tone legible on light surfaces: eyebrows, years, "View details →", inline links, italic headline tails on light |
| destructive | via `alert-destructive` only | Error banner |
| verified / manual | via `badge-verified`, `badge-manual` only | Review provenance colours (definitions unknown) |

Not referenced in these files: `card`, `popover`, `input`, `ring` utilities directly (presumably used inside component classes).

Non-token colours to resolve: `text-emerald-700 dark:text-emerald-400` + `bg-emerald-500` (Experiences offer line, Contact availability status — raw Tailwind palette, so they stay green under every tenant theme; should become a `success` token), and `#6FA3B5` (river stroke in the Journey map SVG).

Typography scale recap: display H1 52–92px (`leading-[0.98]`/`leading-none`), H2 36/48/56px, card titles 24–28px, body 15–17px, meta 13px, micro-labels 10–12px uppercase with `tracking-widest` to `tracking-[0.32em]`.

---

## 9. Inconsistencies and gaps found in the design

1. **Experiences prices are broken as authored** — catalogue tours lack `tid`, so `listPrice` returns empty strings (blank price, no offer UI, "On offer" filter always empty). See 3.3.
2. Tour data is duplicated with drift: Home has 7 tours, Experiences 9 (Home lacks Khinalug & Quba and Shamakhi Wine Route, although Home's journal and footer reference them); descriptions and `badge` values differ for the same tour (e.g. Baku Food & Wine: `''` vs `'Popular'`); `rating` is a string on Home and a number on Experiences; Contact's tour select lists only 6 tours.
3. `badge` ("Most loved", "Popular", "Featured", "Tailor-made") exists on tours but is never rendered; the top-right badge slot shows the offer instead. Decide whether merchandising badges should appear.
4. Counts are hard-coded copy: "View all 9 experiences", "Nine carefully designed journeys", destination "3 tours", "386 reviews", "4.9", "95%", "12 years", "2,900+", "940", "48", "41 countries", "forty-eight places", "© 2026".
5. Review aggregates (386 / distribution) do not match the 10 listed reviews; filtering by a star row can show a non-zero count but zero results.
6. `filtered` and `activeCount` on Experiences ignore the "On offer" toggle; `activeCount` counts sort order as a filter.
7. `listPrice` ignores `bookAhead` when picking the advertised discount (the 90-day "Early Bird" shows as an unconditional "$300 off per booking"), while `minGuests`/`minChildren` campaigns are demoted to a note.
8. Home promo strip picks the first active campaign by array order; joined tour names read ambiguously when titles contain "&".
9. Every tour link goes to one `TourDetail` page; destination tiles and footer destination links go to unfiltered Experiences; Privacy/Terms link to Contact; social links are bare domains.
10. Journey: Map view ignores the destination filter; "last visited" and timeline order rely on authored order, not dates; `video` has no playback UI; destination list is hard-coded separately from entries.
11. Nav label differs: "Offers" (desktop) vs "Special offers" (mobile, footer); mobile has no count pill. Pages without promo data show a literal offer count of 4.
12. Accessibility gaps to close in implementation: no Escape/focus management on any overlay; the auto-rotating review carousel sits in an `aria-live="polite"` region with no pause control; only the count-up respects reduced motion; Reviews "Load more" does not move focus.
13. Experiences keeps a solid header despite having a dark hero; Home is the only transparent-header page.
14. Dates are pre-formatted strings in most data (`'Oct 2026'`, `'October 2026'`) with mixed formats; only Reviews uses ISO dates. Currency is USD with a hard-coded `$`; locale is fixed (`en-US` numbers, `en-GB` dates).

---

## 10. Implementation notes for multi-tenant mapping

### 10.1 Tenant data (must come from the database)

| Entity | Fields implied by the design | Used on |
|---|---|---|
| **Tenant / brand** | name (split wordmark: primary word + sub-word), tagline/kicker, footer blurb, licence/legal line, copyright name, SEO titles per page | chrome, all pages |
| **Appearance** | `theme`, `mode` (light/dark/system), `radius`, `font` | root attributes (section 8) |
| **Contact channels** | email, phone, WhatsApp number, address/base location + map coordinates or query, working hours + timezone, off-hours note, social links (network, URL), response-time promises, service locations | header, menu, footer, Contact |
| **Availability status** | "now guiding" place, coordinates, season note; "currently guiding in X" status line | Home hero, Contact |
| **Guide profile** | name, portrait, credential line, short bio (Home), long bio paragraphs (About), licence body + number, philosophy quote, languages (name, level, proficiency %), specialisms/skills, headline stats (years guiding, guests, countries, tours completed, places) — ideally computed, not typed | Home, About |
| **Qualifications** | year, title, issuer, order | About |
| **Milestones** | year, title, description, order | About |
| **Moments** | place, year, title, story | About |
| **Gallery images** | image, alt, order/span | About mosaic |
| **Tours** | id/slug, title, place/destination, category, duration (sortable value + display label), base price + currency, description (short), cover image, merchandising badge, popularity score, featured flag/order, rating average + review count (derived), status | Home, Experiences, selects on Contact/Reviews |
| **Categories** | label, order (design: 7 fixed labels + "All") | Home, Experiences |
| **Destinations** | name, region, tagline, cover image, tour count (derived), featured order, map pin x/y or lat/lng | Home bento, footer list, Journey map/filter |
| **Promotions (campaigns)** | name, code, type, value, tour scope, start/end, visibility, assigned emails, minGuests, minChildren, bookAhead, active, blurb | nav count, Home strip, card pricing |
| **Reviews** | author name (initials derived), country, date, stars, title, text, tour reference, verified flag (linked booking vs manual), optional photo, featured flag, published flag; aggregates (average, total, distribution, % five-star) derived | Home carousel, Reviews |
| **Journal entries** | title, destination reference, display location, date, category, cover image + aspect hint, has-video flag, teaser, description, moments[], photos[], related tour reference | Home "Recent adventures", Journey |
| **Value propositions ("why")** | title, description, icon key | Home |
| **Page copy blocks** | hero headline (with emphasised tail), ledes, section eyebrows/headings, CTA labels, final-CTA copy, hero/CTA background images | all pages |
| **Inquiries (write)** | name, email, phone, preferred date, tour reference, message, created at, status | Contact |
| **Legal pages** | privacy policy, terms (not designed) | footer, Contact consent |

### 10.2 Template chrome (same for every tenant)

- Page structure and section order, grid/breakpoint rules, component variants, motion vocabulary.
- Navigation items and routes (labels may need per-tenant wording/voice: "About Me" / "My Journey" assume a single first-person guide; an agency tenant needs "About us" / "Our journeys" — make these configurable or derive from a tenant "voice" setting).
- Filter/sort option sets and their rules (duration buckets, sort keys); price buckets are currency-dependent and should be derived per tenant currency.
- Empty-state, validation and status copy (subject to the same first-person voice concern: "let me design one just for you", "I reply personally").
- Review provenance legend, with the tenant name substituted ("a completed {tenant} booking").
- The stylised SVG map in Journey and the map placeholder in Contact are tenant-specific artwork in the prototype — replace with a real map component or omit when a tenant has no coordinates.

### 10.3 Mapping notes

- Replace `localStorage['aj-ui']`/`['aj-promo']` + `BroadcastChannel` with server-resolved tenant settings and promotions; `promoNow()` becomes the real current date in the tenant timezone, and `campStatus`/`listPrice` should run server-side so prices cannot be tampered with and stay consistent with Booking.
- Theme attributes (`data-theme`, `data-font`, `data-radius`, `dark` class) should be rendered on the server from tenant appearance to avoid a flash; `system` mode still needs a client check.
- `hero`, `highlight`, `eyebrow` (+ their foregrounds) are extra tokens beyond the stock shadcn set and must be defined for every theme × light/dark; add a `success` token for the emerald status text.
- Join tours, reviews, journal entries and destinations by id/slug — the prototype links them by title strings (`rel`, `tour`) or not at all.
- Variable-count content must not rely on fixed layouts: destinations bento assumes 5 tiles, milestones 5 columns, "why" 6 items, recent adventures 4 items with a 7/5/5/7 pattern, review carousel 4 slides, About mosaic 6 images.
- Experiences/Reviews/Journey filter state is local component state in the prototype; URL search params would make filtered views shareable and let footer/destination links deep-link (the design gives no guidance either way).
