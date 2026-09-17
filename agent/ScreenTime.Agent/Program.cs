namespace ScreenTime.Agent;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        try { Application.Run(new MonitorContext(AgentConfig.Load())); }
        catch (Exception exception)
        {
            MessageBox.Show(exception.Message, "Screen Time could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
