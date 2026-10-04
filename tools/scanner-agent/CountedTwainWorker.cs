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
    private static int restoredSettings;
    private static bool sourceClosed, dsmClosed, ownedLoopJoined;
    private const int ProfileVersion = 2;
    private const string ProfileDriver = "3.40 3.40.2.1815 Mar 16 2026";
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
    private static void Readback<T>(IReadOnlyCapWrapper<T> cap, T expected)
    {
        CountFeedPolicy.RequireReadback(cap.CanGetCurrent, expected, cap.CanGetCurrent ? cap.GetCurrent() : default(T));
    }
    private static void ObservedInvariant(DataSource source)
    {
        // Correlation only, not an official Pre-Pick capability mapping.
        // Physical acceptance separately observed Cards/Pre-Pick Off. Drift
        // from that observed invariant refuses this scoped route; no vendor SET.
        var cap = new CapWrapper<object>(source, (CapabilityId)0x80FD, v => v,
            (Func<object, ReturnCode>)(v => { throw new InvalidOperationException("Vendor SET forbidden"); }));
        GuardedFeedPolicy.RequireObservedInvariant(cap.CanGetCurrent, cap.CanGetCurrent ? cap.GetCurrent() : null);
    }
    private static void CaptureReadback(DataSource source, int target)
    {
        Readback(source.Capabilities.CapFeederEnabled, BoolType.True);
        Readback(source.Capabilities.CapDuplexEnabled, BoolType.False);
        Readback(source.Capabilities.CapAutoFeed, BoolType.True);
        Readback(source.Capabilities.CapAutoScan, BoolType.False);
        Readback(source.Capabilities.CapXferCount, target);
        Readback(source.Capabilities.ICapXferMech, XferMech.Native);
        Readback(source.Capabilities.ICapPixelType, PixelType.RGB);
        Readback(source.Capabilities.ICapBitDepth, 24);
        Readback(source.Capabilities.ICapXResolution, (TWFix32)600f);
        Readback(source.Capabilities.ICapYResolution, (TWFix32)600f);
        Readback(source.Capabilities.ICapUnits, Unit.Inches);
        Readback(source.Capabilities.ICapAutoDiscardBlankPages, BlankPage.Disable);
        TWImageLayout layout; Require(source.DGImage.ImageLayout.Get(out layout));
        if (Math.Abs((double)layout.Frame.Left) > .001 || Math.Abs((double)layout.Frame.Top) > .001 ||
            Math.Abs((double)layout.Frame.Right - 2.7) > .001 || Math.Abs((double)layout.Frame.Bottom - 3.6) > .001)
            throw new InvalidOperationException("Capture frame changed");
        ObservedInvariant(source);
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
        if (args.Length == 1 && args[0] == "selftest") { CountFeedPolicy.SelfTest(); GuardedFeedPolicy.SelfTest(); return 0; }
        if (args.Length == 2 && args[0] == "fixture-channel-v1") return Fixture(args[1]);
        // The helper backend also refuses this route, but a direct companion
        // launch must not reopen the failed physical profile during qualification.
        // Refuse before input, ownership, a TWAIN session or any driver call.
        if (args.Length == 1 && args[0] == "helper-channel-v1")
        {
            Send(new { kind = "problem", code = "COUNT_CONTROL_SUSPENDED" });
            return 2;
        }
        if (args.Length != 1 || args[0] != "helper-channel-v2" || IntPtr.Size != 4) return 2;
        TwainSession session = null; OwnedTwainLoop loop = null; DataSource source = null; bool started = false; int result = 1;
        var elapsed = Stopwatch.StartNew();
        try
        {
            var input = Read();
            if (!input.ContainsKey("parent") || !(input["parent"] is int) ||
                !input.ContainsKey("target") || !(input["target"] is int)) throw new ArgumentException("Invalid command types");
            int parent = (int)input["parent"], target = (int)input["target"];
            if ((string)input["action"] != "prepare" || !input.ContainsKey("profileVersion") ||
                !(input["profileVersion"] is int) || (int)input["profileVersion"] != ProfileVersion ||
                !input.ContainsKey("requireEmpty") || !(input["requireEmpty"] is bool) ||
                target < 1 || target > 5000) throw new ArgumentException("Invalid preparation");
            Owners(parent);
            PlatformInfo.Current.PreferNewDSM = false;
            session = new TwainSession(TWIdentity.CreateFromAssembly(DataGroups.Image | DataGroups.Control, Assembly.GetExecutingAssembly()));
            loop = new OwnedTwainLoop();
            loop.Invoke(delegate { Require(session.Open(loop.Hook)); });
            source = session.Single(d => d.Name == "PaperStream IP fi-7160"); Require(source.Open());
            // Scope the route to the actual tested driver/protocol. Future
            // profiles need their own acceptance, rather than a silent fallback.
            if (source.Version.ToString() != ProfileDriver || source.ProtocolVersion.ToString() != "2.4")
                throw new InvalidOperationException("Driver profile needs qualification");
            if (!source.Capabilities.CapFeederLoaded.CanGetCurrent)
                throw new InvalidOperationException("Feeder state cannot be verified");
            if ((bool)input["requireEmpty"] && source.Capabilities.CapFeederLoaded.GetCurrent() != BoolType.False)
                throw new InvalidOperationException("Empty preparation requires empty hopper");
            ObservedInvariant(source);
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
            Exact(source.Capabilities.ICapAutoDiscardBlankPages, BlankPage.Disable);
            TWImageLayout layout; Require(source.DGImage.ImageLayout.Get(out layout));
            if (Math.Abs((double)layout.Frame.Left) > .001 || Math.Abs((double)layout.Frame.Top) > .001 ||
                Math.Abs((double)layout.Frame.Right - 2.7) > .001 || Math.Abs((double)layout.Frame.Bottom - 3.6) > .001)
                throw new InvalidOperationException("Current driver frame differs from qualified profile");
            CaptureReadback(source, target);
            Send(new { kind = "prepared", profileVersion = ProfileVersion, target, source = source.Name,
                driver = source.Version.ToString(), protocol = source.ProtocolVersion.ToString(),
                widthInches = (double)layout.Frame.Right, heightInches = (double)layout.Frame.Bottom, dpi = 600,
                autoScan = false, blankDiscard = false, captureReadbacksVerified = true, observedInvariantVerified = true,
                feederLoaded = source.Capabilities.CapFeederLoaded.GetCurrent() == BoolType.True });
            var next = Read();
            if ((string)next["action"] == "close") { result = 0; }
            else
            {
                if ((bool)input["requireEmpty"]) throw new InvalidOperationException("Empty preparation cannot start feeding");
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
                CaptureReadback(source, target);
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
        }
        catch { Send(new { kind = "problem", code = started ? "NATIVE_ERROR" : "PREPARATION_ERROR" }); }
        finally
        {
            if (session != null)
            {
                while (session.State > 4) { disabled.WaitOne(30000); if (session.State > 4) { Send(new { kind = "waiting", nativeState = session.State }); Thread.Sleep(100); } }
                if (session.State == 4 && source != null)
                {
                    for (int i = restores.Count - 1; i >= 0; i--) try { restores[i](); restoredSettings++; } catch { result = 1; Send(new { kind = "problem", code = "RESTORE_ERROR" }); }
                    try { Require(source.Close()); sourceClosed = true; } catch { result = 1; }
                }
                if (session.State == 3) try { Require(session.Close()); dsmClosed = true; } catch { result = 1; }
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
                    ownedLoopJoined = true;
                }
            }
            Send(new { kind = "completed", imageCount = images, outcome = result != 0 ? "ERROR" : empty ? "SOURCE_EXHAUSTED" : "COMPLETED",
                sourceExhausted = empty ? "REPORTED_EMPTY" : "UNKNOWN", elapsedMs = elapsed.ElapsedMilliseconds,
                restoredSettings, sourceClosed, dsmClosed, ownedLoopJoined, acquisitionEnables = started ? 1 : 0 });
        }
        return result;
    }
    private static int Fixture(string scenario)
    {
        if (!new[] { "normal", "early-empty", "overtransfer", "restore-error", "late-exit-error", "closure-proof-missing", "prepare-close-error",
            "blank-discard-auto", "blank-proof-missing", "blank-proof-malformed", "old-profile", "wrong-driver", "wrong-source",
            "wrong-frame", "capture-proof-missing", "invariant-proof-missing", "invariant-proof-malformed" }.Contains(scenario)) return 2;
        var prepare = Read(); int target = Convert.ToInt32(prepare["target"]);
        if ((string)prepare["action"] != "prepare" || target < 1 || target > 3) return 2;
        var proof = new Dictionary<string, object> { { "kind", "prepared" }, { "target", target }, { "dpi", 600 }, { "autoScan", false },
            { "blankDiscard", false }, { "profileVersion", ProfileVersion }, { "driver", ProfileDriver }, { "protocol", "2.4" },
            { "source", "PaperStream IP fi-7160" }, { "widthInches", 2.7 }, { "heightInches", 3.6 },
            { "captureReadbacksVerified", true }, { "observedInvariantVerified", true }, { "feederLoaded", false }, { "fixture", true } };
        if (scenario == "blank-proof-missing") proof.Remove("blankDiscard");
        if (scenario == "blank-proof-malformed") proof["blankDiscard"] = 0;
        if (scenario == "blank-discard-auto") proof["blankDiscard"] = true;
        if (scenario == "old-profile") proof["profileVersion"] = 1;
        if (scenario == "wrong-driver") proof["driver"] = "3.40 3.40.2.1815 different build";
        if (scenario == "wrong-source") proof["source"] = "Other scanner";
        if (scenario == "wrong-frame") proof["widthInches"] = 2.6;
        if (scenario == "capture-proof-missing") proof.Remove("captureReadbacksVerified");
        if (scenario == "invariant-proof-missing") proof.Remove("observedInvariantVerified");
        if (scenario == "invariant-proof-malformed") proof["observedInvariantVerified"] = 0;
        Send(proof);
        var start = Read(); if ((string)start["action"] == "close")
        {
            Send(new { kind = "completed", imageCount = 0, outcome = scenario == "prepare-close-error" ? "ERROR" : "COMPLETED",
                restoredSettings = scenario == "prepare-close-error" ? 11 : 12,
                sourceClosed = true, dsmClosed = true, ownedLoopJoined = true, acquisitionEnables = 0 });
            return scenario == "prepare-close-error" ? 1 : 0;
        }
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
        var completion = new Dictionary<string, object> { { "kind", "completed" }, { "imageCount", count },
            { "outcome", scenario == "early-empty" ? "SOURCE_EXHAUSTED" : "COMPLETED" },
            { "sourceExhausted", scenario == "early-empty" ? "REPORTED_EMPTY" : "UNKNOWN" }, { "elapsedMs", 1 },
            { "restoredSettings", scenario == "restore-error" ? 11 : 12 }, { "sourceClosed", true },
            { "dsmClosed", true }, { "ownedLoopJoined", true }, { "acquisitionEnables", 1 } };
        if (scenario == "closure-proof-missing") completion.Remove("ownedLoopJoined");
        Send(completion);
        return scenario == "late-exit-error" ? 1 : 0;
    }
}
