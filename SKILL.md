---
name: editorial-intelligence-ui
description: Use when designing or implementing a website, web app, dashboard, workbench, report, dossier, or chat interface that should match the MGS Intel aesthetic: warm archival paper, editorial typography, ruled institutional layouts, evidence metadata, rust-red signals, and sharp rectangular controls.
---

# Editorial Intelligence UI

Create interfaces in the same visual language as the MGS Intel assessment desk. Treat this as a reusable design system, not a screenshot to clone. Preserve the visual character while adapting labels, information architecture, density, and controls to the new product's actual job.

Do not reuse the MGS name, its copy, its source material, or domain-specific concepts unless the user explicitly asks for them.

## Design Thesis

Build a digital institutional workbench that feels like an archival dossier, an editorial page, and a precise analytical instrument at once.

The interface should feel:

- Serious without being bureaucratically dull
- Tactile without using skeuomorphic decoration
- Editorial without looking like a magazine template
- Technical without defaulting to a dark developer dashboard
- Dense where evidence matters and spacious where hierarchy matters
- Trustworthy because provenance, state, limits, and metadata stay visible

The signature contrast is warm paper against near-black rules, with rust red reserved for actions and attention. Large geometric headlines create confidence. Small monospaced labels create procedural precision. Thin borders organize the page more often than floating cards do.

## Non-Negotiable Signature

Include all of these unless the product makes one genuinely inappropriate:

1. A warm paper canvas with faint horizontal ruling.
2. Space Grotesk Variable for display text and Instrument Sans Variable for body/UI text.
3. A third typographic voice using the native system monospace stack for indices, states, counts, provenance, and machine-readable details.
4. Near-black 1px structural rules and square corners.
5. A restrained rust-red signal color for primary actions, active rails, and key indices.
6. At least one hard 10px offset shadow on a major work surface, never a soft floating-card shadow.
7. Oversized, tightly tracked display headings paired with tiny uppercase metadata.
8. Numbered or named editorial markers such as `SOURCE / 01`, `RECORD / 02`, or `FINDING / 00` where sequence is meaningful.
9. Visible operational states, limits, counts, or provenance where the interface performs consequential work.
10. Responsive layouts that reorganize into a coherent vertical document rather than merely shrinking.

If these signatures are absent, the result will drift toward generic SaaS.

## Design Tokens

Use this palette as the default. Add colors only when the product has a semantic state not represented here.

| Role | Value | Use |
| --- | --- | --- |
| Ink | `#17201d` | Text, structural borders, dark panels, user messages |
| Paper | `#f7f4ec` | Main work surfaces |
| Deep paper | `#e9e5da` | Page canvas |
| White paper | `#fffdf7` | Inputs, quotations, nested records |
| Rule | `#aca99f` | Secondary dividers and field borders |
| Muted | `#62665f` | Descriptions and secondary metadata |
| Signal | `#a34527` | Primary actions, active rails, indices, errors |
| Signal hover | `#84351d` | Hover state for signal controls |
| Support | `#225d48` | Positive/cited/supported states |
| Warning | `#9a5c16` | Disclosures, caution, external information |
| Quiet | `#59686d` | Neutral/no-finding states |
| Focus | `#e7a978` | Keyboard focus outline |

Use these semantic tints:

- Support field: `#e1eee8` or `#e6eee9`
- Conflict/error field: `#f5e4da`
- Neutral field: `#e9edef` or `#eeece5`
- Warning disclosure: `#f4eadc`
- Ruled inset field: `#efede6`
- Text on ink: `#d9ddd7`
- Warm accent on ink: `#eaa27e`

Do not turn the palette into a rainbow. Most of the viewport should remain deep paper, paper, white paper, ink, and rules. Semantic colors should identify meaning rather than decorate.

## Typography

### Font Loading

Use the variable fonts when the stack allows local packages:

```sh
pnpm add @fontsource-variable/instrument-sans @fontsource-variable/space-grotesk
```

```ts
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/space-grotesk";
```

Define these stacks:

