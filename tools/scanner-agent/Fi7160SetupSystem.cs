using Microsoft.Win32;
using System.ComponentModel;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;

namespace Mtg.Scanner;

internal sealed record Fi7160SetupStatus(string? DriverVersion, bool Profiles, bool RestartRequired = false)
{
    internal bool DriverSupported => DriverVersion == Fi7160SetupPackages.DriverVersion && !RestartRequired;
}

internal interface IFi7160SetupSystem
{
    Fi7160SetupStatus Inspect();
    Task<string> InstallDriver(IProgress<long> progress, CancellationToken cancellation);
    Task ImportProfiles();
    Task Configure();
    string SuggestedSite { get; }
    void OpenSite(Uri site);
}

internal sealed class Fi7160SetupSystem : IFi7160SetupSystem
{
    internal static string HelperRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MTGArchives", "ScannerAgent");
    private static string SetupRoot => Path.Combine(HelperRoot, "setup7160");
    private static string RestartFile => Path.Combine(SetupRoot, "restart-required.json");

    internal static string? InstalledDriver()
    {
        using var root = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry32);
        using var uninstall = root.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall");
        if (uninstall == null) return null;
        var versions = new HashSet<string>(StringComparer.Ordinal);
        foreach (var key in uninstall.GetSubKeyNames())
        {
            using var item = uninstall.OpenSubKey(key);
            if (item?.GetValue("DisplayName") as string != "PaperStream IP (TWAIN)") continue;
            versions.Add(item.GetValue("DisplayVersion") as string ?? "unknown");
        }
        return versions.Count == 0 ? null : versions.Count == 1 ? versions.Single() : "multiple versions";
    }
    public Fi7160SetupStatus Inspect()
    {
        var restart = false;
        if (File.Exists(RestartFile))
        {
            var recorded = JsonSerializer.Deserialize<DateTimeOffset>(File.ReadAllText(RestartFile));
            var boot = DateTimeOffset.UtcNow - TimeSpan.FromMilliseconds(Environment.TickCount64);
            restart = recorded >= boot - TimeSpan.FromSeconds(10);
        }
        return new(InstalledDriver(), Fi7160Profiles.Installed(), restart);
    }

    private static FileStream Exclusive()
    {
        // Share the normal connection lease. Do not stop another helper, native
        // worker, importer or editor to make setup fit.
        var lease = ScannerConnectionSelection.AcquireLease(HelperRoot);
        try
        {
            foreach (var name in new[] { "Mtg.ScannerAgent", "Mtg.CountedTwain", "NAPS2.Worker", "CountFeed", "CountProbe", "pfimport", "pfexport", "SCApfimport", "NXManagerProfileCreationTool" })
                if (Process.GetProcessesByName(name).Any(p => p.Id != Environment.ProcessId))
                    throw new InvalidOperationException("Close the other scanner helper, profile editor or scanner tool after its work finishes, then retry setup.");
            return lease;
        }
        catch { lease.Dispose(); throw; }
    }

    public async Task<string> InstallDriver(IProgress<long> progress, CancellationToken cancellation)
    {
        using var lease = Exclusive();
        var current = Inspect();
        if (current.RestartRequired) return "Restart Windows, then reopen Scanner setup from the Start menu.";
        if (current.DriverSupported) return "The supported 32-bit driver is already installed.";
        if (current.DriverVersion != null)
            throw new InvalidOperationException("A different 32-bit PaperStream driver is installed (" + current.DriverVersion + "). Setup preserves it. Ask your administrator to select the supported 3.40.2.1815 version, then recheck.");
        if (Process.GetProcessesByName("msiexec").Length != 0)
            throw new InvalidOperationException("Finish the other Windows installation before installing the scanner driver.");
        var file = await Fi7160SetupPackages.DownloadDriver(Path.Combine(SetupRoot, "packages"), progress, cancellation);
        cancellation.ThrowIfCancellationRequested();
        await Fi7160SetupPackages.Verify(file, Fi7160SetupPackages.Driver, cancellation);
        Process process;
        try { process = Process.Start(new ProcessStartInfo(file) { UseShellExecute = true })
                ?? throw new InvalidOperationException("The manufacturer installer could not start."); }
        catch (Win32Exception e) when (e.NativeErrorCode == 1223)
        { return "Windows installation approval was cancelled. Your profiles and saved scans are unchanged. Retry when ready."; }
        using (process)
        {
            // Cancellation only interrupts downloading. Never terminate an
            // installer or its transport/driver children to close the wizard.
            await process.WaitForExitAsync();
            if (process.ExitCode is 3010 or 1641)
            {
                Directory.CreateDirectory(SetupRoot);
                File.WriteAllText(RestartFile, JsonSerializer.Serialize(DateTimeOffset.UtcNow));
                return "The manufacturer requested a Windows restart. Restart, then reopen Scanner setup from the Start menu.";
            }
            if (process.ExitCode == 1602) return "Driver installation was cancelled. Retry when ready.";
            if (process.ExitCode != 0) throw new InvalidOperationException("The manufacturer installer ended with code " + process.ExitCode + ". Finish or repair its installation, then recheck.");
        }
        return Inspect().DriverSupported ? "Supported 32-bit PaperStream driver detected." :
            "Finish every manufacturer installation window, including any restart it requests, then choose Recheck. The driver is not verified yet.";
    }

    public async Task ImportProfiles()
    {
        using var lease = Exclusive();
        if (!Inspect().DriverSupported) throw new InvalidOperationException("Install the supported driver and finish any restart first.");
        if (Fi7160Profiles.Installed()) return; // Repeat setup does not add duplicates.
        var wrapper = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "PaperStream IP", "TWAIN", "Profile", "pfimport.exe");
        if (!File.Exists(wrapper)) throw new InvalidOperationException("The manufacturer's profile importer is missing. Repair PaperStream IP, then retry.");
        var snapshot = BackupProfiles();
        var file = Fi7160Profiles.Materialize(Path.Combine(SetupRoot, "profiles-v1"));
        var start = new ProcessStartInfo(wrapper) { UseShellExecute = false };
        // The installed .pav file association documents -c <file>. There is no
        // assumed silent/add flag: the operator chooses Add in the vendor UI.
        start.ArgumentList.Add("-c"); start.ArgumentList.Add(file);
        using var process = Process.Start(start) ?? throw new InvalidOperationException("The manufacturer profile importer could not start.");
        await process.WaitForExitAsync();
        // The registered wrapper starts the native importer and may exit first.
        while (Process.GetProcessesByName("pfimport").Length != 0 || Process.GetProcessesByName("SCApfimport").Length != 0)
            await Task.Delay(250);
        VerifyPreserved(snapshot);
        if (!Fi7160Profiles.Installed())
            throw new InvalidOperationException("Both Cards presets were not found with the expected settings. Retry and choose Add profiles, then Import. Existing profiles were checked for preservation.");
    }

    internal sealed record Backup(string Directory, string Store, Dictionary<string, string> Hashes, Dictionary<string, string> Names);
    internal static Backup BackupProfiles(string? profileStore = null, string? backupRoot = null)
    {
        var store = profileStore ?? Fi7160Profiles.Store;
        var destination = Path.Combine(backupRoot ?? Path.Combine(SetupRoot, "profile-backups"), DateTime.UtcNow.ToString("yyyyMMddTHHmmss") + "-" + Guid.NewGuid().ToString("N"));
        Fi7160SetupPackages.RejectReparseDirectories(destination);
        Directory.CreateDirectory(destination);
        var hashes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (Directory.Exists(store))
        {
            foreach (var file in Directory.EnumerateFiles(store, "*", SearchOption.AllDirectories))
            {
                Fi7160SetupPackages.RejectReparseDirectories(Path.GetDirectoryName(file)!);
                if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("The profile store contains a linked file; keep it and contact support.");
                var relative = Path.GetRelativePath(store, file);
                var target = Path.Combine(destination, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                File.Copy(file, target, false);
                hashes.Add(relative, HashFile(target));
            }
        }
        var names = Names(Path.Combine(destination, "SettingInfo.ini"));
        File.WriteAllText(Path.Combine(destination, "setup-backup-manifest.json"), JsonSerializer.Serialize(hashes));
        return new(destination, store, hashes, names);
    }
    private static string HashFile(string file) { using var input = File.OpenRead(file); return Convert.ToHexString(SHA256.HashData(input)); }
    private static Dictionary<string, string> Names(string file) => !File.Exists(file) ? new() : File.ReadLines(file)
        .Where(line => line.Length >= 7 && line[6] == '=' && line[..6].All(char.IsAsciiDigit))
        .ToDictionary(line => line[..6], line => line[7..], StringComparer.Ordinal);
    internal static void VerifyPreserved(Backup backup)
    {
        var names = Names(Path.Combine(backup.Store, "SettingInfo.ini"));
        var changed = backup.Names.Any(p => !names.TryGetValue(p.Key, out var value) || p.Value != value);
        foreach (var item in backup.Hashes.Where(p => p.Key is not ("Id.bin" or "SettingInfo.ini")))
        {
            var file = Path.Combine(backup.Store, item.Key);
            if (!File.Exists(file) || HashFile(file) != item.Value) changed = true;
        }
        if (changed) throw new InvalidOperationException("The vendor import changed an existing profile. Setup has stopped. Your pre-import backup is at " + backup.Directory + ". Keep it for recovery; do not scan or repeat the import.");
    }

    public async Task Configure()
    {
        using var lease = Exclusive();
        if (!Inspect().DriverSupported || !Fi7160Profiles.Installed()) throw new InvalidOperationException("Complete driver and Cards profile installation first.");
        await Fi7160SetupCompanion.Configure();
        foreach (var dpi in new[] { 600, 300 })
        {
            using var backend = new CountedTwainBackend(requireEmpty: true);
            await backend.Prepare(new ScanRequest(Guid.NewGuid(), CountedTwainBackend.DeviceId, dpi, 2.7m, 3.6m, SessionPhysicalTarget: 1));
            backend.Close(); // Verifies twelve restorations, closure and real child exit.
        }
    }

    public string SuggestedSite
    {
        get
        {
            if (!Directory.Exists(HelperRoot)) return "";
            var sites = new HashSet<string>();
            foreach (var file in Directory.EnumerateFiles(HelperRoot, "*.json").Take(512))
            {
                if (!Guid.TryParse(Path.GetFileNameWithoutExtension(file), out _)) continue;
                try
                {
                    var connection = JsonSerializer.Deserialize<HelperConnection>(File.ReadAllText(file), RunSpool.Json);
                    if (connection is { Disabled: false }) sites.Add(ScannerConnection.Site(connection.Site, connection.AllowLocal).AbsoluteUri);
                }
                catch (Exception error) when (error is IOException or JsonException or ArgumentException) { }
            }
            return sites.Count == 1 ? sites.Single() : "";
        }
    }
    internal static Uri ScanPage(string origin)
    {
        var site = ScannerConnection.Site(origin.Trim(), origin.Trim().StartsWith("http://", StringComparison.OrdinalIgnoreCase));
        return new Uri(site, "imports/scan?input=scanner");
    }
    public void OpenSite(Uri site) => Process.Start(new ProcessStartInfo(site.AbsoluteUri) { UseShellExecute = true });
}
