using System.Security.Principal;
using System.ServiceProcess;
using System.Text.Json;
using ScreenTime.Control;

namespace ScreenTime.Service;

internal static class Program
{
    public static int Main(string[] args)
    {
        try
        {
            if (!OperatingSystem.IsWindows())
                throw new PlatformNotSupportedException("ScreenTime control service requires Windows 11 Pro");
            if (args.Length > 0)
            {
                if (args.Length != 1 || args[0] is not ("--prepare" or "--recover" or "--remove-restriction-group"))
                    throw new ArgumentException("Supported options: --prepare, --recover, --remove-restriction-group");
                using var current = WindowsIdentity.GetCurrent();
                if (!new WindowsPrincipal(current).IsInRole(WindowsBuiltInRole.Administrator))
                    throw new UnauthorizedAccessException("Open PowerShell as Administrator from the parent account");
                Storage.VerifyProtectedRoot();
                if (args[0] == "--prepare")
                {
                    Console.WriteLine(JsonSerializer.Serialize(new
                    {
                        restrictionGroupSid = WindowsRestriction.Prepare()
                    }, ControlJson.Options));
                    return 0;
                }
                var service = ServiceController.GetServices().FirstOrDefault(s => s.ServiceName == "ScreenTime.Control");
                using (service)
                    if (service is not null && service.Status != ServiceControllerStatus.Stopped)
                        throw new InvalidOperationException("Stop and disable ScreenTime.Control before local recovery");
                if (args[0] == "--remove-restriction-group" && !File.Exists(Storage.PathFor("service.json")))
                {
                    WindowsRestriction.RemovePreparedGroup();
                    Console.WriteLine("Prepared empty restriction group removed.");
                    return 0;
                }
                var config = Storage.Read<ServiceConfig>("service.json");
                config.Validate(recovery: true);
                if (current.User?.Value == config.WindowsSid)
                    throw new UnauthorizedAccessException("Use the separate parent administrator account for recovery");
                var restriction = new WindowsRestriction(config);
                restriction.SetBlocked(false);
                if (args[0] == "--remove-restriction-group")
                    restriction.RemoveOwnedGroup();
                Console.WriteLine("Child access restored. Cached rules remain on disk; keep the service disabled until you are ready.");
                return 0;
            }
            using (var identity = WindowsIdentity.GetCurrent())
                if (identity.User?.IsWellKnown(WellKnownSidType.LocalSystemSid) != true)
                    throw new UnauthorizedAccessException("Run through the installed LocalSystem Windows service");
            ServiceBase.Run(new ScreenTimeWindowsService());
            return 0;
        }
        catch (Exception e) { Storage.Log($"Startup/recovery: {e.GetType().Name}: {e.Message}"); Console.Error.WriteLine(e.Message); return 1; }
    }
}
internal sealed class ScreenTimeWindowsService : ServiceBase
{
    private CancellationTokenSource? cancel;
    private Task? task;
    public ScreenTimeWindowsService()
    {
        ServiceName = "ScreenTime.Control";
        CanStop = true;
        CanShutdown = true;
        AutoLog = true;
    }
    protected override void OnStart(string[] args)
    {
        cancel = new();
        // Construction validates protected state synchronously so SCM records failed starts.
        var worker = new ControlWorker();
        task = Task.Run(async () =>
        {
            using (worker)
            {
                try
                {
                    await worker.Run(cancel.Token);
                }
                catch (Exception e) { Storage.Log($"Fatal service failure: {e.GetType().Name}: {e.Message}"); Environment.Exit(1); }
            }
        });
    }
    protected override void OnStop()
    {
        cancel?.Cancel();
        task?.Wait(TimeSpan.FromSeconds(20));
        cancel?.Dispose();
    }
    protected override void OnShutdown() => OnStop();
}
