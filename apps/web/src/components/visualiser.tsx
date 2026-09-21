"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFeed } from "@/hooks/use-feed";
import { linkedSelection, sessionFromHash, type SessionLink } from "@/lib/deep-link";
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
  // A session named by a #session=<alias> link, forgotten when the sheet is closed, another Clawd
  // is chosen, or the feed changes.
  const [link, setLink] = useState<SessionLink | null>(null);
  const counts = countSnapshot(feed.snapshot);
  const onSelect = useCallback(
    (alias: string) => {
      setLink(null);
      setSelection({ alias, generation: feed.generation });
    },
    [feed.generation],
  );
  const close = useCallback(() => {
    setLink(null);
    setSelection(null);
  }, []);
  const chosen = selection !== null && selection.generation === feed.generation ? selection.alias : null;
  const selected = chosen ?? linkedSelection(link, feed.generation, feed.status.mode, feed.snapshot);

  // The hash-reading effect below runs once ([] deps) and cannot see feed.generation directly, so
  // it reads it from this ref, kept current by its own effect (this repo's eslint forbids assigning
  // a ref during render).
  const generationRef = useRef(feed.generation);
  useEffect(() => {
    generationRef.current = feed.generation;
  }, [feed.generation]);

  useEffect(() => {
    let disposed = false;
    // The link is consumed as it is read: the hash goes at once, so the same link can be followed
    // again later and a reload does not reopen the sheet. The newest link wins over a Clawd chosen by hand.
    const read = (): void => {
      if (disposed) return;
      const alias = sessionFromHash(window.location.hash);
      if (alias === null) return;
      history.replaceState(null, "", window.location.pathname + window.location.search);
      setSelection(null);
      setLink({ alias, generation: generationRef.current });
    };
    window.addEventListener("hashchange", read);
    // The hash the page was loaded with. Deferred so no state setter runs synchronously inside the effect body.
    queueMicrotask(read);
    return () => {
      disposed = true;
      window.removeEventListener("hashchange", read);
    };
  }, []);

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