```css
--font-display: "Space Grotesk Variable", ui-sans-serif, system-ui, sans-serif;
--font-sans: "Instrument Sans Variable", ui-sans-serif, system-ui, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
```

### Roles

- Display: Space Grotesk, usually weight 400-600, with tight tracking. Use for hero titles, report summaries, section titles, quotations, and long-form input text.
- Interface/body: Instrument Sans, usually weight 400-700. Use for controls, descriptions, disclosures, and supporting prose.
- Procedural metadata: system monospace, usually 9-11px, uppercase, with `0.04em` to `0.16em` letter spacing. Use for indices, states, counts, digests, timestamps, labels, and statuses.

Use typography by meaning, not merely size. A tiny mono label says "system record." A large display sentence says "editorial conclusion." Instrument Sans says "operate or read this interface."

Recommended scale:

- Hero: `clamp(48px, 7vw, 104px)`, line-height `0.94`, tracking `-0.055em`
- Large section title: `clamp(38px, 5vw, 68px)`
- Secondary feature title: `clamp(34px, 4vw, 58px)`
- Sheet title: `clamp(25px, 2.4vw, 34px)`
- Summary statement: `clamp(21px, 2.3vw, 31px)`, line-height around `1.4`
- Reading/quotation text: 16-18px, line-height `1.5-1.65`
- Body descriptions: 12-15px, line-height `1.45-1.55`
- Metadata: 9-11px, often uppercase

Avoid semibold text everywhere. Let typeface, scale, spacing, and rules establish hierarchy before increasing weight.

## Canvas And Rhythm

The canvas is a quiet ruled sheet:

```css
body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  color: var(--ink);
  background:
    linear-gradient(rgba(23, 32, 29, 0.035) 1px, transparent 1px),
    var(--paper-deep);
  background-size: 100% 32px;
}
```

Use a broad centered shell:

```css
.app-shell {
  width: min(1500px, calc(100% - 48px));
  min-height: 100vh;
  margin: 0 auto;
}
```

Compose pages in three density bands:

1. Open editorial space for the masthead and oversized title.
2. Compact ruled work surfaces for inputs and controls.
3. Structured evidence or report surfaces for output.

Recommended vertical rhythm:

- Masthead minimum height: 84px
- Hero top padding: `clamp(56px, 8vw, 116px)`
- Hero bottom padding: roughly 54px
- Major panel padding: `clamp(24px, 3vw, 54px)`
- Major output separation: 38px above and about 100px below

Do not fill the hero with badges, supporting cards, gradients, or multiple calls to action. A single decisive title often creates the strongest opening.

## Structural Grammar

### Rules Before Cards

Use 1px rules to define regions. Prefer joined layouts with shared borders over collections of detached cards. A major surface may use:

```css
.work-surface {
  border: 1px solid var(--ink);
  border-radius: 0;
  background: var(--paper);
  box-shadow: 10px 10px 0 rgba(23, 32, 29, 0.11);
}
```

Nested items use `var(--rule)` and `var(--paper-white)` without shadows. Reserve the hard shadow for major work surfaces so it keeps its visual authority.

### Editorial Index Row

Introduce consequential sections with a procedural marker and a line that fills the remaining width:

```html
<div class="sheet-heading">
  <span class="sheet-index">SOURCE / 01</span>
  <span class="sheet-rule" aria-hidden="true"></span>
</div>
```

```css
.sheet-heading {
  display: flex;
  gap: 16px;
  align-items: center;
  margin-bottom: 34px;
}

.sheet-index {
  color: var(--signal);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

.sheet-rule {
  width: 100%;
  height: 1px;
  background: #c9c5bb;
}
```

Index labels must carry real structure. Do not scatter fake serial numbers as decoration.

### Vertical Rails

For a comparison, drawer, mode, or stage boundary, use a narrow 58px rail with rotated mono text. Use signal red for an actionable or active rail and ink for a fixed relationship marker. On narrow screens, turn the rail into a horizontal 42px bar and restore normal text orientation.

### Hard Divisions

Use full-width dark bands for caveats, limitations, or terminal notes. A dark band should feel like a report footer, not a promotional banner.

