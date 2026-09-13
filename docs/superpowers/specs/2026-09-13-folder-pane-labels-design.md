# Folder pane labels design

13 September 2026. Approved in conversation. Implements the product decision recorded the same day
(PRD FR-15, web app design §8 item 11): in the local view a pane is labelled with its working
directory's last path segment, numbered on collision, and an agent setting selects generated tree
names instead.

## 1. Problem

The decision was documented and the scene learned to cut long titles, but no code produces a
folder label: core names every pane from its tree list the first time it sees it, and the agent has
no setting. Panes read "Oak" and "Elm" instead of "visualiser".

## 2. Behaviour

- A pane's label is the last segment of its working directory as written, such as `visualiser` for
  `C:\mw\visualiser`.
- Two panes with the same name, compared without case, are numbered in order of first sight:
  `visualiser`, `visualiser 2`.
- A pane whose events have never carried a name keeps its generated tree label.
- The agent config's `paneLabels` is `"folder"` (the default) or `"generated"`. With `"generated"`
  no folder name is kept anywhere and every pane shows its tree label.
- Existing panes need no migration: the tree labels already in `aliases.json` become the fallback.

## 3. Architecture

The name travels on redacted events, so the one redaction boundary stays the only place anything
from a path is kept.

- `paneName(cwd)` in core's `alias/pane.ts` returns the last segment, or null for a path with none
  (a bare root such as `C:\`).
- The redacted event envelope gains an optional `paneName`, a string of 1 to 255 characters with no
  slash or backslash, so the schema itself refuses anything more of a path.
- `IngestContext` gains `paneNames?: boolean`. When true, `redact()` and `redactPresence()` add
  `paneName` to every event they produce. Omitted means false, so fixtures and existing callers are
  unchanged.
- `PaneState` gains `name: string | null`. `reduceFleet` sets it from any event that carries
  `paneName`, and a later event without one leaves it alone.
- `StateConfig` gains `folderPaneLabels` (default true). `deriveSnapshot` labels each named pane from
  its name, numbered among all named panes in the fleet by first sight, and falls back to the alias
  map's tree label. With `folderPaneLabels` false it ignores names, including any replayed from an
  older log.
- The agent reads `paneLabels` and sets `paneNames` on the hook, status and presence contexts, and
  `folderPaneLabels` on the host's state config. The poller adds `paneName` to the `history` events
  it builds, from the listed entry's working directory.

Rejected alternatives:

- **Names saved with the aliases, learned from presence polls.** No event format change, but a new
  pane shows a tree name until the next poll, up to 10 seconds.
- **Names held in agent memory only.** The same new-pane delay, and names are lost on restart until
  the first poll.

## 4. Restarts

Logs written after this change carry names, so restored panes are named at once. Logs written
before it do not, and a restored session gets no presence event. The `history` event each session
receives at the first poll after a restart carries the name, so every visible pane is named within
that poll. Sessions with no prompts get no `history`, but they are hidden anyway.

## 5. Privacy

The last path segment is the one piece of a path the user approved for the local view. The schema
refuses separators, so a name can never carry a parent directory. The agent's sinks still reject
the live working directories in full. The event log now holds folder names while the setting is
`"folder"`; it holds none with `"generated"`. Cloud snapshots do not exist yet; when they do they
must use generated names (FR-15).

## 6. Testing

- **Core.** `paneName` for Windows and POSIX paths, trailing separators and bare roots. The schema
  accepts a plain name and refuses an empty one or one with a separator. `redact` and
  `redactPresence` add the name only when asked, and never any other part of the path. The fleet
  keeps the latest name. The snapshot labels, numbers collisions without case, falls back to trees,
  and honours `folderPaneLabels`.
- **Agent.** The test sessions' canary directory becomes `C:/work/CANARY-parent/repo`, so the kept
  segment carries no canary and the end-to-end canary check still catches any leak of the full
  path; the end-to-end test also expects the pane label `repo`. Reconcile and the poller's `history`
  carry the name when enabled. A whole agent names the pane `repo` by default and keeps every name
  out of its snapshot and log with `"generated"`.
- **On real data.** The branch runs against a private copy of `~/.clawd`, and the pane labels are
  compared with the directories of the listed sessions.
