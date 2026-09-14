"use client";

// The detail pane: a sheet from the right whose only content is the snapshot's fields for the
// session and its redacted ticker. Clicking a Clawd opens it; the focus command is sent by the
// button, never by the click.
import type { SessionSnapshot, Snapshot, TickerEvent } from "@clawd/core";
import { mmss } from "@clawd/scene";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { ClawdIdle } from "@/components/clawd-idle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const TickerTerminal = dynamic(() => import("./ticker-terminal"), {
  ssr: false,
  loading: () => <p className="p-4 text-muted-foreground">loading ticker…</p>,
});

type Props = {
  alias: string | null;
  snapshot: Snapshot | null;
  canFocus: boolean;
  onClose: () => void;
  subscribeTicker: (alias: string, fn: (e: TickerEvent) => void) => () => void;
  backfill: (alias: string) => Promise<TickerEvent[]>;
  focus: (alias: string) => Promise<boolean>;
};

const STATE_CLASS: Record<SessionSnapshot["state"], string> = {
  working: "text-green border-green",
  waiting: "text-amber border-amber",
  idle: "text-muted-foreground",
  asleep: "text-blue border-blue",
  done: "text-pink border-pink",
};

export function DetailSheet({ alias, snapshot, canFocus, onClose, subscribeTicker, backfill, focus }: Props) {
  const session = alias ? (snapshot?.sessions.find((s) => s.alias === alias) ?? null) : null;
  return (
    <Sheet
      open={alias !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="gap-0 p-0 data-[side=right]:sm:max-w-lg">
        {alias ? <DetailBody key={alias} alias={alias} session={session} canFocus={canFocus} subscribeTicker={subscribeTicker} backfill={backfill} focus={focus} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

type BodyProps = Omit<Props, "alias" | "snapshot" | "onClose"> & { alias: string; session: SessionSnapshot | null };

/** Keyed by alias by the sheet, so its focus state resets when another session is opened. */
function DetailBody({ alias, session, canFocus, subscribeTicker, backfill, focus }: BodyProps) {
  const [result, setResult] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const now = useNow();
  const onFocus = (): void => {
    setResult("sending");
    void focus(alias).then((ok) => setResult(ok ? "sent" : "failed"));
  };
  const hint = !canFocus ? "needs the local agent" : result === "sent" ? "sent" : result === "failed" ? "the agent refused" : "";

  return (
    <>
      <SheetHeader className="border-b border-border">
        <div className="flex items-center gap-3">
          <ClawdIdle scale={1} />
          <div className="min-w-0">
            <SheetTitle className="font-bold text-clawd">{session ? (session.detail?.name ?? session.label.toLowerCase()) : alias}</SheetTitle>
            <SheetDescription className="flex flex-wrap items-center gap-2">
              {session ? (
                <>
                  <Badge variant="outline" className={STATE_CLASS[session.state]}>
                    {session.state}
                  </Badge>
                  {session.activity ? <span>{session.activity}</span> : null}
                  <span>{mmss(now - Date.parse(session.since))}</span>
                  {session.subagents > 0 ? <span>×{session.subagents} subagents</span> : null}
                  {session.contextPct !== null ? <span>ctx {session.contextPct}%</span> : null}
                </>
              ) : (
                <span>session ended</span>
              )}
            </SheetDescription>
            {session?.detail ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {session.detail.dir ? <span className="min-w-0 truncate">{session.detail.dir}</span> : null}
                {session.detail.permissionMode ? <Badge variant="outline">{session.detail.permissionMode}</Badge> : null}
                {session.detail.shells ? <span>{session.detail.shells} background shells</span> : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <Button size="sm" variant="outline" disabled={!canFocus || !session || result === "sending"} onClick={onFocus}>
            focus window
          </Button>
          <span className="text-xs text-muted-foreground">{hint}</span>
        </div>
      </SheetHeader>
      <div className="min-h-0 flex-1 bg-background p-2">
        <TickerTerminal alias={alias} subscribe={subscribeTicker} backfill={backfill} />
      </div>
    </>
  );
}
