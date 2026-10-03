// Motor-free inspection only. Loads the counted worker's assembly metadata to
// use its TWAIN identity, but never executes that worker or enables acquisition.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading;
using NTwain;
using NTwain.Data;

internal static class ProfileSettingsInspect
{
    private static readonly List<Action> restores = new List<Action>();
    private static readonly ManualResetEvent closed = new ManualResetEvent(false);
    private static bool unexpectedTransfer;

    private static void Require(ReturnCode code, string step)
    {
        Console.WriteLine(step + "=" + code);
        if (code != ReturnCode.Success) throw new InvalidOperationException(step + " rejected");
    }
    private static void Exact<T>(string name, ICapWrapper<T> cap, T requested)
    {
        if (!cap.CanSet || !cap.CanGetCurrent) throw new InvalidOperationException(name + " cannot be verified");
        var before = cap.GetCurrent();
        restores.Add(delegate {
            Require(cap.SetValue(before), name + " restore");
            CountFeedPolicy.RequireReadback(true, before, cap.GetCurrent());
        });
        Require(cap.SetValue(requested), name + " SET");
        var actual = cap.GetCurrent();
        CountFeedPolicy.RequireReadback(true, requested, actual);
        Console.WriteLine(name + " current=" + actual);
    }
    private static void Empty(DataSource source)
    {
        if (!source.Capabilities.CapFeederLoaded.CanGetCurrent ||
            source.Capabilities.CapFeederLoaded.GetCurrent() != BoolType.False)
            throw new InvalidOperationException("Empty hopper required; no inspection or acquisition fallback");
    }
    private static void Owners()
    {
        foreach (var name in new[] { "Mtg.ScannerAgent", "Mtg.CountedTwain", "NAPS2.Worker", "CountFeed",
            "CountProbe", "PrePickInspect", "PrePickSettings", "fjictwsv" })
            if (Process.GetProcessesByName(name).Length != 0)
                throw new InvalidOperationException("Conflicting scanner owner: " + name);
        if (Process.GetProcessesByName("ProfileSettingsInspect").Length != 1)
            throw new InvalidOperationException("Duplicate inspector");
    }
    private static void Snapshot(DataSource source, string path)
    {
        using (var output = new StreamWriter(new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read)))
            foreach (var id in source.Capabilities.CapSupportedCaps.GetValues().OrderBy(c => (ushort)c))
            {
                // Deliberately no vendor SET, even for the observed 0x80FD correlation.
                var cap = new CapWrapper<object>(source, id, v => v,
                    (Func<object, ReturnCode>)(v => { throw new InvalidOperationException("Vendor SET forbidden"); }));
                if (!cap.CanGetCurrent) continue;
                try {
                    var value = cap.GetCurrent();
                    output.WriteLine("0x" + ((ushort)id).ToString("X4") + " type=" +
                        (value == null ? "null" : value.GetType().Name) + " value=" + Convert.ToString(value));
                } catch (Exception e) { output.WriteLine("0x" + ((ushort)id).ToString("X4") + " unavailable=" + e.GetType().Name); }
            }
    }
    private static string Hash(string path)
    {
        using (var sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(path))).Replace("-", "");
    }
    private static void Arguments(string[] args)
    {
        if (args.Length != 3 || args[0] != "inspect-worker-profile-empty-clear" ||
            !Path.IsPathRooted(args[1]) || !Path.IsPathRooted(args[2]) ||
            Path.GetFileName(args[2]) != "Mtg.CountedTwain.exe")
            throw new ArgumentException("Only empty-hopper worker-profile inspection is supported");
        CountFeedPolicy.RequireNewDirectory(args[1]);
        if (!File.Exists(args[2])) throw new ArgumentException("Known counted worker assembly required");
    }
    private static void SelfTest()
    {
        foreach (var args in new[] {
            new[] { "feed-one-of-three", "relative", "operator-ready" },
            new[] { "inspect-worker-profile-empty-clear", "relative", "relative" },
            new[] { "start", "C:\\unused", "C:\\Mtg.CountedTwain.exe" },
            new[] { "inspect-worker-profile-empty-clear", "C:\\unused" },
        }) {
            var refused = false;
            try { Arguments(args); } catch (ArgumentException) { refused = true; }
            if (!refused) throw new InvalidOperationException("Acquisition/invalid inspection accepted");
        }
        CountFeedPolicy.SelfTest();
        Console.WriteLine("PASS inspection-only arguments; no DSM, source, UI or acquisition");
    }
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "selftest") { SelfTest(); return 0; }
        try { Arguments(args); } catch (Exception e) { Console.Error.WriteLine(e.Message); return 2; }
        if (IntPtr.Size != 4) return 2;
        Owners();
        // Assembly metadata only: no Main, helper channel, PREPARE or START calls.
        var worker = Assembly.LoadFile(args[2]);
        if (worker.GetName().Name != "Mtg.CountedTwain") return 2;
        Directory.CreateDirectory(args[1]);
        File.WriteAllText(Path.Combine(args[1], "identity.txt"),
            "identityAssembly=" + args[2] + "\nworkerSHA256=" + Hash(args[2]) +
            "\ninspectorSHA256=" + Hash(Assembly.GetExecutingAssembly().Location) + "\n");
        PlatformInfo.Current.PreferNewDSM = false;
        var session = new TwainSession(TWIdentity.CreateFromAssembly(DataGroups.Image | DataGroups.Control, worker));
        DataSource source = null; var result = 1;
        try {
            Require(session.Open(), "Open legacy DSM");
            source = session.Single(d => d.Name == "PaperStream IP fi-7160");
            Require(source.Open(), "Open exact source");
            Console.WriteLine("workerIdentity=" + worker.GetName().Name + " driver=" + source.Version +
                " protocol=" + source.ProtocolVersion + " state=" + session.State);
            if (!source.Version.ToString().Contains("3.40.2.1815") || source.ProtocolVersion.ToString() != "2.4")
                throw new InvalidOperationException("Unqualified driver profile");
            Empty(source);
            if (!source.Capabilities.CapEnableDSUIOnly.CanGetCurrent ||
                source.Capabilities.CapEnableDSUIOnly.GetCurrent() != BoolType.True)
                throw new InvalidOperationException("Settings-only UI unsupported; no acquisition fallback");
            Snapshot(source, Path.Combine(args[1], "opened-capabilities.txt"));
            // Same state-4 capture configuration and frame check as the current
            // CountedTwainWorker. These reversible SETs cannot start acquisition.
            Exact("CAP_FEEDERENABLED", source.Capabilities.CapFeederEnabled, BoolType.True);
            Exact("CAP_DUPLEXENABLED", source.Capabilities.CapDuplexEnabled, BoolType.False);
            Exact("CAP_AUTOFEED", source.Capabilities.CapAutoFeed, BoolType.True);
            Exact("CAP_AUTOSCAN", source.Capabilities.CapAutoScan, BoolType.False);
            Exact("CAP_XFERCOUNT", source.Capabilities.CapXferCount, 1);
            Exact("ICAP_XFERMECH", source.Capabilities.ICapXferMech, XferMech.Native);
            Exact("ICAP_PIXELTYPE", source.Capabilities.ICapPixelType, PixelType.RGB);
            Exact("ICAP_BITDEPTH", source.Capabilities.ICapBitDepth, 24);
            Exact("ICAP_XRESOLUTION", source.Capabilities.ICapXResolution, (TWFix32)600f);
            Exact("ICAP_YRESOLUTION", source.Capabilities.ICapYResolution, (TWFix32)600f);
            Exact("ICAP_UNITS", source.Capabilities.ICapUnits, Unit.Inches);
            TWImageLayout layout; Require(source.DGImage.ImageLayout.Get(out layout), "Get frame");
            if (Math.Abs((double)layout.Frame.Left) > .001 || Math.Abs((double)layout.Frame.Top) > .001 ||
                Math.Abs((double)layout.Frame.Right - 2.7) > .001 || Math.Abs((double)layout.Frame.Bottom - 3.6) > .001)
                throw new InvalidOperationException("Frame differs from qualified profile");
            Empty(source);
            Snapshot(source, Path.Combine(args[1], "configured-capabilities.txt"));
            session.TransferReady += delegate(object sender, TransferReadyEventArgs e) {
                unexpectedTransfer = true; e.CancelAll = true;
                Console.Error.WriteLine("UNEXPECTED transfer request refused; stop physical work");
            };
            session.DataTransferred += delegate { unexpectedTransfer = true; Console.Error.WriteLine("UNEXPECTED transfer; reconcile transport"); };
            session.SourceDisabled += delegate { Console.WriteLine("Settings dialog closed state=" + session.State); closed.Set(); };
            Console.WriteLine("Opening ShowUIOnly ONCE after configuration; read profile/Pre-Pick, then Cancel unchanged");
            Require(source.Enable(SourceEnableMode.ShowUIOnly, false, IntPtr.Zero), "Settings-only UI");
            while (!closed.WaitOne(30000)) Console.WriteLine("WAITING for operator close; no acquisition/automatic retry");
            if (session.State != 4 || unexpectedTransfer) throw new InvalidOperationException("Inspection needs operator attention");
            Empty(source);
            Snapshot(source, Path.Combine(args[1], "after-ui-capabilities.txt"));
            Console.WriteLine("Acquisition Enable calls=0; vendor SET calls=0"); result = 0;
        } catch (Exception e) { Console.Error.WriteLine(e.GetType().Name + ":" + e.Message); }
        finally {
            if (session.State == 4 && source != null) {
                for (var i = restores.Count - 1; i >= 0; i--)
                    try { restores[i](); } catch (Exception e) { result = 1; Console.Error.WriteLine("RESTORE_ERROR:" + e.Message); }
                try { Snapshot(source, Path.Combine(args[1], "restored-capabilities.txt")); } catch (Exception e) { result = 1; Console.Error.WriteLine("Snapshot error:" + e.Message); }
                try { Require(source.Close(), "Close source"); } catch { result = 1; }
            }
            if (session.State == 3) try { Require(session.Close(), "Close DSM"); } catch { result = 1; }
            if (session.State > 4) { Console.Error.WriteLine("Driver remains open; operator must close; no forced shutdown"); result = 1; }
        }
        return result;
    }
}
