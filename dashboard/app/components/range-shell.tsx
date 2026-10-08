"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { rangeKeys, rangeLabels, type RangeKey } from "@/lib/range";

const hrefFor = (key: RangeKey, offset = 0) => {
  if (key === "day") return "/";
  if (offset) return `/?range=${key}&${key}Offset=${offset}`;
  return `/?range=${key}`;
};

/** Range tabs that highlight immediately and dim the page until the new range has loaded. */
export function RangeShell({ range, weekOffset, monthOffset, children }: { range: RangeKey; weekOffset: number; monthOffset: number; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [requested, setRequested] = useState<RangeKey | null>(null);
  const selected = pending && requested ? requested : range;

  function select(key: RangeKey) {
    if (key === selected) return;
    setRequested(key);
    startTransition(() => router.push(hrefFor(key), { scroll: false }));
  }

  function selectPastRange(key: "week" | "month", offset: number) {
    setRequested(key);
    startTransition(() => router.push(hrefFor(key, offset), { scroll: false }));
  }

  const isHistoricalRange = range === "week" || range === "month";
  const offset = range === "week" ? weekOffset : monthOffset;
  const unit = range === "week" ? "week" : "month";

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
      {isHistoricalRange ? (
        <nav className="range-navigation" aria-label={`${unit[0].toUpperCase()}${unit.slice(1)} navigation`}>
          <button type="button" onClick={() => selectPastRange(range, offset - 1)} disabled={pending}>← Previous {unit}</button>
          {offset < 0
            ? <button type="button" onClick={() => selectPastRange(range, offset + 1)} disabled={pending}>Next {unit} →</button>
            : <span>This {unit}</span>}
        </nav>
      ) : null}
      <div className={pending ? "range-content loading" : "range-content"} aria-busy={pending}>
        {children}
      </div>
    </>
  );
}
