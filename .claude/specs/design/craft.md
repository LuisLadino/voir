---
name: design-craft
description: >
  Craft floor for UI work. Six topics: correctness (accessibility and
  performance, always blocking), anti-slop (AI-tell patterns to refuse),
  color, typography, layout, motion. Auto-loads on any UI file edit.
  Project design-system.md wins where its rules conflict with the floor.
applies_to:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.vue"
  - "**/*.svelte"
  - "**/*.astro"
  - "**/*.mdx"
  - "**/*.html"
  - "**/*.htm"
  - "**/*.hbs"
  - "**/*.handlebars"
  - "**/*.ejs"
  - "**/*.pug"
  - "**/*.njk"
  - "**/*.liquid"
  - "**/*.erb"
  - "**/*.twig"
  - "**/*.cshtml"
  - "**/*.razor"
  - "**/*.vbhtml"
  - "**/*.aspx"
  - "**/*.ascx"
  - "**/*.xaml"
  - "**/*.storyboard"
  - "**/*.xib"
  - "**/res/layout/**/*.xml"
  - "**/*.css"
  - "**/*.scss"
  - "**/*.sass"
  - "**/*.less"
  - "**/*.styl"
  - "**/*.stylus"
  - "**/*.pcss"
  - "**/*.postcss"
  - "**/scripts/**/*.ts"
  - "**/scripts/**/*.tsx"
  - "**/scripts/**/*.js"
  - "**/scripts/**/*.jsx"
  - "**/scripts/**/*.mts"
  - "**/scripts/**/*.cts"
  - "**/animations/**/*.ts"
  - "**/animations/**/*.tsx"
  - "**/animations/**/*.js"
  - "**/animations/**/*.jsx"
  - "**/motion/**/*.ts"
  - "**/motion/**/*.tsx"
  - "**/motion/**/*.js"
  - "**/motion/**/*.jsx"
  - "**/effects/**/*.ts"
  - "**/effects/**/*.tsx"
  - "**/effects/**/*.js"
  - "**/effects/**/*.jsx"
  - "**/hooks/use*.ts"
  - "**/hooks/use*.tsx"
excludes:
  - "node_modules/**"
  - ".next/**"
  - ".nuxt/**"
  - ".svelte-kit/**"
  - ".output/**"
  - ".angular/**"
  - "dist/**"
  - "build/**"
  - "out/**"
  - "target/**"
  - "coverage/**"
  - "**/vendor/**"
  - "**/*.min.css"
  - "**/*.min.js"
  - "**/*.bundle.css"
  - ".claude/**"
category: design
conformance_rules:
  - name: pure-black-or-white-literal
    pattern: '#(?:000|fff|000000|ffffff)\b'
    message: |
      Pure #000 or #fff literal. craft.md "Color > Bans" forbids these in UI code — use the project's off-black / off-white token, or an oklch() value tinted toward the brand hue.
    applies_to:
      - "**/*.tsx"
      - "**/*.jsx"
      - "**/*.vue"
      - "**/*.svelte"
      - "**/*.astro"
      - "**/*.html"
      - "**/*.htm"
  - name: gradient-text-clip
    pattern: 'background-clip:\s*text'
    message: |
      `background-clip: text` is the top AI design tell when paired with a gradient. craft.md "Color > Bans" forbids gradient text — use weight or size for emphasis, solid colors for text.
    applies_to:
      - "**/*.css"
      - "**/*.scss"
      - "**/*.sass"
      - "**/*.less"
      - "**/*.styl"
      - "**/*.stylus"
      - "**/*.pcss"
      - "**/*.postcss"
      - "**/*.tsx"
      - "**/*.jsx"
      - "**/*.vue"
      - "**/*.svelte"
---

# Design Craft

The craft floor for UI work across any project. Six topics in one spec so enforce-specs loads them together when any UI file is edited. Project `design-system.md` wins where its rules conflict with anything here.

Correctness rules are always blocking. Everything else is craft floor: apply when the project spec is silent, defer when the project spec is explicit.

## Navigation

- **Correctness** — accessibility, performance, always blocking
- **Anti-slop** — AI-tell patterns to refuse
- **Color** — OKLCH, chroma, theme selection, bans
- **Typography** — font selection, scale, line length
- **Layout** — spacing scale, grids, composition
- **Motion** — animation decisions, easing, duration, performance

---

## Correctness

These are not taste. They are correctness. Flag as blocking during polish regardless of project direction.

