export const reminderColors = ["blue", "yellow", "red"] as const;
export type ReminderColor = (typeof reminderColors)[number];
export type ReminderMilestone = { minutes: number; color: ReminderColor };

const milestonePattern = /^(\d+)\s*:\s*(blue|yellow|red)$/i;

function normalize(milestones: ReminderMilestone[]) {
  const unique = new Map<number, ReminderMilestone>();
  for (const milestone of milestones) unique.set(milestone.minutes, milestone);
  return [...unique.values()].sort((left, right) => left.minutes - right.minutes);
}

function validate(minutes: unknown, color: string): ReminderMilestone {
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60) {
    throw new Error("Reminder minutes must be between 1 and 1440.");
  }
  if (!(reminderColors as readonly string[]).includes(color)) {
    throw new Error("Each reminder must use blue, yellow, or red.");
  }
  return { minutes, color: color as ReminderColor };
}

/** Parses the compact dashboard input, e.g. `30:blue, 90:yellow, 150:red`. */
export function parseReminderMilestones(value: string): ReminderMilestone[] {
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) return [];
  return normalize(entries.map((entry) => {
    const match = milestonePattern.exec(entry);
    if (!match) throw new Error("Use comma-separated minutes:color reminders, for example 30:blue, 90:yellow.");
    return validate(Number(match[1]), match[2].toLowerCase());
  }));
}

/** Invalid persisted data disables reminders instead of exposing malformed settings to agents. */
export function parseStoredReminderMilestones(value: unknown): ReminderMilestone[] {
  if (!Array.isArray(value)) return [];
  try {
    return normalize(value.map((item) => {
      if (!item || typeof item !== "object") throw new Error("Invalid reminder.");
      const { minutes, color } = item as { minutes?: unknown; color?: unknown };
      return validate(minutes, typeof color === "string" ? color : "");
    }));
  } catch {
    return [];
  }
}

export function formatReminderMilestones(milestones: ReminderMilestone[]) {
  return milestones.map((milestone) => `${milestone.minutes}:${milestone.color}`).join(", ");
}
