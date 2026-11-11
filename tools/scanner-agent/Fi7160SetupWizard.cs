using System.Drawing;
using System.Windows.Forms;

namespace Mtg.Scanner;

internal sealed class Fi7160SetupWizard : Form
{
    private readonly IFi7160SetupSystem system;
    private readonly Label driver = TextLabel("Checking driver…");
    private readonly Label profiles = TextLabel("Checking Cards presets…");
    private readonly Label effective = TextLabel("Connect the scanner when available to apply and check the helper settings.");
    private readonly Label message = TextLabel("You can install the driver and profiles with the scanner disconnected, then return here later.");
    private readonly Button install = ActionButton("Install driver");
    private readonly Button import = ActionButton("Add Cards profiles");
    private readonly Button configure = ActionButton("Apply and check settings");
    private readonly Button recheck = ActionButton("Recheck");
    private readonly Button open = ActionButton("Open Scan cards");
    private readonly Button close = ActionButton("Close setup");
    private readonly CheckBox empty = new() { Text = "The connected scanner's hopper and transport are empty and clear.", AutoSize = true, AccessibleName = "Empty and clear scanner confirmation" };
    private readonly TextBox site = new() { Dock = DockStyle.Fill, AccessibleName = "MTG Archives website address" };
    private Fi7160SetupStatus status = new(null, false);
    private bool busy, verified;
    private CancellationTokenSource? cancellation;