### Accessibility

**prefers-reduced-motion.** Any animation with movement or position change must have a reduced-motion fallback. Opacity and color transitions can stay.

```css
.modal {
  animation: slide-in 200ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .modal { animation: fade-in 200ms ease; }
}
```

**Touch device hover gating.** Hover states must be gated behind `@media (hover: hover) and (pointer: fine)` or they fire on tap and cause false positives on touch devices.

```css
@media (hover: hover) and (pointer: fine) {
  .button:hover { transform: scale(1.05); }
}
```

**Focus states.** Every interactive element needs a visible focus state. Do not remove the default outline without replacing it. Keyboard users rely on this.

```css
.button:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}
```

**Touch targets.** Minimum 44x44 CSS pixels for any tap target on mobile. Smaller targets fail WCAG and cause mis-taps.

**Contrast.** WCAG AA: 4.5:1 for body text, 3:1 for large text (18pt or 14pt bold). WCAG AAA: 7:1 and 4.5:1. Check contrast in both themes if the project supports dark mode.

### Performance

**Hardware-accelerated properties only.** Animate only `transform` and `opacity`. These skip layout and paint. Never animate `top`, `left`, `width`, `height`, `padding`, `margin`. These trigger layout and drop frames.

**Viewport stability.** Use `100dvh`, not `100vh` or `h-screen`, for full-height sections. `vh` causes layout jumps on iOS Safari when the URL bar hides.

**useEffect cleanup.** Any scroll listener, resize listener, animation frame, or timer inside `useEffect` must have a cleanup function in the return.

```jsx
useEffect(() => {
  const handler = () => { /* ... */ };
  window.addEventListener('scroll', handler);
  return () => window.removeEventListener('scroll', handler);
}, []);
```

**Grain and noise filters.** Apply grain or noise filters only to fixed pseudo-elements with `pointer-events: none`. Never to scrolling containers. Continuous GPU repaint kills mobile performance.

### RSC safety (Next.js)

When a component uses interactive hooks or browser APIs, `useState`, `useEffect`, `useMotionValue`, `IntersectionObserver`, event listeners, it must start with `"use client"` at the top.

Global state providers wrap in a client component. Server components exclusively render static layouts.

### Semantic HTML

Use the right element for the job. A div with `onClick` is not a button. A span with color is not a heading.

- Buttons are `<button>`, not `<div onClick>`
- Links are `<a href>`, not `<div onClick={navigate}>`
- Headings follow document order, `h1` to `h2` to `h3`, no skipping
- Lists are `<ul>` or `<ol>`, not a stack of divs
- Form inputs have `<label>` with matching `for`/`id`

### Image handling

- `alt` text on every `<img>`. Decorative images get `alt=""`.
- `width` and `height` attributes set to prevent layout shift
- `loading="lazy"` on below-the-fold images
- Modern formats, AVIF or WebP, with fallbacks

---

## Anti-slop

Cross-cutting patterns that mark a design as AI-generated. Match and refuse.

**The test.** Show the interface to someone and say "AI made this." Would they believe it immediately? If yes, that is the problem. A distinctive interface makes someone ask "how was this made?" not "which AI made this?"

### Visual tells

**Side-stripe borders greater than 1px.** Pattern: `border-left:` or `border-right:` with a color and width over 1px. On cards, list items, callouts, alerts.

```css
/* Refuse */
.alert { border-left: 4px solid var(--warning); }
```

The single most overused "design touch" in admin, dashboard, and medical UI. Never looks intentional regardless of color, radius, opacity, or variable name. Rewrite with a different structure. Full borders, background tints, leading icons or numbers, or no visual indicator at all. Do not swap to inset box-shadow. That is the same pattern in disguise.

**Gradient text.** Pattern: `background-clip: text` with a gradient background, or the `-webkit-background-clip: text` vendor form.

```css
/* Refuse */
.hero-title {
  background: linear-gradient(to right, #5b5, #5bf);
  -webkit-background-clip: text;
  color: transparent;
}
```

Decorative rather than meaningful. One of the top AI design tells. Use solid color. For emphasis, use weight or size.

**Glassmorphism everywhere.** Blur on every surface. Glass cards. Glow borders used decoratively rather than functionally. Frosted panels on top of frosted panels. Glass has one real use: layered surfaces where the content below should remain visible. Everywhere else it is noise.

