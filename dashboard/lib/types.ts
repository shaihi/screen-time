import type { RangeKey } from "@/lib/range";
import type { PageTotal, PageVisit } from "@/lib/pages";
import type { AppSession, OverlapPeriod } from "@/lib/sessions";
import type { TimelinePoint } from "@/lib/timeline";

export type { TimelinePoint };

// "background" is media playing while another app is in use; it is never added to totals.
export const activityStates = ["active", "media", "idle", "locked", "background"] as const;
export type ActivityState = (typeof activityStates)[number];

export type ActivitySample = {
  startedAt: string;
  durationSeconds: number;
  state: ActivityState;
  appName?: string | null;
};


export type DashboardSummary = {
  range: RangeKey;
  timeZone: string;
  deviceId: string;
  lastSeenAt: string | null;
  activeSeconds: number;
  mediaSeconds: number;
  idleSeconds: number;
  lockedSeconds: number;
  timeline: TimelinePoint[];
  apps: Array<{ name: string; seconds: number; percent: number }>;
  hiddenApps: string[];
  sessions: AppSession[];
  overlaps: OverlapPeriod[];
  pages: PageVisit[];
  pageTotals: PageTotal[];
};
