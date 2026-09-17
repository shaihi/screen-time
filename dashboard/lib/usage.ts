// Splits screen-on time into the three numbers the dashboard leads with. No imports, so it runs under `node --test`.

export type UsageTotals = {
  activeSeconds: number;
  mediaSeconds: number;
  idleSeconds: number;
  /** Idle time with an app still in front, e.g. a game left running. Part of idle. */
  leftRunningSeconds: number;
};

export type UsageBreakdown = {
  realUse: number;
  unattended: number;
  idle: number;
  screenOn: number;
  realUsePercent: number;
  shares: { realUse: number; unattended: number; idle: number };
};

const share = (seconds: number, total: number) => (total ? Math.round((seconds / total) * 100) : 0);

export function usageBreakdown(totals: UsageTotals): UsageBreakdown {
  const realUse = totals.activeSeconds + totals.mediaSeconds;
  const unattended = Math.min(totals.leftRunningSeconds, totals.idleSeconds);
  const idle = totals.idleSeconds - unattended;
  const screenOn = realUse + totals.idleSeconds;
  return {
    realUse,
    unattended,
    idle,
    screenOn,
    realUsePercent: share(realUse, screenOn),
    shares: { realUse: share(realUse, screenOn), unattended: share(unattended, screenOn), idle: share(idle, screenOn) },
  };
}

/** The big number: real use on its own, or real use plus time the screen was on unattended. */
export function headline(usage: UsageBreakdown, includeUnattended: boolean) {
  const seconds = includeUnattended ? usage.realUse + usage.unattended : usage.realUse;
  return {
    seconds,
    percent: share(seconds, usage.screenOn),
    label: includeUnattended ? "real use + unattended" : "real use",
  };
}
