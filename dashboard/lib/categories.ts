// App categories for colouring charts. No imports, so it runs under `node --test`.

// Order is the stacking and legend order; the colours in globals.css were validated in this order.
export const categories = ["gaming", "social", "video", "music", "web", "productivity", "other"] as const;
export type Category = (typeof categories)[number];

export const categoryLabels: Record<Category, string> = {
  gaming: "Gaming",
  social: "Social",
  video: "Video",
  music: "Music",
  web: "Web",
  productivity: "Apps & AI",
  other: "Other",
};

// Lower-case fragments of app names as the agent reports them.
const needles: Array<[string, Category]> = [
  ["roblox", "gaming"], ["minecraft", "gaming"], ["fortnite", "gaming"], ["steam", "gaming"], ["xbox", "gaming"],
  ["epic games", "gaming"], ["solitaire", "gaming"],
  ["whatsapp", "social"], ["discord", "social"], ["tiktok", "social"], ["instagram", "social"], ["telegram", "social"],
  ["messenger", "social"], ["facebook", "social"], ["snapchat", "social"], ["teams", "social"], ["zoom", "social"],
  ["netflix", "video"], ["disney+", "video"], ["youtube", "video"], ["vlc", "video"], ["prime video", "video"],
  ["media player", "video"], ["movies", "video"], ["twitch", "video"],
  ["spotify", "music"], ["music", "music"], ["itunes", "music"],
  ["chrome", "web"], ["microsoft edge", "web"], ["firefox", "web"], ["opera", "web"], ["brave", "web"],
  ["chatgpt", "productivity"], ["codex", "productivity"], ["claude", "productivity"], ["visual studio", "productivity"],
  ["word", "productivity"], ["excel", "productivity"], ["powerpoint", "productivity"], ["outlook", "productivity"],
  ["notepad", "productivity"], ["terminal", "productivity"], ["paint", "productivity"], ["calculator", "productivity"],
];

export function categoryOf(app: string): Category {
  const name = app.toLowerCase();
  return needles.find(([needle]) => name.includes(needle))?.[1] ?? "other";
}
