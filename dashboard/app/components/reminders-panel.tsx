import { formatReminderMilestones } from "@/lib/reminder-policy";
import { getReminderMilestones } from "@/lib/db";

export async function RemindersPanel({ householdId }: { householdId: string | null }) {
  const milestones = await getReminderMilestones(householdId);
  return (
    <form action="/api/settings/usage-reminders" method="post" className="reminders-form">
      <div className="panel-heading"><div><p className="eyebrow">NOTIFICATIONS</p><h2>Usage reminders</h2></div></div>
      <p className="panel-note">Show a Windows tray notification after these totals of real use. Blue is informational, yellow is a warning, and red is urgent. Leave empty to disable reminders.</p>
      <label htmlFor="reminder-milestones">Minutes and color</label>
      <input id="reminder-milestones" name="milestones" defaultValue={formatReminderMilestones(milestones)} placeholder="30:blue, 60:blue, 90:yellow, 120:yellow, 150:red" autoComplete="off" />
      <small>Use comma-separated <code>minutes:color</code> entries. Agents refresh the policy within 15 minutes.</small>
      <button className="primary-button" type="submit">Save reminders</button>
    </form>
  );
}