## Page Anatomy

A representative page sequence is:

1. Thin masthead with a compact letter-spaced wordmark and optional operational status.
2. Large, nearly unadorned title field.
3. Bordered workbench containing the main task.
4. Action rail joined to the workbench rather than floating below it.
5. Live status/error region with reserved space to prevent layout jumps.
6. Empty ruled placeholder or completed dossier.
7. Small monospaced footer divided from the page by a dark rule.

Adapt this sequence to the product. A landing page may use a project ledger instead of a workbench. A dashboard may use a register and report panes. Preserve the hierarchy: identity, declaration, work, state, record.

## Component Language

### Masthead And Wordmark

- Use a bottom ink rule, not a shadow.
- Keep the wordmark around 14px, weight 800, tracking around `0.2em`.
- Separate wordmark parts with a 32px rust-red line rather than a logo icon when no established mark exists.
- Keep system status small, uppercase, and monospaced with an 8px outlined/filled dot.

### Inputs

- Use square corners and warm white backgrounds.
- Use `1px solid #b8b4aa` for primary fields.
- Large text areas use display type at 17px and line-height around 1.65.
- Place measurements, limits, or save state directly beneath fields in a split mono metadata row.
- Use italic muted placeholders sparingly.
- On invalid limits, turn relevant metadata signal red and increase weight; do not rely on color alone in the text or semantics.

### Buttons

- Primary: signal-red fill, warm-white text, square corners, mono uppercase label, spacious horizontal layout, optional plain arrow glyph.
- Secondary: transparent with a 1px ink border; invert to ink/paper on hover.
- Tertiary: text only with a 1px underline.
- Destructive: neutral until hover, then a pale conflict tint and signal-red text.
- Disabled: neutral gray fill or reduced opacity, `not-allowed` cursor, and no active hover inversion.

Do not use pill buttons, glossy gradients, floating circular icon buttons, or excessive icons. Prefer words and simple glyphs such as `+`, `-`, and a directional arrow.

### Collections And Records

- Stack records with a 10-18px gap.
- Use a ruled white-paper container for each nested record.
- Give each record a two-digit mono order marker, a concise title, a small byte/count/status line, and an explicit expansion mark.
- Put secondary or destructive actions in a border-separated edge cell.
- Use native `details`/`summary` when the disclosure model fits.

### Action Rail

Join actions to the bottom of the main work surface with a top ink rule. Put utility controls on the left and the main action as a full-height signal block on the right. The primary block may use a left border and a minimum width around 280px on desktop. Stack it beneath controls on mobile with a top border and at least 68px height.

### Empty States

Avoid a generic centered illustration. Use a quiet ledger row with top and bottom rules, a mono placeholder index, a large display sentence, and a short right-aligned explanation. Collapse those into a left-aligned vertical stack on mobile.

### Dossiers And Reports

Build outputs as a document, not a dashboard card grid:

- Header row: eyebrow/index plus large report title, with an outlined semantic conclusion stamp.
- Summary row: a large display rationale and a right-aligned mono identifier stack.
- Evidence body: an asymmetric two-column split such as `0.9fr 1.1fr`.
- Citations: white-paper blockquotes with a rust-red number in a fixed left gutter.
- Evidence: neutral strips with a 3px left rule; cited/supporting evidence turns pale green with a support-green rule.
- Terms/tags: tiny square mono labels with thin borders, never pills.
- Integrity details: a native disclosure containing two-column definition-list rows.
- Limitations: a full-width ink panel with warm accent label and compact body text.

### Chat

If the product includes chat, make it look like an evidence desk rather than a consumer messenger:

- Put chat in its own bordered paper work surface with the same hard offset shadow.
- Use a ruled gray thread background at a slightly tighter 28px rhythm.
- Assistant messages: warm white, left rust-red rule, max width around 78%.
- User messages: ink background, paper text, right ink rule, aligned right.
- Message role, answer state, and citation labels use tiny uppercase mono.
- Quotations and citations use support green and pale green fields.
- External or web-derived material uses warning ochre and remains visually separate from primary evidence.
- Keep the composer rectangular and joined beneath the thread with an ink rule.

