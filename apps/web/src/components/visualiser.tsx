"use client";

import { useCallback, useEffect, useState } from "react";
import { useFeed } from "@/hooks/use-feed";
import { countSnapshot, tabTitle } from "@/lib/labels";
import { DetailSheet } from "./detail-sheet";
import { SceneCanvas } from "./scene-canvas";
import { SessionList } from "./session-list";
import { StatusBarBottom, StatusBarTop } from "./status-bar";

/** The client root: owns the feed and the selection, composes the bars, the scene and the sheet. */
export function Visualiser() {
  const feed = useFeed();
  const [selected, setSelected] = useState<string | null>(null);
  const counts = countSnapshot(feed.snapshot);
  const close = useCallback(() => setSelected(null), []);

  useEffect(() => {
    document.title = tabTitle(counts.waiting);
  }, [counts.waiting]);

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <StatusBarTop counts={counts} panes={feed.snapshot?.panes ?? []} status={feed.status} />
      <SceneCanvas snapshot={feed.snapshot} generation={feed.generation} counts={counts} onSelect={setSelected} />
      <StatusBarBottom />
      <SessionList sessions={feed.snapshot?.sessions ?? []} onSelect={setSelected} />
      <DetailSheet
        alias={selected}
        snapshot={feed.snapshot}
        canFocus={feed.canFocus}
        onClose={close}
        subscribeTicker={feed.subscribeTicker}
        backfill={feed.backfill}
        focus={feed.focus}
      />
    </div>
  );
}
