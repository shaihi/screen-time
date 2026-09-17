export const activityStates = ["active", "media", "idle", "locked"] as const;
export type ActivityState = (typeof activityStates)[number];

export type ActivitySample = {
  startedAt: string;
  durationSeconds: number;
  state: ActivityState;
  appName?: string | null;
};

export type DashboardSummary = {
  deviceId: string;
  lastSeenAt: string | null;
  activeSeconds: number;
  mediaSeconds: number;
  idleSeconds: number;
  lockedSeconds: number;
  timeline: Array<{ hour: number; active: number; media: number; idle: number }>;
  apps: Array<{ name: string; seconds: number; percent: number }>;
  hiddenApps: string[];
};
