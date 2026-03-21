# Design System Strategy: The Intellectual Monolith

## 1. Overview & Creative North Star
This design system is built upon the North Star of **"The Intellectual Monolith."** Unlike standard SaaS platforms that rely on busy grids and heavy borders, this system treats information as a curated gallery. It mimics high-end editorial layouts through intentional asymmetry, massive breathing room, and a rigid adherence to tonal depth over structural lines. 

The goal is to move from "User Interface" to "Knowledge Environment." By using extreme typographic contrast and layered surfaces, we signal to the user that Aura Patent Intelligence is not just a tool, but an authoritative, high-precision partner. We break the "template" look by allowing elements to overlap slightly and by utilizing whitespace as a functional component, not just a gap.

---

## 2. Color Strategy & Surface Logic
The palette moves away from generic tech blues into a world of slate grays (`secondary`), bone whites (`surface`), and a singular, commanding Deep Emerald (`primary`).

### The "No-Line" Rule
Standard 1px solid borders are strictly prohibited for sectioning. To define a boundary, you must use a background color shift. 
*   **Example:** A sidebar should not have a border; it should be a `surface-container-low` (`#f0f4f7`) block sitting against a `surface` (`#f7f9fb`) background.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. Use the `surface-container` tiers to create "nested" depth.
*   **Level 0 (Base):** `surface` (#f7f9fb)
*   **Level 1 (Sections):** `surface-container-low` (#f0f4f7) 
*   **Level 2 (Cards/Interaction):** `surface-container-lowest` (#ffffff) to provide a "pop" of clarity.
*   **Level 3 (Floating/Overlays):** `surface-bright` with 80% opacity and a 20px backdrop-blur (Glassmorphism).

### Signature Textures
To add "soul" to the precision, main CTAs and Hero sections should utilize a subtle linear gradient:
*   **Primary Gradient:** From `primary` (#3a665d) to `primary_dim` (#2e5a51) at a 135-degree angle. This prevents the emerald from feeling "flat" and adds a metallic, premium sheen.

---

## 3. Typography: The Editorial Voice
We use a dual-font strategy to balance authority with utility.

*   **The Structural Voice (Manrope):** Used for `display` and `headline` tokens. Manrope's geometric yet approachable nature provides the "Intelligent" personality. Use `display-lg` (3.5rem) with tighter letter-spacing (-0.02em) for a high-end editorial feel.
*   **The Functional Voice (Inter):** Used for `title`, `body`, and `label` tokens. Inter provides "Precision." 

**Hierarchy Tip:** Always pair a `display-md` headline with a significantly smaller `body-md` description. The high contrast in scale is a hallmark of premium, bespoke design.

---

## 4. Elevation & Depth
In this system, elevation is a whisper, not a shout. We replace traditional shadows with **Tonal Layering**.

*   **The Layering Principle:** Rather than adding a shadow to a card, place a `surface-container-lowest` (#ffffff) card on a `surface-container` (#e8eff3) background. The contrast in light provides the necessary lift.
*   **Ambient Shadows:** For floating modals or dropdowns, use a shadow with a 40px blur and 4% opacity. The shadow color must be a tinted version of `on_surface` (#2a3439), never pure black.
*   **The "Ghost Border" Fallback:** If a border is required for accessibility (e.g., in high-density data tables), use `outline_variant` (#a9b4b9) at **15% opacity**. It should be felt, not seen.

---

## 5. Component Guidelines

### Buttons (The Precision Triggers)
*   **Primary:** Uses the Primary Gradient. Radius: `md` (0.375rem). Text: `label-md` uppercase with 0.05em tracking.
*   **Secondary:** No background. Use a "Ghost Border" (outline-variant at 20%) and `on_surface` text.
*   **Tertiary:** Purely typographic. Use `primary` (#3a665d) text with a 1px underline that appears only on hover.

### Input Fields
*   **Style:** Minimalist. No background color—only a bottom border of 1px using `outline_variant` (#a9b4b9). 
*   **Focus State:** The bottom border transitions to `primary` (#3a665d) and thickens to 2px. The label floats upward using `label-sm`.

### Cards & Lists
*   **The Divider Ban:** 1px horizontal lines between list items are forbidden. Use vertical spacing (e.g., `spacing-4` / 1.4rem) to create separation.
*   **Patent Cards:** Use `surface-container-low` as a base. Anchor the Patent ID in `label-sm` using the `tertiary` (#4a4bd7) color as a small highlight to signify "Intelligence."

### Search & Intelligence Bars
*   For the core search experience of Aura, use **Glassmorphism**. 
*   Background: `surface_container_lowest` at 70% opacity.
*   Effect: `backdrop-filter: blur(12px)`. This makes the search bar feel like it’s floating above the data.

---

## 6. Do’s and Don’ts

### Do:
*   **Embrace Asymmetry:** Align a headline to the left and the supporting body text to a column on the right. 
*   **Use Generous Padding:** If you think a container has enough padding, add `spacing-2` (0.7rem) more.
*   **Tint Your Neutrals:** Use `surface_container_highest` (#d9e4ea) for backgrounds of complex data sets to keep the eye cool and focused.

### Don’t:
*   **Don't use 100% Black:** Use `on_background` (#2a3439) for text to maintain a sophisticated, soft-contrast look.
*   **Don't use Standard Shadows:** Avoid any shadow that is "heavy" or has a 0px spread. Shadows must be ambient.
*   **Don't use Rounded Corners over 8px:** We are building a professional tool, not a consumer social app. Keep the `md` (0.375rem) or `lg` (0.5rem) radius for a "refined" edge.

---

## 7. Spacing & Rhythm
All layouts must follow the spacing scale. For section-level breathing room, default to `spacing-12` (4rem) or `spacing-16` (5.5rem). High-end design is defined by the confidence to leave space empty.