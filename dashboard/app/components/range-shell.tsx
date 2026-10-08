"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { rangeKeys, rangeLabels, type RangeKey } from "@/lib/range";

const hrefFor = (key: RangeKey, weekOffset = 0) => {
  if (key === "day") return "/";
  if (key === "week" && weekOffset) return `/?range=week&weekOffset=${weekOffset}`;
  return `/?range=${key}`;
};

/** Range tabs that highlight immediately and dim the page until the new range has loaded. */
export function RangeShell({ range, weekOffset, children }: { range: RangeKey; weekOffset: number; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [requested, setRequested] = useState<RangeKey | null>(null);
  const selected = pending && requested ? requested : range;

  function select(key: RangeKey) {
    if (key === selected) return;
    setRequested(key);
    startTransition(() => router.push(hrefFor(key), { scroll: false }));
  }

  function selectWeek(offset: number) {
    setRequested("week");
    startTransition(() => router.push(hrefFor("week", offset), { scroll: false }));
  }

  return (
    <>
      <nav className="range-tabs" aria-label="Time range">
        {rangeKeys.map((key) => (
          <a
            key={key}
            href={hrefFor(key)}
            className={key === selected ? "active" : ""}
            aria-current={key === selected ? "page" : undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              select(key);
            }}
          >
            {rangeLabels[key].tab}
            {pending && key === selected ? <span className="tab-spinner" aria-label="Loading" /> : null}
          </a>
        ))}
      </nav>
      {range === "week" ? (
        <nav className="week-navigation" aria-label="Week navigation">
          <button type="button" onClick={() => selectWeek(weekOffset - 1)} disabled={pending}>← Previous week</button>
          {weekOffset < 0
            ? <button type="button" onClick={() => selectWeek(weekOffset + 1)} disabled={pending}>Next week →</button>
            : <span>This week</span>}
        </nav>
      ) : null}
      <div className={pending ? "range-content loading" : "range-content"} aria-busy={pending}>
        {children}
      </div>
    </>
  );
}
