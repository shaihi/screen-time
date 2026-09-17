"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { mergeLayout, movePanel, toggleWidth, type PanelLayout } from "@/lib/layout";

const STORAGE_KEY = "screen-time-layout-v1";

export type BoardPanel = { id: string; title: string; wide: boolean; plain?: boolean; content: ReactNode };

/**
 * Dashboard panels in a saved order. "Customize" swaps the panels for a short list of names that can be
 * dragged by their grip or moved with the arrow buttons, so it works the same with a mouse and on a phone.
 */
export function DashboardBoard({ panels }: { panels: BoardPanel[] }) {
  const defaults = panels.map(({ id, wide }) => ({ id, wide }));
  const [layout, setLayout] = useState<PanelLayout[]>(defaults);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const defaultsJson = JSON.stringify(defaults);
  const toolbar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing) toolbar.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [editing]);

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

  return (
    <>
      <div className="board-toolbar" ref={toolbar}>
        {editing ? (
          <>
            <button type="button" className="text-button" onClick={() => setLayout(defaults)}>Reset</button>
            <button type="button" className="primary-button" onClick={() => setEditing(false)}>Done</button>
          </>
        ) : (
          <button type="button" className="text-button" onClick={() => setEditing(true)}>Customize layout</button>
        )}
      </div>
      {editing ? (
        <LayoutEditor layout={layout} titles={byId} onChange={setLayout} />
      ) : (
        <div className="board">
          {layout.map(({ id, wide }) => {
            const panel = byId.get(id);
            if (!panel) return null;
            return (
              <section key={id} className={["board-item", wide ? "wide" : "", panel.plain ? "plain" : "panel"].filter(Boolean).join(" ")}>
                {panel.content}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function LayoutEditor({ layout, titles, onChange }: {
  layout: PanelLayout[];
  titles: Map<string, BoardPanel>;
  onChange: (update: (current: PanelLayout[]) => PanelLayout[]) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());

  function startDrag(event: PointerEvent<HTMLElement>, id: string) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(id);
  }

  function drag(event: PointerEvent<HTMLElement>) {
    if (!dragging) return;
    const target = layout.findIndex(({ id }) => {
      const rect = rows.current.get(id)?.getBoundingClientRect();
      return !!rect && event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
    if (target >= 0) onChange((current) => movePanel(current, dragging, target));
  }

  function endDrag(event: PointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(null);
  }

  return (
    <div className="layout-editor">
      <p className="panel-note">Drag a row by its handle, or use the arrows. The dashboard shows panels in this order.</p>
      <ol>
        {layout.map(({ id, wide }, index) => {
          const title = titles.get(id)?.title ?? id;
          return (
            <li
              key={id}
              className={dragging === id ? "dragging" : ""}
              ref={(element) => { if (element) rows.current.set(id, element); else rows.current.delete(id); }}
            >
              <span
                className="grip"
                aria-hidden="true"
                onPointerDown={(event) => startDrag(event, id)}
                onPointerMove={drag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >⠿</span>
              <strong>{title}</strong>
              <button
                type="button"
                className="width-toggle"
                aria-pressed={wide}
                onClick={() => onChange((current) => toggleWidth(current, id))}
              >{wide ? "Full width" : "Half width"}</button>
              <button type="button" aria-label={`Move ${title} up`} disabled={index === 0}
                onClick={() => onChange((current) => movePanel(current, id, index - 1))}>↑</button>
              <button type="button" aria-label={`Move ${title} down`} disabled={index === layout.length - 1}
                onClick={() => onChange((current) => movePanel(current, id, index + 1))}>↓</button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
