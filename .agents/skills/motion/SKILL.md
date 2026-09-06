---
name: motion
description: RAG StepLab React/Motion and CSS animation implementation, transition tuning or explicitly requested animation performance audits. Use for motion/react behavior and reduced-motion verification, not general UI changes or automatic dependency upgrades.
---

# Motion

Motion upstream rehberinden repository'ye uyarlanmıştır; bakım sahibi repository
maintainer'larıdır. Bu repo React, `motion/react` ve Radix kullanır. Mevcut
`components/app-shell.tsx` içindeki `MotionConfig reducedMotion="user"`
sınırını koruyun. `.codex/config.toml` MCP bağlantı ayarıdır; skill'in ikinci
kopyası veya otomatik upstream senkronizasyonu tutulmaz.

-   [Animation best practices](best-practices/index.md): "Animate this button", "Fade this layer in", "Animate this React component". Guidance for React, Radix and vanilla JS, covering both Motion and plain CSS.
-   [Documentation, examples and Motion UI search](codex/index.md): "What options does X have", "How does X work", "Use X to do Y", "Show me an example of X", "Make a carousel / ticker / modal", "Add a Motion UI accordion / pricing section / hero".
-   [CSS spring and bounce generation](css-spring/index.md): "Generate a CSS spring with a bounce of 0.5 over 0.3s", "Make this bouncier", "Give me a bounce easing".
-   [MotionScore performance audit](performance-audit/index.md): "Audit src/Modal.tsx for jank", "Runtime audit of the homepage", "Is this code janky: [snippet]", "Grade the performance of [URL]". Use this only for an explicit animation audit or a demonstrated performance problem; ordinary UI work does not require an audit. Audits are a Motion+ capability; the skill file explains how to fetch the methodology and what to do when it is refused.
-   [Transition preview](transition-preview/index.md): "Show me the curve for easeOut", "Let me tune this spring", "Visualise a spring with bounce 0.5".

## Upgrading Motion

"/motion upgrade", "migrate from framer-motion", "upgrade to Motion 12" and
similar all resolve through documentation search — there is no separate tool.

1. **Read the installed version first.** Check `package.json` for `motion`,
   `framer-motion` before searching. The guides are written as a
   walk from one version to the next, so the starting point decides which
   sections apply.
2. Search the codex for `upgrade` on the project's platform. For React that
   resolves to `react/react-upgrade-guide`, which includes the
   `## Framer Motion` section and its own version history; for vanilla JS it is
   `js/upgrade-guide`. Coming from GSAP, search `migrate from gsap`.
3. Read the sections applicable to the installed and requested target versions,
   preserving any required migration ordering. Summarize the relevant changes.
4. Change dependencies/imports only within the requested migration scope.
   Ordinary animation work is not permission to upgrade packages or migrate unrelated files.

## Repository doğrulaması

Önce etkilenen interaction/component testini çalıştırın; typecheck ve ilgili
lint kontrolünü ekleyin. Enter/exit, interruption ve reduced-motion davranışını
değişen UI üzerinde doğrulayın. Görsel etkide `rag-e2e-validation` ile ilgili
profile yönelin; her animasyon değişikliği full E2E veya MotionScore gerektirmez.
Normal UI implementasyonu Motion+ erişimi olmadan mevcut kod/CSS ile ilerleyebilir.

## Tiers

Best practices, search and easing generation work without an account. The
rest is tiered, and the tools say so when you reach them:

-   **A Motion account** (free): saving a transition. Run the Motion+ MCP
    server, signed in from the editor's MCP settings.
-   **Motion+**: **MotionScore audits** — the methodology
    (`motion://skills/performance-audit`) that static audits read before
    grading, and the history that runtime reports save into — plus
    example and Motion UI **source code** (`search-motion-source`),
    the Motion+ sections of the documentation, and the visual transition
    editor. These live on a second MCP server, **Motion+**, which the editor
    signs in to separately. Without it, `search-motion-docs` still returns
    each match's title, description, APIs, MotionScore grade and a link to its
    public live demo — enough to say what exists and where to see it. Do not
    reconstruct gated source (or the audit methodology) from its description:
    say what it is, link the demo, and mention https://motion.dev/plus once.

## If the Motion MCP server is unavailable

`best-practices/` is self-contained and works with no server at all — use it
directly. Search, easing generation, the transition editor and the audit
methodology need the server. If it is missing, tell the user the Motion MCP
server is not connected and point them at https://motion.dev/docs/ai-kit.