**Generic drop shadows on rounded rectangles.** Safe, forgettable, could be any AI output. If you use shadows, tint them toward the background hue. Better still: use borders or elevation through spacing.

**Sparklines as decoration.** Tiny charts next to metrics that convey nothing meaningful. Chart only when the data is real and readable.

**Default dark mode with glowing accents.** Looks cool without requiring design decisions. The strongest AI tell from 2024-2025.

**Default purple/blue gradients and cyan-on-dark.** The AI color palette. Recognized on sight.

### Layout tells

**3-column card row.** Three equal cards horizontally with icon, heading, text. The most overused feature row on the web. Rewrite as a 2-column zig-zag, asymmetric grid, or horizontal scroll.

**Centered hero over dark image.** Stop. Try asymmetric heroes with content aligned left or right, and a high-quality background image fading gracefully into the surface.

**The hero metric template.** Big number. Small label. Supporting stats. Gradient accent. Instantly recognizable.

### Content tells

**Generic fake names.** "John Doe", "Sarah Chan", "Jack Su" are the AI defaults. Use creative, realistic-sounding names.

**Generic fake numbers.** "99.99%", "50%", "1234567", "$99". Use organic messy numbers: "47.2%", "+1 (312) 847-1928", "$47.80".

**Startup slop names.** "Acme", "Nexus", "SmartFlow", "Lumen", "Stellar". Invent contextual brand names that fit the product.

**Filler verbs.** "Elevate", "Seamless", "Unleash", "Next-Gen", "Revolutionary". Use concrete verbs. What does the product actually do?

**Emoji as icons.** Emoji render differently on every platform and OS. Use SVG icons from Phosphor, Radix, Lucide, or a custom set, with a consistent stroke width.

### Component tells

**Lucide "egg" avatar or generic user icon.** Use real photo placeholders or styled initials. `https://picsum.photos/seed/{random}/200/200` is a reliable placeholder.

**Custom mouse cursors.** Outdated. Hurt performance and accessibility.

**shadcn/ui in its default state.** Fine as a starting point. Always customize radii, colors, shadows, and fonts to match the project aesthetic. Default shadcn is a recognizable AI signature.

### The rewrite principle

When you catch a pattern here, do not swap one banned element for a near-neighbor. Rewrite the structure. If the reflex is a gradient, the rewrite is not "less saturated gradient". The rewrite is "solid color with weight for emphasis".

---

## Color

The craft floor for color. Project direction wins if brand colors are locked.

### OKLCH over HSL

HSL is not perceptually uniform. Equal steps in HSL lightness do not look equal. OKLCH does.

```css
:root {
  --brand: oklch(0.65 0.18 250);
  --surface: oklch(0.98 0.005 250);
  --text: oklch(0.22 0.01 250);
}
```

### Reduce chroma at the extremes

High chroma at high or low lightness looks garish. A light blue at 85% lightness wants chroma around 0.08, not the 0.15 of your base color.

### Tint your neutrals toward the brand hue

Even a chroma of 0.005-0.01 on neutrals is perceptible. It creates subconscious cohesion between the brand color and every surface, border, and text color.

```css
/* Neutral gray */
--gray-500: oklch(0.55 0 0);

/* Neutral tinted toward a warm brand hue */
--gray-500: oklch(0.55 0.008 50);
```

Pick the brand's actual hue first, then tint everything toward it. Do not apply a "warm = friendly" or "cool = tech" formula.

### Theme: derive from context

Light vs dark is not a default pick. Ask when and where the product is used, by whom, in what physical setting.

| Context | Theme |
| --- | --- |
| Trading dashboard during fast sessions | Dark |
| Hospital portal, anxious patient, phone, 2am | Light |
| Children's reading app | Light |
| Vintage motorcycle forum, user in garage at 9pm | Dark |
| Observability dashboard, SRE in a dark office | Dark |
| Food magazine, coffee break browsing | Light |
| Music player, headphones at night | Dark |
| Wedding checklist, Sunday morning | Light |

Do not default to light "to play it safe". Do not default to dark "to look cool". Both defaults are the lazy reflex.

### The 60-30-10 rule is about weight

60% neutral surface. 30% secondary text and borders. 10% accent. Accents work because they are rare. Overuse kills them.

### Bans

**No pure black or pure white.** `#000` and `#fff` never appear in nature. Tint slightly:

```css
/* Off-black */
--black: oklch(0.18 0.005 250);

/* Off-white */
--white: oklch(0.99 0.002 250);
```

