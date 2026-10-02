using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using NTwain;
using NTwain.Data;

// Private, motor-free negotiation probe. Never enables a source or transfers an image.
// The installed NAPS2 helper is unchanged. Build as x86 for the fi-7160 source.
internal static class CountProbe
{
    private const ushort SheetCount = 0x104f; // TWAIN 2.5 CAP_SHEETCOUNT

    private static int Main(string[] args)
    {
        if (args.Length != 1 || (args[0] != "probe-empty-hopper" && args[0] != "probe-empty-hopper-old-dsm"))
        {
            Console.Error.WriteLine("Usage: CountProbe.exe probe-empty-hopper|probe-empty-hopper-old-dsm (operator must confirm empty transport/hopper)");
            return 2;
        }
        if (IntPtr.Size != 4) throw new InvalidOperationException("An x86 build is required");
        if (Process.GetProcessesByName("Mtg.ScannerAgent").Length != 0 ||
            Process.GetProcessesByName("NAPS2.Worker").Length != 0)
        {
            Console.Error.WriteLine("BLOCKED: existing helper/worker ownership. No DSM/source opened.");
            return 3;
        }
        var identity = TWIdentity.CreateFromAssembly(DataGroups.Image | DataGroups.Control, Assembly.GetExecutingAssembly());
        PlatformInfo.Current.PreferNewDSM = args[0] != "probe-empty-hopper-old-dsm";
        var session = new TwainSession(identity);
        DataSource source = null;
        try
        {
            Console.WriteLine("architecture=x86; dsm=" + PlatformInfo.Current.ExpectedDsmPath);
            Require(session.Open(), "open DSM");
            foreach (var device in session) Console.WriteLine("source=" + device.Name);
            // Exact model only; never substitute another enumerated device.
            var matches = session.Where(d => d.Name == "PaperStream IP fi-7160").ToArray();
            if (matches.Length != 1) throw new InvalidOperationException("Expected one fi-7160 source; found " + matches.Length);
            source = matches[0];
            Require(source.Open(), "open fi-7160 source");
            Console.WriteLine("selected=" + source.Name + "; protocol=" + source.ProtocolVersion + "; driver=" + source.Version);
            Describe("CAP_FEEDERLOADED", source.Capabilities.CapFeederLoaded);
            Describe("CAP_AUTOFEED", source.Capabilities.CapAutoFeed);
            Describe("CAP_AUTOSCAN", source.Capabilities.CapAutoScan);
            Describe("CAP_FEEDERPREP", source.Capabilities.CapFeederPrep);
            Describe("CAP_DUPLEXENABLED", source.Capabilities.CapDuplexEnabled);
            Describe("CAP_XFERCOUNT", source.Capabilities.CapXferCount);
            var sheets = new CapWrapper<uint>(source, (CapabilityId)SheetCount,
                value => Convert.ToUInt32(value),
                value => new TWOneValue { ItemType = ItemType.UInt32, Item = value });
            Describe("CAP_SHEETCOUNT", sheets);
            // Negotiation remains in state 4. Nothing calls Enable, FeedPage, or scan.
            ProbeSet("CAP_SHEETCOUNT", sheets, 1u);
            ProbeSet("CAP_XFERCOUNT", source.Capabilities.CapXferCount, 1);
            ProbeSet("CAP_AUTOSCAN", source.Capabilities.CapAutoScan, BoolType.False);
            Console.WriteLine("COMPLETE: no source Enable or image transfer. Readback is not physical qualification.");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("FAILED: " + error.GetType().Name + ": " + error.Message);
            return 1;
        }
        finally
        {
            if (session.State == 4 && source != null) Console.WriteLine("close source=" + source.Close());
            if (session.State == 3) Console.WriteLine("close DSM=" + session.Close());
            if (session.State > 4) Console.Error.WriteLine("Unexpected transport state; manual reconciliation required. No automatic retry.");
        }
    }

    private static void Require(ReturnCode result, string operation)
    {
        if (result != ReturnCode.Success) throw new InvalidOperationException(operation + ": " + result);
    }
    private static void Describe<T>(string name, IReadOnlyCapWrapper<T> capability)
    {
        var writable = capability as ICapWrapper<T>;
        Console.WriteLine(name + ": get=" + capability.CanGet + "; current=" + capability.CanGetCurrent +
            "; set=" + (writable != null && writable.CanSet) +
            "; value=" + (capability.CanGetCurrent ? Convert.ToString(capability.GetCurrent()) : "UNKNOWN"));
    }
    private static void ProbeSet<T>(string name, ICapWrapper<T> capability, T requested)
    {
        if (!capability.CanSet || !capability.CanGetCurrent)
        {
            Console.WriteLine(name + " negotiation=UNAVAILABLE; no count guarantee");
            return;
        }
        var before = capability.GetCurrent();
        try
        {
            var result = capability.SetValue(requested);
            var after = capability.GetCurrent();
            Console.WriteLine(name + " request=" + requested + "; result=" + result + "; readback=" + after +
                "; accepted=" + (result == ReturnCode.Success && Object.Equals(requested, after)));
        }
        finally
        {
            var restored = capability.SetValue(before);
            var current = capability.GetCurrent();
            Console.WriteLine(name + " restore=" + restored + "; readback=" + current);
            if (restored != ReturnCode.Success || !Object.Equals(before, current))
                throw new InvalidOperationException(name + " configuration restore needs operator attention");
        }
    }
}
