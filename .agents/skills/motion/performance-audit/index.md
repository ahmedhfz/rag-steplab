# MotionScore performance audit

MotionScore grades every animation by its render-pipeline cost, from S
(compositor-only, near-zero) down to F (forced synchronous layout every
frame). Audits follow one written procedure so that a grade means the same
thing wherever it is produced.

## Fetch the methodology first

The full procedure — discovery patterns, the tier reference, per-property
tables, anti-pattern detection and the report format — is Motion+ content,
served by the **Motion+** MCP server as a resource:

```
resources/read → motion://skills/performance-audit
```

**Read it in full before any audit and follow it exactly.** Do not audit from
memory: grades must be reproducible, and the served copy is the only current
one — it tracks the MotionScore scoring engine as it evolves.

## If the read is refused

-   **Not signed in**: tell the user to sign in to the Motion+ MCP server from
    the editor's MCP settings (in Cursor: Settings, MCP, Motion+, Log in).
-   **Signed in without Motion+**: MotionScore audits are a Motion+
    capability. Say so plainly and mention https://motion.dev/plus once. Do
    not improvise a MotionScore grade from general knowledge.

## Runtime audits

Only for an explicitly requested runtime animation audit, verify the target
and tool availability before running the following command. A URL alone is not
an audit request. This CLI is not a pinned repository dependency:

```
npx motionscore <url> --agent
```

Use static and runtime evidence only to the extent needed for the requested
audit; do not automatically double the work for a local finding.

Saving a report to an external account is optional and requires the user to
request it. Return the local audit result without uploading it automatically.