**No gradient text.** Never combine `background-clip: text` with a `linear-gradient`, `radial-gradient`, or `conic-gradient`. It is one of the top AI design tells. For emphasis, use weight or size. Solid colors only for text.

**No gray text on colored backgrounds.** Washes out. Use a shade of the background color instead.

**No AI color palette.** Avoid cyan-on-dark, purple-to-blue gradients, neon accents on dark backgrounds. The "dark mode with glowing purple accents" aesthetic is the strongest AI tell from 2024-2025.

**No oversaturated accents.** Accents should be desaturated enough to blend with neutrals. Saturation under 80% in HSL terms, chroma under 0.2 in OKLCH.

### Tools

- `oklch` for color values
- `color-mix()` for blends
- `light-dark()` for theme-aware tokens in a single declaration

---

## Typography

The craft floor for type. Project direction wins if it locks fonts to brand.

### Font selection procedure

The default AI failure mode: "I was told not to use Inter, so I'll pick my next favorite." That creates a new monoculture. Run this procedure on every project.

**Step 1. Brand voice in 3 concrete words.** Write 3 words for the brand voice. Not "modern" or "elegant". Those are dead categories. Try "warm and mechanical and opinionated", "calm and clinical and careful", "fast and dense and unimpressed", "handmade and a little weird".

**Step 2. List your reflex picks.** Write down the first 3 fonts you want to reach for. They will probably come from the rejection list below.

**Step 3. Reject the reflex list.** Reject any font that appears below. These are AI training-data defaults. They create monoculture across projects.

```
Inter, DM Sans, DM Serif Display, DM Serif Text
Plus Jakarta Sans, Outfit, Instrument Sans, Instrument Serif
Fraunces, Newsreader, Lora
Crimson, Crimson Pro, Crimson Text
Playfair Display, Cormorant, Cormorant Garamond
Syne, IBM Plex Mono, IBM Plex Sans, IBM Plex Serif
Space Mono, Space Grotesk
Geist, Satoshi, Cabinet Grotesk
Roboto, Arial, Open Sans
```

The last line is added because Geist, Satoshi, and Cabinet Grotesk became the new reflex replacements for Inter in 2025. They now belong on the list.

**Step 4. Browse a real catalog.** With the 3 brand words in mind, look at Google Fonts, Pangram Pangram, Future Fonts, Adobe Fonts, ABC Dinamo, Klim Type Foundry, Velvetyne. Look for a font that fits the brand as a physical object: a museum exhibit caption, a hand-painted shop sign, a 1970s mainframe manual, a fabric label inside a coat, a children's book on cheap newsprint. Reject the first thing that "looks designy". That's the trained reflex.

**Step 5. Cross-check.**
- The right font for an "elegant" brief is not necessarily a serif.
- The right font for a "technical" brief is not necessarily a sans-serif.
- If the final pick lines up with the reflex pattern, go back to Step 4.

### Scale and hierarchy

**Use a modular scale with contrast.** Fewer sizes with more contrast beats many sizes that are 1.1x apart. Aim for a 1.25 ratio minimum between steps. A 5-step scale works well.

**Fluid for marketing, fixed for app UI.** Use `clamp()` for headings on marketing and content pages. Use fixed `rem` scales for app UI and dashboards. No major design system uses fluid type in product UI.

**Line height scales inversely with line length.** Narrow columns want tighter leading. Wide columns want more. For light text on dark backgrounds, add 0.05-0.1 to normal line-height. Light type reads as lighter weight and needs more breathing room.

**Cap body line length at 65-75 characters.** Body text wider than that is fatiguing. Use `max-width: 65ch` on paragraph containers.

### Rules

- Vary font choices across projects. If the last project used a serif display, look for sans, mono, or display this time.
- Pair a distinctive display font with a refined body font. One font family for everything flattens hierarchy.
- Do not use monospace as shorthand for "technical" or "developer" vibes.
- Do not put large icons with rounded corners above every heading. Makes sites look templated.
- Do not set long body passages in uppercase. Reserve all-caps for short labels and headings.
- Serif fonts are fine for editorial or creative designs. They are wrong for dashboards and data-heavy app UI. For those, use a clean sans-serif pair.

---

## Layout

The craft floor for composition, spacing, and grids.

### Spacing scale

Use a 4pt scale with semantic names, not pixel-named tokens.

