namespace ScreenTime.Agent;

internal sealed class EnforcementCountdownForm : Form
{
    private readonly Label _countdown;
    private readonly Label _message;
    private readonly System.Windows.Forms.Timer _timer;
    private DateTimeOffset _deadlineUtc;
    private bool _allowClose;

    public EnforcementCountdownForm()
    {
        Text = "Screen time is ending";
        Width = 520;
        Height = 260;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        ControlBox = false;
        ShowInTaskbar = true;
        TopMost = true;
        BackColor = Color.FromArgb(20, 24, 21);
        ForeColor = Color.White;
        Padding = new Padding(28);

        _countdown = new Label
        {
            Dock = DockStyle.Top,
            Height = 82,
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font(FontFamily.GenericSansSerif, 38, FontStyle.Bold),
            ForeColor = Color.FromArgb(250, 178, 25),
        };
        _message = new Label
        {
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.TopCenter,
            Font = new Font(FontFamily.GenericSansSerif, 13, FontStyle.Regular),
        };
        Controls.Add(_message);
        Controls.Add(_countdown);
        _timer = new System.Windows.Forms.Timer { Interval = 250 };
        _timer.Tick += (_, _) => RenderCountdown();
        FormClosing += (_, eventArgs) =>
        {
            if (!_allowClose)
                eventArgs.Cancel = true;
        };
    }

    public void UpdateCountdown(int seconds, string reason)
    {
        _deadlineUtc = DateTimeOffset.UtcNow.AddSeconds(Math.Clamp(seconds, 0, 30));
        _message.Text = $"{reason}\n\nSave your work now. Any app still open at zero will be closed.";
        RenderCountdown();
        if (!Visible)
            Show();
        WindowState = FormWindowState.Normal;
        BringToFront();
        Activate();
        _timer.Start();
    }

    public void Dismiss()
    {
        _timer.Stop();
        _allowClose = true;
        Close();
        Dispose();
    }

    private void RenderCountdown()
    {
        var seconds = Math.Max(0, (int)Math.Ceiling((_deadlineUtc - DateTimeOffset.UtcNow).TotalSeconds));
        _countdown.Text = seconds > 0 ? seconds.ToString() : "Closing apps…";
    }
}
