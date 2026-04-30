# Project design direction format

The shape of `.claude/specs/design/direction.md`. Written by `/design shape`. Read by `/design polish` and any skill that touches UI.

## Location

```
.claude/specs/design/direction.md
```

One file per project. If the project splits by surface (marketing site vs app), use separate files:

```
.claude/specs/design/direction.md          # shared defaults
.claude/specs/design/marketing.md          # marketing surface
.claude/specs/design/app.md                # product surface
```

Each file has its own `applies_to` patterns so enforce-specs routes correctly.

## Frontmatter

```yaml
---
name: design-direction
description: >
  Design direction for this project. What users should feel, which
  visual language we chose, which constraints are locked. Read before
  any UI work.
applies_to:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.vue"
  - "**/*.svelte"
  - "**/*.html"
  - "**/*.css"
  - "**/*.scss"
category: design
triggers: [design, UI, UX, look, feel, polish, style, component, layout]
---
```

Adjust `applies_to` to match the project's real file patterns. Strip anything the project doesn't use.

## Body sections

Keep each section tight. One or two paragraphs per section, not pages.

### Users

Who uses this. What context. What job they are trying to get done. Include the emotional temperature: confident, calm, urgent, playful, focused.

### Brand voice

Three concrete words. Not "modern" or "elegant". Words like "warm and mechanical and opinionated", "calm and clinical and careful".

### Aesthetic direction

The visual tone in one or two sentences. Reference sites if any. Anti-references. What this should explicitly not look like.

### Theme

Light, dark, or both. Why, based on the user's context when they use this product.

### Typography

Locked font choices if the brand requires them. If fonts are open, name the category of font chosen and why. Scale and hierarchy rules if they diverge from the craft floor.

### Color

Brand primary. Accent strategy. Any locked tokens. Note whether OKLCH is required.

### Motion posture

How aggressive is motion in this product? Three settings: **restrained** (minimal, purpose-driven only), **active** (visible transitions, micro-interactions welcome), **expressive** (scroll choreography, perpetual motion where appropriate).

### Layout rules

Anything specific to this project: grid system, card strategy, density. If the project uses Bento or asymmetric layouts by default, say so.

### Accessibility

WCAG level. Known user needs. Reduced-motion strategy.

### Do not

Project-specific bans. Example: "Never use Geist Mono, the brand uses JetBrains Mono for all monospace."

## Example

```markdown
---
name: design-direction
description: Design direction for Quill, a writing tool.
applies_to:
  - "apps/web/**/*.tsx"
  - "apps/web/**/*.css"
category: design
triggers: [design, UI, style, component]
---

## Users
Writers drafting essays in longer sessions. They want to think clearly and feel unhurried. Primary context: laptop, dedicated writing session, at least 30 minutes at a time.

## Brand voice
Calm, deliberate, hand-made.

## Aesthetic direction
Editorial and literary. References: Kottke.org, The Browser, early Medium. Not: Notion, Linear, any SaaS dashboard.

## Theme
Light default. Dark mode available, not the primary.

## Typography
Body: Source Serif 4 (locked, brand). Display: Söhne Breit. Mono: JetBrains Mono. 1.6 line-height on body. Max 68ch line length.

## Color
Neutrals tinted toward warm (hue 60). Brand accent: deep ink blue (oklch(0.35 0.08 250)). No gradients anywhere.

## Motion posture
Restrained. Animation only for state changes and explicit feedback. Never decorative.

## Layout rules
Single-column reading layout. Max 680px content width. Left-aligned text, asymmetric layouts elsewhere.

## Accessibility
WCAG AA minimum. Focus states visible on everything. Reduced motion honored.

## Do not
- No dark mode by default
- No cards as containers for text
- No sans-serif in body copy
- No shadcn default styles (customize radii to 2px, never 12px)
```
