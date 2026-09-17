"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { mergeLayout, movePanel, toggleWidth, type PanelLayout } from "@/lib/layout";

const STORAGE_KEY = "screen-time-layout-v1";

export type BoardPanel = { id: string; title: string; wide: boolean; plain?: boolean; content: ReactNode };

/** Panels the viewer can reorder by dragging the handle (mouse or touch) and resize. Saved per browser. */
export function DashboardBoard({ panels }: { panels: BoardPanel[] }) {
  const defaults = panels.map(({ id, wide }) => ({ id, wide }));
  const [layout, setLayout] = useState<PanelLayout[]>(defaults);
  const [dragging, setDragging] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const refs = useRef(new Map<string, HTMLElement>());
  const defaultsJson = JSON.stringify(defaults);

  useEffect(() => {
    let saved: unknown = null;
    try { saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"); }
    catch { saved = null; }
    // Reading localStorage must wait until after hydration, so the first render matches the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayout(mergeLayout(saved, JSON.parse(defaultsJson) as PanelLayout[]));
    setLoaded(true);
  }, [defaultsJson]);

  useEffect(() => {
    if (loaded) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }, [layout, loaded]);

  const byId = new Map(panels.map((panel) => [panel.id, panel]));

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(id);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!dragging) return;
    const target = layout.findIndex(({ id }) => {
      if (id === dragging) return false;
      const rect = refs.current.get(id)?.getBoundingClientRect();
      return !!rect && event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
    if (target >= 0) setLayout((current) => movePanel(current, dragging, target));
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string, index: number) {
    const step = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1
      : event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    setLayout((current) => movePanel(current, id, index + step));
  }

  return (
    <>
      <div className="board-toolbar">
        <span>Drag ⠿ to rearrange · ⇔ to resize</span>
        <button type="button" onClick={() => setLayout(defaults)}>Reset layout</button>
      </div>
      <div className="board">
        {layout.map(({ id, wide }, index) => {
          const panel = byId.get(id);
          if (!panel) return null;
          const classes = ["board-item", wide ? "wide" : "", panel.plain ? "plain" : "panel", dragging === id ? "dragging" : ""];
          return (
            <section
              key={id}
              className={classes.filter(Boolean).join(" ")}
              ref={(element) => { if (element) refs.current.set(id, element); else refs.current.delete(id); }}
            >
              <div className="board-controls">
                <button
                  type="button"
                  className="drag-handle"
                  aria-label={`Move ${panel.title} (arrow keys)`}
                  title="Drag to move"
                  onPointerDown={(event) => onPointerDown(event, id)}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onKeyDown={(event) => onKeyDown(event, id, index)}
                >⠿</button>
                <button
                  type="button"
                  className="size-toggle"
                  aria-label={wide ? `Make ${panel.title} narrow` : `Make ${panel.title} wide`}
                  title={wide ? "Make narrow" : "Make wide"}
                  onClick={() => setLayout((current) => toggleWidth(current, id))}
                >⇔</button>
              </div>
              {panel.content}
            </section>
          );
        })}
      </div>
    </>
  );
}