## Semantic Color Rules

Use color consistently across every component:

- Rust red means action, active navigation, attention, conflict, or error.
- Green means supported, cited, verified, or materially connected.
- Ochre means caution, disclosure, remote transfer, or external information.
- Blue-gray means neutral, unavailable, or no finding.
- Ink means authority, structure, user-authored content, or a terminal section.

Never use green merely because something is "complete" if the completion has no support/verification meaning. Never use rust red as broad decoration across every panel.

## Content Voice

Write like a careful analyst or records officer, not a growth marketer.

- Prefer direct labels: "Run assessment," "Upload document," "Clear desk," "Integrity and method record."
- State what happens to user data and which system is acting.
- Surface exact units and constraints: bytes, code points, passages, records, timestamps, or limits.
- Use words such as source, record, finding, trace, method, reference, material, advisory, and disclosure only when they accurately describe the domain.
- Keep descriptions short, factual, and calm.
- Avoid exclamation marks, hype, anthropomorphic AI claims, and vague labels such as "Magic," "Supercharge," or "Get started."
- Use two-digit counts where they reinforce the ledger aesthetic, such as `01`, `02`, and `00`.

Do not force assessment terminology onto unrelated products. Translate the voice into that product's real nouns: inventory, brief, case, specimen, issue, archive, dispatch, or ledger.

## Motion

Motion is procedural, not theatrical.

- Smooth page scrolling is acceptable.
- A checking status dot may pulse with a stepped 1.2s opacity animation.
- Drawers and responsive layout changes may switch directly without spring effects.
- Avoid floating, bobbing, parallax, animated gradients, entrance cascades, and decorative loading skeletons.
- Honor `prefers-reduced-motion`; disable smooth scroll and status animation.

## Responsive Behavior

Use two primary breakpoints as a starting point: 900px and 560px.

At 900px and below:

- Reduce shell gutters to 14px per side with `width: min(100% - 28px, 760px)`.
- Collapse multi-column workbenches and reports to one column.
- Turn vertical 58px rails into horizontal bars at least 42px high.
- Remove rotated writing modes.
- Stack the action rail and move the primary action to a full-width 68px row.
- Remove interior vertical borders and replace them with bottom borders.
- Stack report summaries and left-align identifier metadata.
- Allow chat messages to occupy around 90% width.

At 560px and below:

- Reduce the masthead to around 72px.
- Keep the hero dramatic with `clamp(44px, 15vw, 64px)` rather than making it ordinary body scale.
- Reduce panel padding to roughly 18-22px.
- Let chat messages use full width.
- Stack headings, tool rows, metadata pairs, and report headers where needed.
- Reduce text-area padding and minimum height, but keep controls comfortable.
- Convert definition-list and limitations grids to one column.
- Stack footer lines.

Test at 320px, 560px, 900px, a typical laptop width, and the 1500px maximum shell. Long identifiers and URLs must wrap without creating horizontal overflow.

## Accessibility And Operational UX

The aesthetic depends on precision, so accessibility is part of it:

- Use semantic headings, sections, articles, blockquotes, forms, labels, definition lists, and details elements.
- Every icon-only or context-dependent control needs an accessible name.
- Connect drawers and disclosures with `aria-expanded` and `aria-controls`.
- Expose busy state with `aria-busy` and changing status with `aria-live` or `role="status"`.
- Use `role="alert"` for errors that require immediate attention.
- On asynchronous result creation, focus the new result heading with `tabindex="-1"`.
- Return focus to the opening control when a transient panel closes.
- Use a 3px `#e7a978` focus-visible outline with a 3px offset.
- Keep hidden accessibility text available with a standard visually-hidden utility.
- Disable all conflicting inputs during consequential operations rather than allowing ambiguous concurrent edits.
- Pair semantic color with text, borders, labels, or structure.

Do not remove native focus treatment unless the replacement is stronger and clearly visible on every surface.

## Foundation CSS

Start from this foundation and extend it according to the product rather than copying unrelated components:

