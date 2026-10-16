namespace ScreenTime.Agent;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        // Local\ scopes the mutex to this Windows session, including all desktop agents in it.
        using var instance = new Mutex(true, @"Local\ScreenTime.Agent.Sampling.v1", out var firstInstance);
        if (!firstInstance) return;
        ApplicationConfiguration.Initialize();
        try { Application.Run(new MonitorContext(AgentConfig.Load(args.Contains("--managed", StringComparer.Ordinal)))); }
        catch (Exception exception)
        {
            MessageBox.Show(exception.Message, "Screen Time could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
