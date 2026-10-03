using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading;
using NTwain;
using NTwain.Data;

// Revised small mechanical gate only. No website credential or Inventory access.
// CAP_XFERCOUNT is image count; operator observation determines physical success.
internal static class CountFeed
{
    private static StreamWriter journal;
    private static int images;
    private static int failures;
    private static readonly ManualResetEvent finished = new ManualResetEvent(false);
    private static readonly List<Action> restoreSettings = new List<Action>();

    private static void Log(string value)
    {
        var line = DateTimeOffset.UtcNow.ToString("O") + " " + value;
        lock (journal) { journal.WriteLine(line); journal.Flush(); }
        Console.WriteLine(line);
    }
    private static void Require(ReturnCode result, string operation)
    {
        Log(operation + "=" + result);
        if (result != ReturnCode.Success) throw new InvalidOperationException(operation + " failed");
    }
    private static void SetExact<T>(string name, ICapWrapper<T> capability, T requested)
    {
        if (!capability.CanSet || !capability.CanGetCurrent) throw new InvalidOperationException(name + " cannot be verified");
        var before = capability.GetCurrent();
        restoreSettings.Add(delegate {
            var result = capability.SetValue(before);
            var restored = capability.GetCurrent();
            Log(name + " RESTORE=" + result + "; readback=" + restored);
            if (result != ReturnCode.Success || !Object.Equals(before, restored))
                throw new InvalidOperationException(name + " restore needs operator attention");
        });
        Require(capability.SetValue(requested), name + " SET " + requested);
        var readback = capability.GetCurrent();
        Log(name + " GETCURRENT=" + readback);
        CountFeedPolicy.RequireReadback(true, requested, readback);
    }
    private static void NoOtherOwner()
    {
        foreach (var name in new[] { "Mtg.ScannerAgent", "NAPS2.Worker", "Mtg.CountedTwain", "CountProbe",
            "ProfileSettingsInspect", "PrePickInspect", "PrePickSettings" })
            if (Process.GetProcessesByName(name).Length > 0)
                throw new InvalidOperationException("Conflicting scanner owner; no feed authorized");
        if (Process.GetProcessesByName("CountFeed").Length != 1)
            throw new InvalidOperationException("Duplicate diagnostic; no feed authorized");
    }
    private static void Invariant(DataSource source)
    {
        var cap = new CapWrapper<object>(source, (CapabilityId)0x80FD, v => v,
            (Func<object, ReturnCode>)(v => { throw new InvalidOperationException("Vendor SET forbidden"); }));
        GuardedFeedPolicy.RequireObservedInvariant(cap.CanGetCurrent, cap.CanGetCurrent ? cap.GetCurrent() : null);
        Log("Observed driver invariant 0x80FD UInt16=0; correlation only, separate visible Off/readiness required");
    }
    private static void Frame(DataSource source)
    {
        TWImageLayout layout;
        Require(source.DGImage.ImageLayout.Get(out layout), "get frame");
        if (Math.Abs((double)layout.Frame.Left) > .001 || Math.Abs((double)layout.Frame.Top) > .001 ||
            Math.Abs((double)layout.Frame.Right - 2.7) > .001 || Math.Abs((double)layout.Frame.Bottom - 3.6) > .001)
            throw new InvalidOperationException("Frame differs from inspected worker profile");
    }
    private static void Readback<T>(IReadOnlyCapWrapper<T> cap, T requested)
    {
        CountFeedPolicy.RequireReadback(cap.CanGetCurrent, requested, cap.CanGetCurrent ? cap.GetCurrent() : default(T));
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
        Frame(source); Invariant(source);
    }
    private static string Hash(string path)
    {
        using (var sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(path))).Replace("-", "");
    }
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "selftest") { CountFeedPolicy.SelfTest(); GuardedFeedPolicy.SelfTest(); return 0; }
        int target;
        try { target = GuardedFeedPolicy.Target(args); }
        catch (ArgumentException)
        {
            Console.Error.WriteLine("Usage: CountFeed.exe qualify-one-of-three|qualify-two-of-three <NEW absolute private directory> <known Mtg.CountedTwain.exe>; legacy feeding suspended");
            return 2;
        }
        NoOtherOwner();
        if (Process.GetProcessesByName("fjictwsv").Length > 0)
            throw new InvalidOperationException("Native settings owner already exists");
        if (IntPtr.Size != 4) throw new InvalidOperationException("Use x86");
        var workerIdentity = Assembly.LoadFile(args[2]);
        if (workerIdentity.GetName().Name != "Mtg.CountedTwain") return 2;
        CountFeedPolicy.RequireNewDirectory(args[1]);
        Directory.CreateDirectory(args[1]);
        using (var start = new FileStream(Path.Combine(args[1], "feed.lock"), FileMode.CreateNew, FileAccess.Write, FileShare.None))
        using (journal = new StreamWriter(new FileStream(Path.Combine(args[1], "events.log"), FileMode.CreateNew, FileAccess.Write, FileShare.Read)))
        {
            var nonce = Guid.NewGuid().ToString("N");
            Log("EMPTY INSPECTION ONLY; requestedImages=" + target + "; physicalCount=UNKNOWN; session=" + nonce);
            Log("workerSHA256=" + Hash(args[2]) + "; diagnosticSHA256=" + Hash(Assembly.GetExecutingAssembly().Location));
            PlatformInfo.Current.PreferNewDSM = false;
            var session = new TwainSession(TWIdentity.CreateFromAssembly(DataGroups.Image | DataGroups.Control, workerIdentity));
            var loop = new OwnedTwainLoop();
            DataSource source = null;
            var enabled = false;
            var resultCode = 1;
            try
            {
                loop.Invoke(delegate { Require(session.Open(loop.Hook), "open legacy DSM"); });
                source = session.Single(d => d.Name == "PaperStream IP fi-7160");
                Require(source.Open(), "open exact fi-7160 source");
                Log("source=" + source.Name + "; driver=" + source.Version + "; protocol=" + source.ProtocolVersion);
                if (!source.Version.ToString().Contains("3.40.2.1815") || source.ProtocolVersion.ToString() != "2.4")
                    throw new InvalidOperationException("Unqualified driver/protocol");
                Readback(source.Capabilities.CapFeederLoaded, BoolType.False);
                Invariant(source);
                SetExact("CAP_FEEDERENABLED", source.Capabilities.CapFeederEnabled, BoolType.True);
                SetExact("CAP_DUPLEXENABLED", source.Capabilities.CapDuplexEnabled, BoolType.False);
                SetExact("CAP_AUTOFEED", source.Capabilities.CapAutoFeed, BoolType.True);
                SetExact("CAP_AUTOSCAN", source.Capabilities.CapAutoScan, BoolType.False);
                SetExact("CAP_XFERCOUNT", source.Capabilities.CapXferCount, target);
                SetExact("ICAP_XFERMECH", source.Capabilities.ICapXferMech, XferMech.Native);
                SetExact("ICAP_PIXELTYPE", source.Capabilities.ICapPixelType, PixelType.RGB);
                SetExact("ICAP_BITDEPTH", source.Capabilities.ICapBitDepth, 24);
                SetExact("ICAP_XRESOLUTION", source.Capabilities.ICapXResolution, (TWFix32)600f);
                SetExact("ICAP_YRESOLUTION", source.Capabilities.ICapYResolution, (TWFix32)600f);
                SetExact("ICAP_UNITS", source.Capabilities.ICapUnits, Unit.Inches);
                SetExact("ICAP_AUTODISCARDBLANKPAGES", source.Capabilities.ICapAutoDiscardBlankPages, BlankPage.Disable);
                CaptureReadback(source, target);
                Readback(source.Capabilities.CapEnableDSUIOnly, BoolType.True);
                var inspecting = true;
                session.TransferReady += delegate(object sender, TransferReadyEventArgs e) {
                    if (inspecting) { failures++; e.CancelAll = true; Log("UNEXPECTED transfer request during empty settings inspection refused"); }
                };
                session.DataTransferred += delegate(object sender, DataTransferredEventArgs e)
                {
                    try
                    {
                        using (var input = e.GetNativeImageStream())
                        using (var image = Image.FromStream(input))
                        {
                            var sequence = Interlocked.Increment(ref images);
                            var pending = Path.Combine(args[1], sequence + ".pending.png");
                            image.Save(pending, ImageFormat.Png);
                            File.Move(pending, Path.Combine(args[1], sequence + ".png"));
                            Log("ImageRetained sequence=" + sequence + "; width=" + image.Width + "; height=" + image.Height);
                            if (sequence > target) { failures++; Log("OVERTRANSFER; operator must reconcile physical transport; no next test"); }
                        }
                    }
                    catch (Exception error) { failures++; Log("RetentionError=" + error); }
                };
                session.TransferError += delegate(object sender, TransferErrorEventArgs e) { failures++; Log("TransferError status=" + e.SourceStatus.ConditionCode + "; error=" + e.Exception); };
                session.TransferCanceled += delegate { failures++; Log("TransferCanceled; physical reconciliation required"); };
                session.SourceDisabled += delegate { Log("SourceDisabled; state=" + session.State); finished.Set(); };
                Log("ShowUIOnly ONCE; read initially selected profile and visible Pre-Pick Off, then Cancel unchanged; keep hopper empty");
                Require(source.Enable(SourceEnableMode.ShowUIOnly, false, IntPtr.Zero), "settings-only UI");
                while (!finished.WaitOne(30000)) Log("WAITING for settings close; no acquisition or readiness admission");
                if (session.State != 4 || failures != 0 || images != 0)
                    throw new InvalidOperationException("Unexpected settings outcome; no feed authorized");
                Readback(source.Capabilities.CapFeederLoaded, BoolType.False);
                CaptureReadback(source, target);
                finished.Reset();
                var expected = GuardedFeedPolicy.Authorization(nonce, target);
                File.WriteAllText(Path.Combine(args[1], "readiness-challenge.txt"), expected);
                Log("AWAITING fresh visible-Off and three-expendable-card loading/clear-transport readiness; no feed queued");
                var authorize = Path.Combine(args[1], "authorize-once.txt");
                while (!File.Exists(authorize))
                {
                    if (File.Exists(Path.Combine(args[1], "cancel-before-feed.txt")))
                    { throw new OperationCanceledException("Cancelled before feed; acquisition Enable calls=0"); }
                    Thread.Sleep(250);
                }
                if (File.Exists(Path.Combine(args[1], "cancel-before-feed.txt")))
                    throw new OperationCanceledException("Cancelled before feed; acquisition Enable calls=0");
                GuardedFeedPolicy.RequireAuthorization(File.ReadAllText(authorize), nonce, target);
                File.Move(authorize, Path.Combine(args[1], "authorization-consumed.txt"));
                Log("Same-session explicit Off/loading/readiness consumed ONCE");
                CaptureReadback(source, target);
                Readback(source.Capabilities.CapFeederLoaded, BoolType.True);
                NoOtherOwner();
                if (Process.GetProcessesByName("fjictwsv").Length > 1)
                    throw new InvalidOperationException("Additional native driver owner");
                inspecting = false;
                Log("EnableAuthorized; negotiation accepted; physical stop remains UNQUALIFIED");
                Require(source.Enable(SourceEnableMode.NoUI, false, IntPtr.Zero), "enable source ONCE");
                enabled = true;
                // Count is configured before Enable; no cancellation after an image.
                // A timeout never retries or kills an uncertain active transport.
                while (!finished.WaitOne(30000)) Log("WAITING; nativeState=" + session.State + "; no retry/cancellation; operator must inspect transport");
                Log("TransfersComplete images=" + images + "; failures=" + failures + "; physicalCount=UNKNOWN; hopper/transport observation required");
                resultCode = images == target && failures == 0 ? 0 : 1;
            }
            catch (OperationCanceledException error) { resultCode = 0; Log(error.Message); }
            catch (Exception error) { Log("FAILED=" + error); }
            finally
            {
                if (session.State > 4)
                {
                    Log("TRANSPORT UNCERTAIN; enabled=" + enabled + "; waiting without force-step-down/refeed");
                    while (session.State > 4)
                    {
                        finished.WaitOne(30000);
                        if (session.State > 4) { Log("WAITING for source disable; operator reconciliation required"); Thread.Sleep(100); }
                    }
                }
                if (session.State == 4 && source != null)
                {
                    for (var i = restoreSettings.Count - 1; i >= 0; i--)
                        try { restoreSettings[i](); } catch (Exception error) { resultCode = 1; Log("RestoreError=" + error); }
                    try { Require(source.Close(), "close source"); } catch (Exception error) { resultCode = 1; Log("CloseError=" + error); }
                }
                if (session.State == 3) try { Require(session.Close(), "close DSM"); } catch (Exception error) { resultCode = 1; Log("CloseError=" + error); }
                // Keep the owning thread/window alive if closure is uncertain.
                // Never force disposal while a DSM/source remains open.
                while (session.State != 2)
                {
                    resultCode = 1;
                    Log("CLOSURE UNCERTAIN; state=" + session.State + "; retaining message loop; no retry/refeed");
                    Thread.Sleep(30000);
                }
                loop.Dispose();
                Log("Owned message loop disposed and thread joined; state=2");
            }
            return resultCode;
        }
    }
}
