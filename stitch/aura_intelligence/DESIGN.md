# Design System Document: Aura Patent Intelligence

## 1. Overview & Creative North Star

### Creative North Star: "The Digital Watchtower"
Aura is not just a dashboard; it is a high-fidelity lens into the complex world of intellectual property. The "Digital Watchtower" philosophy balances the rigid authority of legal intelligence with the fluid speed of modern technology. 

To move beyond the standard "SaaS template" look, this design system utilizes **Editorial Precision**. We treat the UI like a premium financial journal—heavy on white space, meticulous with typographic hierarchy, and reliant on tonal depth rather than structural lines. We replace the generic "grid of boxes" with a sophisticated, asymmetrical layout where information breathes and priority is signaled through subtle elevation and light.

---

## 2. Colors

The palette is anchored in authoritative Deep Navy, energized by Electric Blue, and balanced with professional Emerald status indicators. 

### Core Tones
*   **Primary (Electric Blue):** `#0058be` (Main Actions, Radar Elements)
*   **On-Primary:** `#ffffff`
*   **Surface (Dashboard Background):** `#f7f9fb` (Off-white canvas)
*   **Secondary (Deep Navy/Muted):** `#565e74` (Secondary Nav)
*   **Tertiary (Emerald Green):** `#006947` (Success/Active Patents)

### The "No-Line" Rule
Traditional 1px borders are strictly prohibited for sectioning. They clutter the visual field and feel "budget." Instead, boundaries must be defined solely through background color shifts. 
*   **Example:** A card component (`surface_container_lowest`) sitting on a dashboard background (`surface`). The transition between white and off-white creates the edge, not a stroke.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers—like stacked sheets of frosted glass.
*   **Layer 0 (Base):** `surface` (#f7f9fb)
*   **Layer 1 (Card/Widget):** `surface_container_lowest` (#ffffff)
*   **Layer 2 (Inner Detail/Input):** `surface_container_low` (#f2f4f6)

### The Glass & Gradient Rule
To evoke the "Aura" concept, floating elements (modals, tooltips, or primary navigation hovers) should utilize **Glassmorphism**. 
*   **Formula:** `surface_variant` at 70% opacity + 12px Backdrop Blur.
*   **Signature Texture:** Use a subtle linear gradient from `primary` (#0058be) to `primary_container` (#2170e4) on primary action buttons to give them a "lit from within" tech-forward feel.

---

## 3. Typography

Aura uses a dual-typeface system to bridge the gap between technical data and executive summary.

*   **Display & Headlines (Manrope):** Used for "The Narrative." Manrope’s geometric but warm curves provide a high-tech, editorial feel. 
    *   *Headline-LG (2rem):* For page titles (e.g., "Patent Portfolio Analysis").
*   **Body & Labels (Inter):** Used for "The Data." Inter provides maximum legibility for patent numbers, legal dates, and tabular content.
    *   *Body-MD (0.875rem):* Standard reading text.
    *   *Label-SM (0.6875rem):* Caps/Tracking +5% for metadata and status badges.

The hierarchy is intentionally dramatic. We use large `display-sm` titles (2.25rem) contrasted against tiny, precise `label-md` metadata to create a "sophisticated scale" that mirrors high-end architectural magazines.

---

## 4. Elevation & Depth

We eschew traditional drop shadows in favor of **Tonal Layering**.

*   **The Layering Principle:** Depth is achieved by stacking surface tiers. To make a widget "pop," don't add a shadow; simply move it from `surface` to `surface_container_lowest`.
*   **Ambient Shadows:** If a floating element (like a radar popover) requires a shadow, it must be "Atmospheric."
    *   *Values:* `0px 20px 40px rgba(15, 23, 42, 0.06)`
    *   The shadow should be a tinted version of the `on-surface` color to mimic natural light.
*   **The "Ghost Border" Fallback:** If a border is required for accessibility, use `outline_variant` at **20% opacity**. It should be felt, not seen.
*   **Corner Radii:** Consistent use of `md` (0.75rem / 12px) for cards and `sm` (0.25rem / 4px) for small interactive elements like checkboxes to maintain a modern, approachable tech aesthetic.

---

## 5. Components

### Buttons
*   **Primary:** Linear gradient (`primary` to `primary_container`), `md` rounding, white text. No border.
*   **Secondary:** `surface_container_high` background with `primary` text. Provides a "soft" alternative for secondary actions.

### Input Fields
*   **Style:** No bottom line or heavy border. Use `surface_container_low` background with a subtle `outline_variant` (20% opacity). On focus, the background shifts to `surface_container_lowest` (pure white) with a 2px `primary` left-accent.

### Cards & Lists (The "Aura" List)
*   **Rule:** Forbid divider lines between list items.
*   **Implementation:** Use `8` (2rem) of vertical white space from the Spacing Scale to separate entries. For interactive lists, use a subtle hover state shift to `surface_container_high`.

### Patent Radar Widget (Custom Component)
A circular visualization using `tertiary` (Emerald) for active patents and `primary` (Blue) for monitored ones. Use a `0.5px` stroke for the radar rings to maintain an "instrumentation" feel.

---

## 6. Do's and Don'ts

### Do:
*   **Do** use asymmetrical spacing. Allow a wider margin on the left than the right to create an editorial "gutters" look.
*   **Do** use `primary_fixed_dim` for background accents in data viz to keep the "tech" feel muted and professional.
*   **Do** prioritize "Breathing Room." If you think a widget needs more space, use the next step up in the Spacing Scale (`10` or `12`).

### Don't:
*   **Don't** use pure black (#000000) for text. Use `on_surface_variant` (#424754) for body text to reduce eye strain and maintain the "premium matte" feel.
*   **Don't** use 100% opaque borders to separate the sidebar from the main content. Use a background shift from `on_secondary_fixed` (Deep Navy) to `surface` (Off-white).
*   **Don't** use "Default Blue" for links. Use the `primary` token (#005ac2) to ensure brand alignment and accessibility.