# DESIGN.md

Rules for anyone, human or agent, changing the landing site. Read this before touching `apps/web`.

## The brand line

The site is built to the standard of the Next.js ecosystem: Geist, monochrome, hairlines, a strict grid. It must never read as a Vercel product.

- Never use the Vercel triangle, the Vercel wordmark, `vercel-brand.css`, or any `--vbg-*` / `.vbg-*` name.
- Never imply affiliation. "Built for Next.js" in copy is the limit.
- The mark is the permission ladder (`components/mark.tsx`). Nothing triangular, ever.

## The page's job

One job: get a Next.js developer to join the waitlist, with a GitHub link for those who want to check the work. Every section must help that decision or go.

## Tokens

All tokens live in `app/globals.css` as `light-dark()` pairs. Components read tokens through Tailwind (`text-muted`, `border-line`); never write a hex value in a component. The OG image is the one exception, because satori cannot read CSS variables; it mirrors the dark values and says so in a comment.

| Token | Role |
| --- | --- |
| `background`, `surface` | Page ground; `surface` only for code evidence |
| `foreground`, `muted`, `faint` | Text: primary, secondary, captions and placeholders |
| `line` | Every hairline and border |
| `read`, `write`, `irreversible` | The effect triad |

The theme follows the system. There is no switcher.

## Colour

Design in monochrome. Colour appears in exactly two places: the effect labels `read` / `write` / `irreversible`, and the mark. Links, buttons, focus rings and errors are monochrome, with one exception: form errors use `irreversible`, because a failed signup is a real state, not decoration.

## Type

- Geist Sans for everything people read. Headlines are weight 600 with tight tracking (`-0.03em` to `-0.045em`), `text-balance`.
- Geist Mono only for code, commands, paths, and effect labels. Never for headlines or body.
- Body prose stays under about 60 characters wide.
- Peer elements share one size and weight. Do not vary them for interest.

## Layout

- One continuous canvas, max width 1200px, 12 columns on desktop.
- Sections use `components/ledger.tsx`: heading in the left four columns, rows in the right eight, hairlines between rows. New sections use it too.
- Copy is left-aligned. The hero is not centred.
- Evidence (code, compiler output) runs full width.
- Spacing comes from `gap` and section padding, not per-element margins.
- Radius is 6px on controls, 8px on the evidence block. Nothing else is rounded.

## Evidence

Anything presented as compiler output must be literal compiler output. `content/evidence-example.ts` was produced by compiling that exact handler; to change it, recompile and paste. Never hand-tune output to look better, and never state a benchmark or adoption number that is not published and true.

## Motion

Default to stillness. Motion is allowed only to confirm a state change. Nothing animates on scroll or on hover, and nothing gates reading. Respect `prefers-reduced-motion`.

## Copy

- All user-facing strings live in `content/copy.ts`. The product name is one constant there.
- Say what the compiler does today. Do not name an output (WebMCP, tRPC, anything) until it ships.
- Active voice. A button says what it does. An error says what happened and what to do next, without apologising.
- No em dashes, no all-caps eyebrows, no exclamation marks.

## Rejected patterns

- Centred hero followed by a card grid
- Cards, nested cards, or bordered boxes around ordinary content
- Gradients, glows, blobs, glass
- Badges or pills for ordinary metadata
- Decorative section numbers, icons as section markers, emoji
- Repeated equal metric tiles
- Stock imagery and fake product screenshots
- A visible theme switcher
- Tiny muted prose used to hide weak copy

## The waitlist

`lib/waitlist.ts` holds the rules and the store seam. The form must never show success unless the email was stored; with no store configured it shows the failure state. The honeypot is the only case where success is shown without storing.

## Accessibility

Semantic landmarks, one `h1`, ordered headings, native controls, labelled inputs, visible focus. Errors use `role="alert"`, confirmations `role="status"`. Never rely on colour alone: effect labels are always also words. WCAG AA contrast in both themes.
