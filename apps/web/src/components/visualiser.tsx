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
  // Aliases restart at agent-1 in a new feed, so the selection is only honoured while it still
  // names the generation it was made in -- a feed switch implicitly closes the sheet.
  const [selection, setSelection] = useState<{ alias: string; generation: number } | null>(null);
  const counts = countSnapshot(feed.snapshot);
  const onSelect = useCallback((alias: string) => setSelection({ alias, generation: feed.generation }), [feed.generation]);
  const close = useCallback(() => setSelection(null), []);
  const selected = selection !== null && selection.generation === feed.generation ? selection.alias : null;

  useEffect(() => {
    document.title = tabTitle(counts.waiting);
  }, [counts.waiting]);

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <StatusBarTop counts={counts} panes={feed.snapshot?.panes ?? []} status={feed.status} />
      <SceneCanvas snapshot={feed.snapshot} generation={feed.generation} counts={counts} onSelect={onSelect} />
      <StatusBarBottom />
      <SessionList sessions={feed.snapshot?.sessions ?? []} onSelect={onSelect} />
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
