using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using NTwain;
using NTwain.Data;

// First mechanical gate only. No website credential, receipt or Inventory access.
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
        if (Process.GetProcessesByName("Mtg.ScannerAgent").Length > 0 || Process.GetProcessesByName("NAPS2.Worker").Length > 0 ||
            Process.GetProcessesByName("CountProbe").Length > 0 || Process.GetProcessesByName("CountFeed").Length > 1)
            throw new InvalidOperationException("Conflicting scanner owner; no feed authorized");
    }
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "selftest") { CountFeedPolicy.SelfTest(); return 0; }
        int target;
        try { target = CountFeedPolicy.Target(args); }
        catch (ArgumentException)
        {
            Console.Error.WriteLine("Usage: CountFeed.exe feed-one-of-three|feed-two-of-three <NEW absolute private directory> operator-ready");
            return 2;
        }
        NoOtherOwner();
        if (IntPtr.Size != 4) throw new InvalidOperationException("Use x86");
        CountFeedPolicy.RequireNewDirectory(args[1]);
        Directory.CreateDirectory(args[1]);
        using (var start = new FileStream(Path.Combine(args[1], "feed.lock"), FileMode.CreateNew, FileAccess.Write, FileShare.None))
        using (journal = new StreamWriter(new FileStream(Path.Combine(args[1], "events.log"), FileMode.CreateNew, FileAccess.Write, FileShare.Read)))
        {
            Log("operator-ready; loaded=3; requestedImages=" + target + "; physicalCount=UNKNOWN; no automatic retry");
            PlatformInfo.Current.PreferNewDSM = false;
            var session = new TwainSession(TWIdentity.CreateFromAssembly(DataGroups.Image | DataGroups.Control, Assembly.GetExecutingAssembly()));
            DataSource source = null;
            var enabled = false;
            var resultCode = 1;
            try
            {
                Require(session.Open(), "open legacy DSM");
                source = session.Single(d => d.Name == "PaperStream IP fi-7160");
                Require(source.Open(), "open exact fi-7160 source");
                Log("source=" + source.Name + "; driver=" + source.Version + "; protocol=" + source.ProtocolVersion);
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
                TWImageLayout layout;
                Require(source.DGImage.ImageLayout.Get(out layout), "get frame");
                Log("driver current frame retained; left=" + layout.Frame.Left + "; top=" + layout.Frame.Top +
                    "; right=" + layout.Frame.Right + "; bottom=" + layout.Frame.Bottom + "; no frame/crop/deskew change");
                if (source.Capabilities.CapFeederLoaded.GetCurrent() != BoolType.True) throw new InvalidOperationException("Hopper is empty; no feed started");
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
                NoOtherOwner();
                Log("EnableAuthorized; negotiation accepted; physical stop remains UNQUALIFIED");
                Require(source.Enable(SourceEnableMode.NoUI, false, IntPtr.Zero), "enable source ONCE");
                enabled = true;
                // Count is configured before Enable; no cancellation after an image.
                // A timeout never retries or kills an uncertain active transport.
                while (!finished.WaitOne(30000)) Log("WAITING; nativeState=" + session.State + "; no retry/cancellation; operator must inspect transport");
                Log("TransfersComplete images=" + images + "; failures=" + failures + "; physicalCount=UNKNOWN; hopper/transport observation required");
                resultCode = images == target && failures == 0 ? 0 : 1;
            }
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
                    Log("close source=" + source.Close());
                }
                if (session.State == 3) Log("close DSM=" + session.Close());
            }
            return resultCode;
        }
    }
}
