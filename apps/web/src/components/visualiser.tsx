"use client";

import { useEffect, useState } from "react";
import { useFeed } from "@/hooks/use-feed";
import { countSnapshot, tabTitle } from "@/lib/labels";
import { SceneCanvas } from "./scene-canvas";
import { StatusBarBottom, StatusBarTop } from "./status-bar";

/** The client root: owns the feed and the selection, composes the bars, the scene and the sheet. */
export function Visualiser() {
  const feed = useFeed();
  const [selected, setSelected] = useState<string | null>(null);
  const counts = countSnapshot(feed.snapshot);

  useEffect(() => {
    document.title = tabTitle(counts.waiting);
  }, [counts.waiting]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <StatusBarTop counts={counts} panes={feed.snapshot?.panes ?? []} status={feed.status} />
      <SceneCanvas snapshot={feed.snapshot} generation={feed.generation} counts={counts} onSelect={setSelected} />
      <StatusBarBottom />
      {/* Task 8 adds <SessionList> and <DetailSheet> here; `selected` is wired for them. */}
      <span hidden data-selected={selected ?? ""} />
    </div>
  );
}
