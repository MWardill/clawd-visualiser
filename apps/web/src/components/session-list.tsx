"use client";

import type { SessionSnapshot } from "@clawd/core";

type Props = { sessions: SessionSnapshot[]; onSelect: (alias: string) => void };

/**
 * Keyboard and screen-reader access to the same detail sheet the canvas opens. Visually hidden
 * until it receives focus, then shown as a small list under the top bar.
 */
export function SessionList({ sessions, onSelect }: Props) {
  return (
    <nav
      aria-label="Sessions"
      className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:top-7 focus-within:left-2 focus-within:z-10 focus-within:border focus-within:border-border focus-within:bg-card focus-within:p-2"
    >
      <ul className="flex flex-col gap-1 text-sm">
        {sessions
          .filter((s) => s.state !== "done")
          .map((s) => (
            <li key={s.alias}>
              <button type="button" className="text-left hover:text-clawd focus-visible:text-clawd" onClick={() => onSelect(s.alias)}>
                {s.label}, {s.state}
                {s.activity ? `, ${s.activity}` : ""}
                {s.subagents > 0 ? `, ${s.subagents} subagents` : ""}
              </button>
            </li>
          ))}
      </ul>
    </nav>
  );
}
