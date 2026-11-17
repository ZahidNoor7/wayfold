# Design reference

A copy of the source design for Wayfold, taken from the claude.ai Design
canvas "Aurelia Journeys — Luxury Tour Guide Website & Admin"
(https://claude.ai/artifact/HUkovXHHKAKiRxYsnNg8Hp). The files mirror the
canvas's `project/` folder unchanged.

| Files | What they are |
| --- | --- |
| `canvas.json` | The canvas index: every artboard, its size and position. |
| `Main`, `About`, `Experiences`, `TourDetail`, `Booking`, `Journey`, `Offers`, `Reviews`, `Contact` | Website pages at desktop width. |
| `AdminOverview`, `AdminBookings`, `AdminPackages`, `AdminPromotions`, `AdminSettings` | Admin (dashboard) screens at desktop width. |
| `MHome`, `MExperiences`, `MTour`, `MBooking`, `MAdmin` | Dedicated mobile flows. |
| `Phone*` (14 files) | The desktop pages shown in a 390 px phone frame. Same code as the desktop page; only the `<title>` and the internal links differ. |

Not included, because the canvas does not publish them: the shared
stylesheet (theme colours and component CSS), `support.js`, and the tour
photos. The colours, type and components are written down in
`docs/design/05-mobile-and-design-system.md` and implemented in
`src/app/themes.css` and `src/app/components.css`. The canvas's own viewer
files (`index.html`, `artifact-type/`) are claude.ai's editor, not part of
the design, and are not copied.

The written analysis of every screen lives in `docs/design/`.
