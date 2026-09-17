import { categoryLabels, categoryOf } from "@/lib/categories";
import { formatShortDuration } from "@/lib/format";
import type { RangeKey } from "@/lib/range";
import type { DashboardSummary } from "@/lib/types";

function VisibilityForm({ action, appName, range, children, className }: {
  action: "hide" | "show";
  appName: string;
  range: RangeKey;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <form action="/api/settings/excluded-apps" method="post" className={className}>
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="appName" value={appName} />
      <input type="hidden" name="range" value={range} />
      {children}
    </form>
  );
}

export function AppsPanel({ summary, range }: { summary: DashboardSummary | null; range: RangeKey }) {
  return (
    <>
      <div className="panel-heading"><div><p className="eyebrow">APPS</p><h2>Where time went</h2></div></div>
      <div className="app-list">
        {summary?.apps.length ? summary.apps.map((app, index) => {
          const category = categoryOf(app.name);
          return (
          <div className="app-row" key={app.name}>
            <span className="app-rank">{String(index + 1).padStart(2, "0")}</span>
            <div className="app-name">
              <strong>{app.name}<em>{categoryLabels[category]}</em></strong>
              <span><i className={`cat-${category}`} style={{ width: `${app.percent}%` }} /></span>
            </div>
            <time>{formatShortDuration(app.seconds)}</time>
            <VisibilityForm action="hide" appName={app.name} range={range}>
              <button className="hide-app" type="submit" title={`Hide ${app.name} from this list`} aria-label={`Hide ${app.name} from this list`}>×</button>
            </VisibilityForm>
          </div>
          );
        }) : <p className="empty">Usage will appear after the first upload.</p>}
      </div>
      {summary?.leftRunning.length ? (
        <div className="left-running">
          <p className="eyebrow">LEFT RUNNING · NO INPUT</p>
          {summary.leftRunning.map((app) => (
            <div className="left-running-row" key={app.name}>
              <span><i className={`swatch cat-${categoryOf(app.name)}`} />{app.name}</span>
              <time>{formatShortDuration(app.seconds)}</time>
            </div>
          ))}
          <p className="panel-note">In front with no keyboard or mouse input for 2+ minutes (for example a game left on). Counted as idle, not screen time.</p>
        </div>
      ) : null}
      {summary?.hiddenApps.length ? (
        <details className="hidden-apps">
          <summary>{summary.hiddenApps.length} hidden {summary.hiddenApps.length === 1 ? "app" : "apps"}</summary>
          {summary.hiddenApps.map((app) => (
            <VisibilityForm action="show" appName={app} range={range} key={app}>
              <span>{app}</span><button type="submit">Restore</button>
            </VisibilityForm>
          ))}
        </details>
      ) : null}
    </>
  );
}