```css
:root {
  color: #17201d;
  background: #e9e5da;
  font-family: "Instrument Sans Variable", ui-sans-serif, system-ui, sans-serif;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  --ink: #17201d;
  --paper: #f7f4ec;
  --paper-deep: #e9e5da;
  --paper-white: #fffdf7;
  --rule: #aca99f;
  --muted: #62665f;
  --signal: #a34527;
  --signal-hover: #84351d;
  --support: #225d48;
  --warning: #9a5c16;
  --quiet: #59686d;
  --focus: #e7a978;
  --font-display: "Space Grotesk Variable", ui-sans-serif, system-ui, sans-serif;
  --font-sans: "Instrument Sans Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --hard-shadow: 10px 10px 0 rgba(23, 32, 29, 0.11);
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  background:
    linear-gradient(rgba(23, 32, 29, 0.035) 1px, transparent 1px),
    var(--paper-deep);
  background-size: 100% 32px;
}

button,
input,
select,
textarea {
  font: inherit;
}

button,
select {
  color: inherit;
}

button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
summary:focus-visible,
a:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 3px;
}

h1,
h2 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 500;
  letter-spacing: -0.055em;
}

textarea,
input,
select,
button {
  border-radius: 0;
}

.eyebrow,
.metadata {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.eyebrow {
  color: var(--signal);
  font-weight: 700;
}

.major-surface {
  border: 1px solid var(--ink);
  background: var(--paper);
  box-shadow: var(--hard-shadow);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
  padding: 0;
}

@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }
}
```

## Implementation Workflow

1. Read the target product's requirements and identify its authoritative nouns, primary task, output, system states, and consequential disclosures.
2. Preserve any established project architecture and accessibility conventions. Apply this aesthetic within the existing stack instead of rewriting the app unnecessarily.
3. Define the token layer and load the two fonts before styling individual components.
4. Sketch the page as large ruled regions: identity, declaration, work surface, state, record, footer.
5. Assign each text element one semantic type role: display, interface/body, or procedural mono.
6. Build the desktop information architecture with joined borders and only a few major shadowed surfaces.
7. Add states for empty, loading, disabled, invalid, error, success/support, warning/disclosure, and long-content overflow.
8. Implement the 900px structural collapse and 560px compact pass. Do not postpone responsive behavior.
9. Add focus management, live announcements, reduced motion, and semantic markup.
10. Verify the result against the checklist below and remove generic UI decoration that weakens the editorial system.

## Anti-Patterns

Reject these unless an existing product system explicitly requires them:

- White or gray generic SaaS canvas
- Dark-mode-first developer dashboard styling
- Blue or purple gradient hero treatments
- Rounded cards, pill badges, and pill buttons
- Soft multi-layer shadows on every panel
- A grid of interchangeable floating statistic cards
- Excessive icons, icon-only controls, or decorative illustrations
- Glassmorphism, blur, translucency, or glowing accents
- Monospace for all text
- Tiny timid hero headings
- Centering every section and all body copy
- Color without semantic meaning
- Hiding method, limits, provenance, or operational state to make the UI look cleaner
- Motion used to manufacture excitement
- Desktop layouts that simply scale down and overflow on mobile
- Copying MGS-specific wording into an unrelated product

## Completion Checklist

Before considering a page complete, verify:

- The canvas reads as warm ruled paper, not plain beige.
- The page has one clear oversized editorial declaration.
- All major corners are square.
- Structural borders are crisp and internally consistent.
- Only major work surfaces receive the hard offset shadow.
- Rust red is concentrated around action and attention.
- Display, body, and mono type each have distinct semantic jobs.
- Metadata and labels are precise rather than decorative filler.
- Inputs and controls expose useful state, limits, or consequences.
- Empty, busy, disabled, error, warning, and output states feel designed.
- Long evidence, identifiers, and URLs wrap safely.
- The 900px and 560px layouts are intentionally recomposed.
- Keyboard focus is obvious, dynamic state is announced, and reduced-motion preferences are respected.
- The page resembles an institutional editorial instrument, not a generic component library demo.
