import { formatClock, formatDay } from "@/lib/format";
import type { AgentLifecycleEvent, LifecycleEventKind } from "@/lib/types";

const eventLabels: Record<LifecycleEventKind, string> = {
  started: "Agent started",
  user_exit: "Exited from tray",
  application_exit: "Agent closed cleanly",
  sign_out: "Windows signed out",
  system_shutdown: "Windows shutdown or restart",
  updating: "Installing an update",
  unexpected_stop: "Crash or forced stop",
  unexpected_system_restart: "Restart, power loss, or forced shutdown",
};

const eventTone = (kind: LifecycleEventKind) => kind === "started"
  ? "start"
  : kind.startsWith("unexpected") ? "warning" : "stop";

export function AgentStatusPanel({ events, timeZone }: { events: AgentLifecycleEvent[]; timeZone: string }) {
  return (
    <>
      <div className="panel-heading">
        <div><p className="eyebrow">AGENT</p><h2>Recent starts and stops</h2></div>
      </div>
      <p className="panel-note">
        Clean exits are reported directly. Crashes, forced termination, and power loss are inferred when the agent next starts.
      </p>
      {events.length ? (
        <ol className="lifecycle-list">
          {events.map((event) => (
            <li key={`${event.occurredAt}-${event.kind}`} className={eventTone(event.kind)} title={event.detail ?? undefined}>
              <span aria-hidden="true" />
              <div>
                <strong>{eventLabels[event.kind]}</strong>
                <small>Version {event.agentVersion}</small>
              </div>
              <time>{formatDay(event.occurredAt, timeZone)} · {formatClock(event.occurredAt, timeZone)}</time>
            </li>
          ))}
        </ol>
      ) : <p className="empty">Lifecycle reporting starts with agent version 1.7.</p>}
    </>
  );
}