```css
--space-xs: 4px;
--space-sm: 8px;
--space-md: 12px;
--space-lg: 16px;
--space-xl: 24px;
--space-2xl: 32px;
--space-3xl: 48px;
--space-4xl: 64px;
--space-5xl: 96px;
```

8pt alone is too coarse. You will often want 12px between two values. Avoid `--spacing-8` style names. When the design evolves and 8px needs to become 12px, the token name becomes a lie.

### Gap over margin

Use `gap` for sibling spacing. It eliminates margin collapse and the cleanup hacks that come with it.

```css
.stack { display: flex; flex-direction: column; gap: var(--space-md); }
.row { display: flex; gap: var(--space-lg); }
```

### Vary spacing for hierarchy

Same padding everywhere creates monotony. A heading with extra space above reads as more important. Use that. Rhythm comes from tight groupings next to generous separations. Not uniform spacing.

### Self-adjusting grids

Breakpoint-free responsive grid for card-style content:

```css
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-lg);
}
```

### Container queries for components, viewport queries for layout

A card in a sidebar should adapt to the sidebar's width, not the viewport's. Use `@container` for component-level responsiveness.

```css
.card-wrapper { container-type: inline-size; }

@container (min-width: 400px) {
  .card { grid-template-columns: 1fr 2fr; }
}
```

### Line length

Do not let body text wrap past 80 characters per line. Add `max-width: 65ch` to 75ch on paragraph containers.

### Fluid spacing on large screens

Use `clamp()` so space breathes on wide viewports:

```css
.section { padding-block: clamp(3rem, 8vw, 8rem); }
```

### Viewport stability on mobile

Never use `h-screen` or `100vh` for full-height hero sections. It causes layout jumps on iOS Safari when the URL bar hides. Use `100dvh`.

```css
.hero { min-height: 100dvh; }
```

### Rules

- Do not wrap everything in cards. Not everything needs a container.
- Do not nest cards in cards. Flatten the hierarchy.
- Do not use identical card grids. Same-sized cards with icon, heading, text, repeated endlessly, is the most templated layout on the web.
- Do not use the hero metric template. Big number, small label, supporting stats, gradient accent. Recognizable at a glance.
- Do not center everything. Left-aligned text with asymmetric layouts feels more designed.
- Do not use the same padding everywhere. Without rhythm, layouts feel flat.
- Do not use flexbox percentage math like `w-[calc(33%-1rem)]`. Use CSS grid for reliable structures.

### Breaking the grid

Asymmetry is a design choice, not a mistake. Use it for emphasis:
- Massive empty zones on one side
- Overlapping elements with negative margin
- `grid-template-columns: 2fr 1fr 1fr` instead of `1fr 1fr 1fr`
- Varied aspect ratios within the same row

For asymmetric layouts above `md:` breakpoint, collapse to a single column below 768px. Asymmetry on narrow viewports produces horizontal scroll.

---

## Motion

The craft floor for animation, transitions, and gestures. Project direction wins if it specifies something else.

### The animation decision framework

Answer these before writing animation code.

**1. Should this animate at all?** Gate on frequency.

| How often the user sees this | Decision |
| --- | --- |
| 100+ times a day (keyboard shortcuts, command palette) | No animation ever |
| Tens of times a day (hover, list navigation) | Remove or drastically reduce |
| Occasional (modals, drawers, toasts) | Standard animation |
| Rare (onboarding, celebrations) | Can add delight |

Never animate keyboard-initiated actions. Raycast has no open/close animation. That is correct for something used hundreds of times a day.

**2. What is the purpose?** Every animation needs a clear answer to "why does this animate?"

Valid reasons:
- **Spatial consistency.** Toast enters and exits from the same direction.
- **State indication.** A morphing button shows a state change.
- **Feedback.** A button scales down on press, confirming the interface heard the user.
- **Preventing jarring changes.** Elements appearing without transition feel broken.

If the reason is "it looks cool" and the user sees it often, do not animate.

**3. What easing?**
- Entering or exiting: `ease-out`
- Moving or morphing on screen: `ease-in-out`
- Hover or color change: `ease`
- Constant motion (marquee, progress): `linear`
- Default: `ease-out`

Never use `ease-in` on UI. It starts slow and makes the interface feel sluggish.

