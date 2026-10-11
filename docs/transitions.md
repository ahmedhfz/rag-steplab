# transitions.dev integration

Source: [Jakubantalik/transitions.dev](https://github.com/Jakubantalik/transitions.dev/tree/684ebde0c7afff62ea8037e43947caf40e31afd2). `app/transitions.css` contains the root tokens and CSS blocks copied verbatim from the following recipes. A `components` cascade layer lets existing Tailwind geometry retain priority. Application theme, geometry and lifecycle bridges live separately in `app/transition-adapters.css`, `components/ui/transitions.tsx`, `components/ui/transition-surface.tsx`, and `lib/transitions.ts`.

| Source recipe | Application |
| --- | --- |
| 01-card-resize | Progress/context-budget widths and auth form surface |
| 02-number-pop-in | Parse summaries, progress and evaluation counts |
| 04-text-states-swap | Pipeline status, auth feedback, actions and copy feedback |
| 05-menu-dropdown | Account/document management menus and Radix Select |
| 06-modal | Delete confirmation, source inspector and mobile backdrop |
| 07-panel-reveal | Current pipeline/stage results, chunk detail, settings, overview editor and mobile sidebar |
| 08-page-side-by-side | Current route entrance |
| 09-icon-swap | Upload, password visibility and completed status |
| 10-success-check | Completed pipeline indicators |
| 12-error-state-shake | Invalid upload and password confirmation |
| 13-input-clear-dissolve | Playground question clear mirror/glow |
| 14-skeleton-reveal | PDF preview, driven by the iframe load event; `components/ui/skeleton.tsx` loading rows (in-flow, repeating pulse via `.steplab-skeleton`) |
| 16-tabs-sliding | Language/theme, parsed-view, chunk strategy and evaluation controls |
| 21-accordion | Native details through `components/ui/disclosure.tsx` (`Disclosure`, `TechnicalDetails`, `HowItWorks`) |
| 25-checkbox-check | Run/case comparison controls |
| 27-toggle | Learning hints switch |
| 28-thinking-states | Parse, embedding and experiment processing labels |

The remaining catalog recipes require product patterns that these screens do not expose (for example, liking, notifications, streaming chat or a 3D carousel). They are not installed just to manufacture those interactions.

## State and accessibility

- Business state changes immediately. Result panels and route transitions animate the new content without retaining an old document or run for an exit. The question's actual value clears immediately; its exiting mirror is decorative.
- Native summary, input, radio and Radix keyboard/focus behavior remains in charge. Closing surfaces become inert immediately. Radix Presence retains modal/select surfaces for their CSS close duration; reopening cancels manual surface cleanup.
- Native details use `::details-content` to allow closing animation in supporting browsers. Other browsers retain native disclosure behavior. Nested accordion selectors are scoped in adapters so opening a parent cannot open a child.
- Tab pills use measured control sizes and update on resizing/font readiness. The switch uses the source overshoot keyframes with the existing thumb travel and centered geometry.
- Source reduced-motion rules and the application's global reduced-motion guard disable visual motion. Cleanup uses zero delay for manual surfaces in reduced-motion mode.
- Existing MotionConfig remains for consumers outside this integration (`components/app-shell.tsx`). `.codex/config.toml` only registers the Motion documentation MCP servers for Codex; the transitions integration does not need them.

## Verification

`test/transitions.test.tsx` checks native/nested disclosures, controlled state, closing/reopening, immediate result replacement, live text, measured tabs and CSS timing. `e2e/smoke/transitions.spec.ts` runs the existing seeded critical workflow in normal and reduced-motion modes, checking theme selection, switch state and modal Escape/focus restoration. Existing navigation, lineage and production visual checks remain enabled.
