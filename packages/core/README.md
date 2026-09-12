# @clawd/core

The contract between the local agent and the web app. Pure TypeScript; `zod` is the only
dependency; nothing under `src/` does I/O.

| Area | What it holds |
| --- | --- |
| `schema/` | `Snapshot`, `TickerEvent`, `Command` wire schemas; the internal `RedactedEvent`; loose raw payload shapes; transport constants. |
| `ingest/` | `redact()` turns a raw hook or status line payload into a `RedactedEvent` or `null`, and `redactPresence()` does the same for one entry of an agents-list poll. `FORBIDDEN_KEYS` and `containsForbidden()` back the redaction tests. |
| `state/` | Pure reducers: `reduceSession`, `reduceFleet`, `tickFleet`; `applyEvent()` is the one call a host makes per event, reducing and returning the ticker lines together; `deriveSnapshot()` is the only place a snapshot is made; `toTickerEvents()` the only source of ticker lines. |
| `alias/` | `paneKey()` hashes a directory; the `AliasMap` gives sessions and panes their public names. |
| `sources/` | The `Source` interface plus `createSimulatedSource()` and `createReplaySource()`. |
| `fixtures/` | Redacted recordings and their golden snapshot sequences. Regenerate with `pnpm --filter @clawd/core fixtures`. |

Design: `docs/superpowers/specs/2026-09-12-core-contract-design.md`.

```
pnpm --filter @clawd/core test
pnpm --filter @clawd/core typecheck
```
