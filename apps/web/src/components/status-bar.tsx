"use client";

import type { PaneSnapshot } from "@clawd/core";
import { useEffect, useState } from "react";
import type { FeedStatus } from "@/lib/feed/types";
import { sourceBadge, type Counts } from "@/lib/labels";
import { hhmmss } from "@/lib/time";

type TopProps = { counts: Counts; panes: PaneSnapshot[]; status: FeedStatus };

/** tmux-style top bar: the prompt, the counts, the pane labels and where the data comes from. */
export function StatusBarTop({ counts, panes, status }: TopProps) {
  return (
    <header className="flex h-6 shrink-0 items-center gap-4 bg-card px-3 text-sm whitespace-nowrap text-muted-foreground">
      <span className="font-bold text-clawd">❯ clawd-visualiser</span>
      <span>
        {counts.sessions} sessions · <span className={counts.waiting > 0 ? "attention" : undefined}>{counts.waiting} waiting</span> · {counts.subagents} subagents
      </span>
      <span className="hidden min-w-0 truncate text-foreground md:inline">{panes.map((p) => p.label.toLowerCase()).join("  ")}</span>
      <span className="ml-auto">{sourceBadge(status)}</span>
    </header>
  );
}

function useClock(): string {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now === null ? "--:--:--" : hhmmss(now);
}

/** Bottom bar: hints on the left, the clock and the promise on the right. */
export function StatusBarBottom() {
  const clock = useClock();
  return (
    <footer className="flex h-6 shrink-0 items-center justify-between gap-4 bg-card px-3 text-sm whitespace-nowrap text-muted-foreground">
      <span className="truncate">click a clawd for its ticker · esc closes</span>
      <span>
        {clock} · local · zero tokens
      </span>
    </footer>
  );
}
