---
name: transitions
description: Apply and validate the installed transitions.dev recipes in RAG StepLab.
---

Use the actual transitions.dev CSS and documented hooks; see
[the integration map](../../../docs/transitions.md) and
[upstream recipes](https://github.com/Jakubantalik/transitions.dev/tree/main/skills/transitions-dev).

`app/transitions.css` contains verbatim recipe CSS. Add StepLab geometry,
Radix Presence and theme bridges to `app/transition-adapters.css`, not the
recipe rules. Read timing from CSS variables using `lib/transitions.ts`.

Use `components/ui/transitions.tsx` and `transition-surface.tsx` adapters.
Preserve native inputs, summary keyboard behavior, Radix focus/Escape,
PreferencesProvider and global reduced-motion handling. New state and
lineage invalidation must take effect immediately; don't keep stale
results alive for animation. Cancel observers/timers/frames on unmount.

Run affected Vitest tests and the normal/reduced-motion transition smoke
spec via the existing seeded E2E workflow. Keep the existing MotionConfig
for legacy Motion consumers; new recipe effects are CSS-driven.
