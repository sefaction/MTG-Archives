// Runs in the x86 .NET Framework companion, never in the x64 website helper.
// The caller holds the shared device lease. PREPARE opens/configures the source;
// only a separate START line after the durable server claim can enable feeding.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Web.Script.Serialization;
using NTwain;
using NTwain.Data;

internal static class CountedTwainWorker
{
    private static readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private static readonly List<Action> restores = new List<Action>();
    private static readonly ManualResetEvent disabled = new ManualResetEvent(false);
    private static int images, failures;
    private static bool empty;
    private static void Send(object value) { lock (json) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); } }
    private static void Require(ReturnCode code) { if (code != ReturnCode.Success) throw new InvalidOperationException("TWAIN request rejected"); }
    private static void Exact<T>(ICapWrapper<T> cap, T value)
    {
        if (!cap.CanSet || !cap.CanGetCurrent) throw new InvalidOperationException("Capability cannot be verified");
        var before = cap.GetCurrent();
        restores.Add(delegate { Require(cap.SetValue(before)); CountFeedPolicy.RequireReadback(true, before, cap.GetCurrent()); });
        Require(cap.SetValue(value)); CountFeedPolicy.RequireReadback(true, value, cap.GetCurrent());
    }
    private static void Owners(int parent)
    {
        // Discovery's idle NAPS2 proxy may belong to the same helper. Other
        // helpers and standalone diagnostics must be gone before this route.
        if (Process.GetProcessesByName("Mtg.ScannerAgent").Any(p => p.Id != parent) ||
            Process.GetProcessesByName("CountProbe").Length != 0 || Process.GetProcessesByName("CountFeed").Length != 0 ||
            Process.GetProcessesByName("Mtg.CountedTwain").Length != 1)
            throw new InvalidOperationException("Conflicting scanner owner");
        if (Process.GetProcessById(parent).HasExited) throw new InvalidOperationException("Helper owner ended");
    }
    private static Dictionary<string, object> Read()
    {
        var line = Console.ReadLine();
        if (line == null || line.Length > 4096) throw new InvalidOperationException("Helper command unavailable");
        return json.Deserialize<Dictionary<string, object>>(line);
    }
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "selftest") { CountFeedPolicy.SelfTest(); return 0; }
        if (args.Length == 2 && args[0] == "fixture-channel-v1") return Fixture(args[1]);
        // The helper backend also refuses this route, but a direct companion
        // launch must not reopen the failed physical profile during qualification.
        // Refuse before input, ownership, a TWAIN session or any driver call.
        if (args.Length == 1 && args[0] == "helper-channel-v1")
        {
            Send(new { kind = "problem", code = "COUNT_CONTROL_SUSPENDED" });
            return 2;
        }
        if (args.Length != 1 || args[0] != "helper-channel-v1" || IntPtr.Size != 4) return 2;
        TwainSession session = null; OwnedTwainLoop loop = null; DataSource source = null; bool started = false; int result = 1;
        var elapsed = Stopwatch.StartNew();
        try
        {
            var input = Read();
            int parent = Convert.ToInt32(input["parent"]), target = Convert.ToInt32(input["target"]);
            if ((string)input["action"] != "prepare" || target < 1 || target > 5000) throw new ArgumentException("Invalid preparation");
            Owners(parent);
            PlatformInfo.Current.PreferNewDSM = false;
            session = new TwainSession(TWIdentity.CreateFromAssembly(DataGroups.Image | DataGroups.Control, Assembly.GetExecutingAssembly()));
            loop = new OwnedTwainLoop();
            loop.Invoke(delegate { Require(session.Open(loop.Hook)); });
            source = session.Single(d => d.Name == "PaperStream IP fi-7160"); Require(source.Open());
            // Scope the route to the actual tested driver/protocol. Future
            // profiles need their own acceptance, rather than a silent fallback.
            if (!source.Version.ToString().Contains("3.40.2.1815") || source.ProtocolVersion.ToString() != "2.4")
                throw new InvalidOperationException("Driver profile needs qualification");
            Exact(source.Capabilities.CapFeederEnabled, BoolType.True);
            Exact(source.Capabilities.CapDuplexEnabled, BoolType.False);
            Exact(source.Capabilities.CapAutoFeed, BoolType.True);
            Exact(source.Capabilities.CapAutoScan, BoolType.False);
            Exact(source.Capabilities.CapXferCount, target);
            Exact(source.Capabilities.ICapXferMech, XferMech.Native);
            Exact(source.Capabilities.ICapPixelType, PixelType.RGB);
            Exact(source.Capabilities.ICapBitDepth, 24);
            Exact(source.Capabilities.ICapXResolution, (TWFix32)600f);
            Exact(source.Capabilities.ICapYResolution, (TWFix32)600f);
            Exact(source.Capabilities.ICapUnits, Unit.Inches);
            TWImageLayout layout; Require(source.DGImage.ImageLayout.Get(out layout));
            if (Math.Abs((double)layout.Frame.Left) > .001 || Math.Abs((double)layout.Frame.Top) > .001 ||
                Math.Abs((double)layout.Frame.Right - 2.7) > .001 || Math.Abs((double)layout.Frame.Bottom - 3.6) > .001)
                throw new InvalidOperationException("Current driver frame differs from qualified profile");
            Send(new { kind = "prepared", target, driver = source.Version.ToString(), protocol = source.ProtocolVersion.ToString(),
                widthInches = (double)layout.Frame.Right, heightInches = (double)layout.Frame.Bottom, dpi = 600, autoScan = false });
            var next = Read();
            if ((string)next["action"] == "close") { result = 0; return result; }
            if ((string)next["action"] != "start") throw new InvalidOperationException("No explicit start");
            var directory = (string)next["directory"];
            if (!Path.IsPathRooted(directory) || !Directory.Exists(directory) || !File.Exists(Path.Combine(directory, "binding.json")) ||
                !File.Exists(Path.Combine(directory, "run.lock"))) throw new InvalidOperationException("Durable helper journal unavailable");
            session.DataTransferred += delegate(object sender, DataTransferredEventArgs e)
            {
                try
                {
                    var id = Guid.NewGuid(); var file = Path.Combine(directory, id + ".pending.png");
                    using (var inputImage = e.GetNativeImageStream()) using (var image = Image.FromStream(inputImage))
                    {
                        int sequence = Interlocked.Increment(ref images);
                        image.Save(file, ImageFormat.Png);
                        using (var retained = new FileStream(file, FileMode.Open, FileAccess.ReadWrite)) retained.Flush(true);
                        Send(new { kind = "image", id, sequence, width = image.Width, height = image.Height });
                        if (sequence > target) { failures++; Send(new { kind = "problem", code = "OVERTRANSFER" }); }
                    }
                }
                catch { failures++; Send(new { kind = "problem", code = "RETENTION_ERROR" }); }
            };
            session.TransferError += delegate(object sender, TransferErrorEventArgs e) {
                if (e.SourceStatus.ConditionCode == ConditionCode.NoMedia) empty = true;
                else failures++;
                Send(new { kind = "problem", code = empty ? "SOURCE_EMPTY" : "TRANSFER_ERROR" });
            };
            session.TransferCanceled += delegate { failures++; Send(new { kind = "problem", code = "TRANSFER_CANCELLED" }); };
            session.SourceDisabled += delegate { disabled.Set(); };
            Owners(parent);
            CountFeedPolicy.RequireReadback(true, target, source.Capabilities.CapXferCount.GetCurrent());
            CountFeedPolicy.RequireReadback(true, BoolType.False, source.Capabilities.CapAutoScan.GetCurrent());
            if (source.Capabilities.CapFeederLoaded.GetCurrent() != BoolType.True) { empty = true; result = 0; }
            else
            {
                // The only Enable in this program. Never cancel after an image,
                // retry the Enable, or terminate an uncertain active transport.
                started = true; Require(source.Enable(SourceEnableMode.NoUI, false, IntPtr.Zero));
                while (!disabled.WaitOne(30000)) Send(new { kind = "waiting", nativeState = session.State });
                if (source.Capabilities.CapFeederLoaded.CanGetCurrent)
                    empty = source.Capabilities.CapFeederLoaded.GetCurrent() == BoolType.False;
                result = failures == 0 ? 0 : 1;
            }
        }
        catch { Send(new { kind = "problem", code = started ? "NATIVE_ERROR" : "PREPARATION_ERROR" }); }
        finally
        {
            if (session != null)
            {
                while (session.State > 4) { disabled.WaitOne(30000); if (session.State > 4) { Send(new { kind = "waiting", nativeState = session.State }); Thread.Sleep(100); } }
                if (session.State == 4 && source != null)
                {
                    for (int i = restores.Count - 1; i >= 0; i--) try { restores[i](); } catch { result = 1; Send(new { kind = "problem", code = "RESTORE_ERROR" }); }
                    try { Require(source.Close()); } catch { result = 1; }
                }
                if (session.State == 3) try { Require(session.Close()); } catch { result = 1; }
                if (loop != null)
                {
                    // Do not report completion or destroy the native window
                    // before source/DSM closure has actually succeeded.
                    while (session.State != 2)
                    {
                        result = 1;
                        Send(new { kind = "waiting", nativeState = session.State });
                        Thread.Sleep(30000);
                    }
                    loop.Dispose();
                }
            }
            Send(new { kind = "completed", imageCount = images, outcome = result != 0 ? "ERROR" : empty ? "SOURCE_EXHAUSTED" : "COMPLETED",
                sourceExhausted = empty ? "REPORTED_EMPTY" : "UNKNOWN", elapsedMs = elapsed.ElapsedMilliseconds });
        }
        return result;
    }
    private static int Fixture(string scenario)
    {
        if (!new[] { "normal", "early-empty", "overtransfer", "restore-error" }.Contains(scenario)) return 2;
        var prepare = Read(); int target = Convert.ToInt32(prepare["target"]);
        if ((string)prepare["action"] != "prepare" || target < 1 || target > 3) return 2;
        Send(new { kind = "prepared", target, dpi = 600, autoScan = false, fixture = true });
        var start = Read(); if ((string)start["action"] == "close") return 0;
        if ((string)start["action"] != "start") return 2;
        var directory = (string)start["directory"];
        int count = scenario == "early-empty" ? 1 : scenario == "overtransfer" ? target + 1 : target;
        for (int i = 1; i <= count; i++)
        {
            var id = Guid.NewGuid();
            using (var bitmap = new Bitmap(10, 14)) bitmap.Save(Path.Combine(directory, id + ".pending.png"), ImageFormat.Png);
            Send(new { kind = "image", id, sequence = i, width = 10, height = 14 });
        }
        if (scenario == "restore-error") Send(new { kind = "problem", code = "RESTORE_ERROR" });
        Send(new { kind = "completed", imageCount = count, outcome = scenario == "early-empty" ? "SOURCE_EXHAUSTED" : "COMPLETED",
            sourceExhausted = scenario == "early-empty" ? "REPORTED_EMPTY" : "UNKNOWN", elapsedMs = 1 });
        return 0;
    }
}
