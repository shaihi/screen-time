// Saved dashboard layout: panel order and width. No imports, so it runs under `node --test`.

export type PanelLayout = { id: string; wide: boolean };

/** Keeps saved order and widths for known panels, drops unknown ones, and appends new panels. */
export function mergeLayout(saved: unknown, defaults: PanelLayout[]): PanelLayout[] {
  const known = new Map(defaults.map((panel) => [panel.id, panel]));
  const result: PanelLayout[] = [];
  if (Array.isArray(saved)) {
    for (const entry of saved) {
      if (!entry || typeof entry !== "object") continue;
      const { id, wide } = entry as Partial<PanelLayout>;
      if (typeof id !== "string" || !known.has(id) || result.some((panel) => panel.id === id)) continue;
      result.push({ id, wide: typeof wide === "boolean" ? wide : known.get(id)!.wide });
    }
  }
  for (const panel of defaults) {
    if (!result.some((existing) => existing.id === panel.id)) result.push(panel);
  }
  return result;
}

/** Returns a new layout with the panel `id` moved to `targetIndex`. */
export function movePanel(layout: PanelLayout[], id: string, targetIndex: number): PanelLayout[] {
  const from = layout.findIndex((panel) => panel.id === id);
  if (from < 0) return layout;
  const to = Math.max(0, Math.min(layout.length - 1, targetIndex));
  if (from === to) return layout;
  const without = layout.filter((panel) => panel.id !== id);
  return [...without.slice(0, to), layout[from], ...without.slice(to)];
}

export function toggleWidth(layout: PanelLayout[], id: string): PanelLayout[] {
  return layout.map((panel) => (panel.id === id ? { ...panel, wide: !panel.wide } : panel));
}