    internal Fi7160SetupWizard(IFi7160SetupSystem system, bool preview)
    {
        this.system = system;
        Text = "MTG Archives — fi-7160 setup";
        Font = new Font("Segoe UI", 10);
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(760, 650); MinimumSize = new Size(630, 480);
        StartPosition = FormStartPosition.CenterScreen;
        var scroll = new Panel { Dock = DockStyle.Fill, AutoScroll = true, Padding = new Padding(20) };
        var table = new TableLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Dock = DockStyle.Top,
            ColumnCount = 2, GrowStyle = TableLayoutPanelGrowStyle.AddRows, Padding = new Padding(0, 0, 10, 12) };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 200));
        void Full(Control control) { var row = table.RowCount++; table.RowStyles.Add(new RowStyle(SizeType.AutoSize)); table.Controls.Add(control, 0, row); table.SetColumnSpan(control, 2); }
        void Step(string title, Label label, Button button)
        {
            Full(TextLabel(title, true));
            var row = table.RowCount++; table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            table.Controls.Add(label, 0, row); table.Controls.Add(button, 1, row);
        }
        Full(TextLabel(preview ? "Setup preview — no installation, scanner or website actions" : "Set up your fi-7160", true));
        Full(TextLabel("One setup for the manufacturer driver, Cards profiles and scanner helper. Follow any Windows and manufacturer approval prompts."));
        Step("1. Manufacturer driver", driver, install);
        Step("2. Cards profiles — 600 and 300 DPI", profiles, import);
        Full(TextLabel("In the manufacturer importer, choose Add profiles, then Import. Keep Replace all profiles unselected. Setup backs up existing profiles and checks they are preserved."));
        Step("3. Apply settings to this helper", effective, configure);
        Full(TextLabel("When the scanner is connected, select MTG Cards 600 DPI in its settings window, confirm Pre-Pick is Off, then save with OK. Setup checks both resolutions without scanning."));
        Full(empty);
        Full(TextLabel("4. Connect to your website", true));
        Full(TextLabel("Enter your MTG Archives website address. On Scan cards, choose Connect this computer and approve the helper handoff. Your existing connections and saved scans are kept."));
        var siteRow = table.RowCount++; table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        table.Controls.Add(site, 0, siteRow); table.Controls.Add(open, 1, siteRow);
        Full(message);
        var footer = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight, WrapContents = true };
        footer.Controls.Add(recheck); footer.Controls.Add(close); Full(footer);
        scroll.Controls.Add(table); Controls.Add(scroll);
        table.Layout += (_, _) => {
            var width = Math.Max(200, table.ClientSize.Width - 220);
            foreach (var control in table.Controls.OfType<Label>())
                control.MaximumSize = new Size(table.GetColumnSpan(control) == 2 ? Math.Max(300, table.ClientSize.Width - 15) : width, 0);
            empty.MaximumSize = new Size(Math.Max(300, table.ClientSize.Width - 15), 0);
        };
        site.Text = system.SuggestedSite;
        install.Click += async (_, _) => await Work(async () => {
            var progress = new Progress<long>(bytes => { if (busy) driver.Text = "Downloading verified manufacturer driver: " + bytes / (1024 * 1024) + " / 245 MiB"; });
            return await system.InstallDriver(progress, cancellation!.Token);
        });
        import.Click += async (_, _) => await Work(async () => { await system.ImportProfiles(); return "Both Cards profiles are installed. Existing profiles were preserved."; });
        configure.Click += async (_, _) => await Work(async () => {
            verified = false; await system.Configure(); verified = true;
            return "Helper settings checked at 600 and 300 DPI. No scan was started. Connect to your website to continue.";
        });
        recheck.Click += (_, _) => { verified = false; RefreshStatus(); };
        empty.CheckedChanged += (_, _) => UpdateButtons();
        open.Click += (_, _) => {
            try { system.OpenSite(Fi7160SetupSystem.ScanPage(site.Text)); message.Text = "On Scan cards choose Connect this computer. Setup never starts a scan; Start remains a separate website action."; }
            catch (Exception error) { message.Text = error.Message; }
        };
        close.Click += (_, _) => {
            if (!busy) Close();
            else { cancellation?.Cancel(); message.Text = "Download cancellation requested. Finish or cancel any manufacturer/settings window normally, then close setup."; }
        };
        FormClosing += (_, e) => {
            if (busy) { e.Cancel = true; cancellation?.Cancel(); message.Text = "Finish or cancel the open manufacturer/settings window normally. Setup keeps it open until the operation has ended."; }
        };
        Shown += (_, _) => RefreshStatus();
    }
    private static Label TextLabel(string text, bool heading = false) => new() {
        Text = text, AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, heading ? 15 : 4, 12, 7),
        Font = new Font("Segoe UI", heading ? 11 : 10, heading ? FontStyle.Bold : FontStyle.Regular) };
    private static Button ActionButton(string text) => new() { Text = text, AccessibleName = text,
        AutoSize = true, MinimumSize = new Size(180, 32), Margin = new Padding(5, 4, 0, 7), Dock = DockStyle.Top };

    private void RefreshStatus()
    {
        try
        {
            status = system.Inspect();
            driver.Text = status.RestartRequired ? "Windows restart required. Reopen setup after restarting." : status.DriverVersion == null ?
                "32-bit PaperStream IP is not installed. Setup downloads the supported package directly from Ricoh." :
                status.DriverSupported ? "PaperStream IP (TWAIN) " + status.DriverVersion + " installed." :
                "Version " + status.DriverVersion + " is installed. Setup preserves it; supported version is 3.40.2.1815.";
            profiles.Text = status.Profiles ? "MTG Cards 600 DPI and MTG Cards 300 DPI match the curated fi-7160 settings." : "Both curated Cards profiles still need to be added.";
            if (!status.DriverSupported || !status.Profiles) verified = false;
            effective.Text = verified ? "Effective helper settings checked this session. The website checks again before every Start." :
                "Pending scanner connection and settings check. Driver/profile installation can finish now.";
        }
        catch (Exception error) { status = new(null, false); verified = false; message.Text = error.Message; }
        UpdateButtons();
    }
    private void UpdateButtons()
    {
        install.Enabled = !busy && status.DriverVersion == null && !status.RestartRequired;
        import.Enabled = !busy && status.DriverSupported && !status.Profiles;
        configure.Enabled = !busy && status.DriverSupported && status.Profiles && empty.Checked;
        recheck.Enabled = open.Enabled = site.Enabled = empty.Enabled = !busy;
        close.Text = busy ? "Cancel / finish setup" : "Close setup";
    }
    private async Task Work(Func<Task<string>> action)
    {
        busy = true; verified = false; cancellation = new CancellationTokenSource(); UpdateButtons();
        message.Text = "Follow the manufacturer window if it opens. Existing scans and pairing are preserved.";
        try { message.Text = await action(); }
        catch (OperationCanceledException) { message.Text = "Download cancelled. Retry when ready; existing settings and saved scans are kept."; }
        catch (Exception error) { message.Text = error.Message; }
        finally { cancellation.Dispose(); cancellation = null; busy = false; RefreshStatus(); }
    }

    internal static void Show(bool preview, string scenario = "fresh")
    {
        Exception? failure = null;
        var thread = new Thread(() => {
            try
            {
                Application.EnableVisualStyles();
                using var dialog = new Fi7160SetupWizard(preview ? new Fi7160SetupPreview(scenario) : new Fi7160SetupSystem(), preview);
                Application.Run(dialog);
            }
            catch (Exception error) { failure = error; }
        });
        thread.SetApartmentState(ApartmentState.STA); thread.Start(); thread.Join();
        if (failure != null) throw new InvalidOperationException("Scanner setup could not open.", failure);
    }
}

// Explicit preview entry point: never instantiate the real system adapter.
internal sealed class Fi7160SetupPreview(string scenario) : IFi7160SetupSystem
{
    private Fi7160SetupStatus status = scenario switch {
        "installed" or "disconnected" => new(Fi7160SetupPackages.DriverVersion, true),
        "incompatible" => new("3.50.0.0", false),
        "restart" => new(Fi7160SetupPackages.DriverVersion, false, true),
        _ => new(null, false) };
    public string SuggestedSite => "https://example.com/";
    public Fi7160SetupStatus Inspect() => status;
    public async Task<string> InstallDriver(IProgress<long> progress, CancellationToken cancellation)
    {
        await Task.Delay(300, cancellation); progress.Report(Fi7160SetupPackages.Driver.Bytes);
        status = status with { DriverVersion = Fi7160SetupPackages.DriverVersion };
        return "Preview: driver installed. No download or installer was run.";
    }
    public Task ImportProfiles() { status = status with { Profiles = true }; return Task.CompletedTask; }
    public Task Configure() => scenario == "disconnected" ? Task.FromException(new InvalidOperationException("Preview: connect and power on the scanner, then retry. Effective settings remain pending.")) : Task.CompletedTask;
    public void OpenSite(Uri site) { }
}