Built-in CSS easings are weak. Use custom curves:

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1); /* iOS drawer, from Ionic */
```

**4. How fast?**

| Element | Duration |
| --- | --- |
| Button press feedback | 100-160ms |
| Tooltips, small popovers | 125-200ms |
| Dropdowns, selects | 150-250ms |
| Modals, drawers | 200-500ms |

UI animations stay under 300ms. A 180ms dropdown feels more responsive than a 400ms one.

### Component patterns

**Buttons feel responsive.**

```css
.button { transition: transform 160ms ease-out; }
.button:active { transform: scale(0.97); }
```

Subtle scale, 0.95-0.98.

**Never animate from scale(0).** Nothing in the real world disappears and reappears completely. Start from `scale(0.95)` with `opacity: 0`.

```css
/* Wrong */
.entering { transform: scale(0); }

/* Right */
.entering { transform: scale(0.95); opacity: 0; }
```

**Popovers scale from their trigger.**

```css
.popover { transform-origin: var(--radix-popover-content-transform-origin); }
```

Modals are the exception. Modals stay centered.

**Tooltips skip delay on subsequent hovers.** First tooltip delays to prevent accidental activation. Subsequent tooltips in the same toolbar open instantly.

```css
.tooltip[data-instant] { transition-duration: 0ms; }
```

**CSS transitions over keyframes for interruptible UI.** Transitions can be retargeted mid-animation. Keyframes restart from zero. Toasts, state toggles, rapidly-triggered interactions want transitions.

**Animate enter states with @starting-style.**

```css
.toast {
  opacity: 1;
  transform: translateY(0);
  transition: opacity 400ms ease, transform 400ms ease;

  @starting-style {
    opacity: 0;
    transform: translateY(100%);
  }
}
```

Replaces `useEffect(() => setMounted(true))`. Fall back to the `data-mounted` pattern when browser support matters.

### Springs

Use springs for drag with momentum, elements that should feel alive, interruptible gestures, decorative mouse-tracking. Apple's form is easier to reason about:

```js
{ type: "spring", duration: 0.5, bounce: 0.2 }
```

Keep bounce under 0.3 unless the interaction is explicitly playful.

### Performance

Animate only `transform` and `opacity`. These skip layout and paint, running on the GPU. Animating `padding`, `margin`, `height`, or `width` triggers all three rendering steps.

**Framer Motion gotcha.** Shorthand `x`/`y` props are not hardware-accelerated. They use `requestAnimationFrame` on the main thread. For real hardware acceleration, use the full transform string:

```jsx
// Not hardware-accelerated. Drops frames under load.
<motion.div animate={{ x: 100 }} />

// Hardware-accelerated. Stays smooth under load.
<motion.div animate={{ transform: "translateX(100px)" }} />
```

CSS animations beat JS under load. CSS runs off the main thread. Framer Motion drops frames while the browser loads new content. Use CSS for predetermined animations, JS for dynamic interruptible ones.

### Accessibility

**prefers-reduced-motion.** Reduced motion means fewer and gentler animations, not zero. Keep opacity and color transitions that aid comprehension. Remove movement.

```css
@media (prefers-reduced-motion: reduce) {
  .element { animation: fade 0.2s ease; /* no transform-based motion */ }
}
```

**Touch device hover states.**

```css
@media (hover: hover) and (pointer: fine) {
  .element:hover { transform: scale(1.05); }
}
```

Touch devices trigger hover on tap. Gate hover animations behind this query.

### Stagger

When multiple elements enter together, stagger 30-80ms between them. Longer delays feel slow. Never block interaction while stagger is playing.

### Review checklist

| Issue | Fix |
| --- | --- |
| `transition: all` | Specify exact properties |
| `scale(0)` entry | Start from `scale(0.95)` with `opacity: 0` |
| `ease-in` on UI | Switch to `ease-out` or a custom curve |
| `transform-origin: center` on popover | Use trigger-anchored origin. Modals are exempt. |
| Animation on keyboard action | Remove |
| Duration > 300ms on UI | Reduce to 150-250ms |
| Hover without media query | Add `@media (hover: hover) and (pointer: fine)` |
| Framer `x`/`y` under load | Use `transform: "translateX()"` |
| Same enter and exit speed | Exit faster than enter |
| Elements all appear at once | Add 30-80ms stagger |

---

## Sources

Craft rules adapted from:
- Emil Kowalski, `github.com/emilkowalski/skill`
- Paul Bakaus, `github.com/pbakaus/impeccable`
- Leon, `github.com/Leonxlnx/taste-skill`

Rewritten to match Luis's voice and stay stack-agnostic. The original skills are linked here for deeper material when a project needs it.
