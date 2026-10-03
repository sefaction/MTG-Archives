using Microsoft.Extensions.Logging;
using NAPS2.Images;
using NAPS2.Images.Gdi;
using NAPS2.Scan;
using NAPS2.Scan.Exceptions;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace Mtg.Scanner;

// All NAPS2/TWAIN-specific calls and interpretations are contained here.
public sealed class Naps2Backend : IScannerBackend
{
    private readonly ScanningContext context = new(new GdiImageContext());
    private readonly ScanController controller;
    private readonly ScannerSourceDiscovery<ScanDevice> wiaDiscovery;
    private readonly ScannerSourceDiscovery<ScanDevice> twainDiscovery;
    private readonly CancellationTokenSource cancellation = new();
    private readonly SemaphoreSlim lifecycle = new(1, 1);
    private List<ScanDevice> devices = [];
    private ScanRequest? prepared;
    private ScanOptions? options;
    private RunSpool? spool;
    private string? stopReason;
    private string? cancelReason;
    private bool started;
    private bool closed;
    private readonly string? selectedDeviceId;
    private TwainTransferMode transferMode = TwainTransferMode.Default;
    private TwainDsm dsm = TwainDsm.New;
    private bool useDiagnosticDriverUi;
    // Explicit, private qualification only. Website runs retain their normal
    // settings; there is no automatic retry that could feed another card.
    internal void ConfigureDiagnostic(string mode, TextWriter log)
    {
        ObjectDisposedException.ThrowIf(closed, this);
        if (prepared != null || started) throw new InvalidOperationException("Configure before preparation");
        (transferMode, dsm) = mode switch {
            "default" => (TwainTransferMode.Default, TwainDsm.New),
            "memory" => (TwainTransferMode.Memory, TwainDsm.New),
            "native" => (TwainTransferMode.Native, TwainDsm.New),
            "native-old-dsm" => (TwainTransferMode.Native, TwainDsm.Old),
            "driver-ui" => (TwainTransferMode.Default, TwainDsm.New),
            _ => throw new ArgumentException("Unknown diagnostic mode")
        };
        useDiagnosticDriverUi = mode == "driver-ui";
        context.Logger = new PrivateScannerLogger(log);
    }
    public IReadOnlyList<ScannerDiscoveryIssue> DiscoveryIssues =>
        new[] { wiaDiscovery.Issue, twainDiscovery.Issue }.OfType<ScannerDiscoveryIssue>().ToArray();
    public static object Describe() => new
    {
        agentVersion = ScannerConnection.Version, backendVersion = "0.1.0-spike", backend = "naps2-windows",
        agentAssemblySha256 = Convert.ToHexString(SHA256.HashData(
            File.ReadAllBytes(typeof(Naps2Backend).Assembly.Location))).ToLowerInvariant(),
        sdkPackageVersion = "1.3.0",
        sdkAssemblyVersion = typeof(ScanController).Assembly.GetName().Version?.ToString(),
        os = RuntimeInformation.OSDescription,
        processArchitecture = RuntimeInformation.ProcessArchitecture.ToString(),
        nativeWorkerArchitecture = "x86 for TWAIN; WIA uses host process",
        dsmPreference = "modern-32-bit; loaded DSM version not exposed",
        runtime = RuntimeInformation.FrameworkDescription
    };
    public Naps2Backend(string? selectedDeviceId = null) : this(selectedDeviceId, null, null) { }
    // Qualification seam stays below the scanner boundary and never reaches the
    // website. Fake delegates exercise this real adapter without touching USB.
    internal Naps2Backend(string? selectedDeviceId, Func<Driver, Task<List<ScanDevice>>>? enumerate, Action? initializeWorker,
        Func<DateTimeOffset>? clock = null)
    {
        // WIA never needs the x86 TWAIN worker. Avoid starting the vendor proxy
        // merely to prepare a WIA run. Discovery caches TWAIN for this backend
        // lifetime rather than repeatedly invoking the driver every pulse.
        this.selectedDeviceId = selectedDeviceId;
        controller = new ScanController(context) { PropagateErrors = true };
        enumerate ??= driver => controller.GetDeviceList(driver);
        wiaDiscovery = new("Wia", async () => await enumerate(Driver.Wia), false, clock: clock);
        twainDiscovery = new("Twain", async () => await enumerate(Driver.Twain), true,
            initializeWorker ?? (() => context.SetUpWin32Worker()), clock);
    }
    public async Task<IReadOnlyList<Device>> ListDevices()
    {
        await lifecycle.WaitAsync();
        try
        {
            ObjectDisposedException.ThrowIf(closed, this);
            if (started) throw new InvalidOperationException("Acquisition is active or already used");
            if (selectedDeviceId is not null && !selectedDeviceId.StartsWith("Wia:", StringComparison.Ordinal) &&
                !selectedDeviceId.StartsWith("Twain:", StringComparison.Ordinal))
                throw new ArgumentException("Unknown scanner source identity");
            devices = [];
            // Independent source failures cannot hide an available WIA scanner.
            if (selectedDeviceId is null || selectedDeviceId.StartsWith("Wia:", StringComparison.Ordinal))
                devices.AddRange(await wiaDiscovery.Refresh());
            if (selectedDeviceId is null || selectedDeviceId.StartsWith("Twain:", StringComparison.Ordinal)) {
                devices.AddRange(await twainDiscovery.Refresh());
            }
            if (selectedDeviceId is not null && devices.Count == 0 && DiscoveryIssues.Count > 0)
                throw new InvalidOperationException("Scanner device discovery unavailable");
            var result = devices.Select(d => new Device(Key(d), d.Name, "naps2-windows", d.Driver.ToString())).ToList();
            if (selectedDeviceId is null && File.Exists(CountedTwainBackend.WorkerPath) &&
                devices.Any(d => d.Driver == Driver.Twain && d.Name == "PaperStream IP fi-7160"))
                result.Insert(0, CountedTwainBackend.ProfileDevice);
            return result;
        }
        finally { lifecycle.Release(); }
    }
    private static string Key(ScanDevice device) => $"{device.Driver}:{device.ID}";
    private ScanDevice Find(string id) => devices.SingleOrDefault(d => Key(d) == id)
        ?? throw new ArgumentException("Select an enumerated device identity");
    public async Task<Capabilities> GetCapabilities(string deviceId)
    {
        await lifecycle.WaitAsync();
        try
        {
            ObjectDisposedException.ThrowIf(closed, this);
            if (started) throw new InvalidOperationException("Acquisition is active or already used");
            var caps = await controller.GetCaps(Find(deviceId));
            static Capability Flag(bool? b) => new(b is null ? Support.Unknown :
                b.Value ? Support.ReportedSupported : Support.ReportedUnsupported, "SDK GetCaps");
            var features = new Dictionary<string, Capability>
            {
                ["feeder"] = Flag(caps.PaperSourceCaps?.SupportsFeeder),
                ["duplex"] = Flag(caps.PaperSourceCaps?.SupportsDuplex),
                ["color"] = Flag(caps.FeederCaps?.BitDepthCaps?.SupportsColor),
                ["dpiSelection"] = new(caps.FeederCaps?.DpiCaps is null ? Support.Unknown : Support.ReportedSupported, "SDK GetCaps"),
                // SDK's TWAIN PageSizeCaps defaults custom-size support to true;
                // it does not negotiate/verify arbitrary custom frames here.
                ["customFrame"] = new(Support.Unknown, "SDK accepts a requested frame; device behavior requires measurement"),
                ["uiSuppression"] = new(Support.Unknown, "SDK request available; physical qualification pending"),
                ["gracefulStop"] = new(Support.NotExposed, "Public SDK exposes cancellation only"),
                ["cancel"] = new(Support.ReportedSupported, "SDK CancellationToken; physical effect unqualified"),
                ["physicalBoundaries"] = new(Support.NotExposed, "Page events identify image transfers, not sheets"),
                ["sideMetadata"] = new(Support.NotExposed, "No side identity on public page/image events"),
                ["multifeedEvents"] = new(Support.NotExposed, "Generic driver exception may still report failure"),
                ["deviceCounters"] = new(Support.NotExposed, "No physical counter in public scan result"),
                ["vendorAutoCropControl"] = new(Support.NotExposed, "SDK crop/deskew off does not negotiate every vendor automatic option"),
                ["sourceExhaustion"] = new(Support.Unknown, "Normal SDK return alone does not prove an empty feeder")
            };
            return new(features, caps.FeederCaps?.DpiCaps?.Values?.ToArray(),
                caps.MetadataCaps?.Manufacturer, caps.MetadataCaps?.Model, null);
        }
        finally { lifecycle.Release(); }
    }
    public Task Prepare(ScanRequest request)
    {
        ObjectDisposedException.ThrowIf(closed, this);
        if (started || prepared != null) throw new InvalidOperationException("Use a fresh backend for each run");
        if (request.RunId == Guid.Empty || request.Dpi is < 75 or > 1200 ||
            request.WidthInches is <= 0 or > 20 || request.HeightInches is <= 0 or > 40 ||
            request.ImageStopBudget is <= 0 || request.SessionPhysicalTarget is <= 0 ||
            request.HorizontalPlacement is not ("Start" or "Center" or "End"))
            throw new ArgumentException("Invalid scan request");
        options = new ScanOptions
        {
            Device = Find(request.DeviceId), Driver = Find(request.DeviceId).Driver,
            PaperSource = request.Duplex ? PaperSource.Duplex : PaperSource.Feeder,
            Dpi = request.Dpi, BitDepth = BitDepth.Color,
            PageSize = new PageSize(request.WidthInches, request.HeightInches, PageSizeUnit.Inch),
            PageAlign = request.HorizontalPlacement == "Center" ? HorizontalAlign.Center :
                request.HorizontalPlacement == "Start" ? HorizontalAlign.Right : HorizontalAlign.Left,
            UseNativeUI = useDiagnosticDriverUi,
            TwainOptions = new TwainOptions { Dsm = dsm, TransferMode = transferMode, ShowProgress = false },
            AutoDeskew = false, CropToPageSize = false, StretchToPageSize = false,
            ExcludeBlankPages = false, RotateDegrees = 0, MaxQuality = true
        };
        prepared = request;
        return Task.CompletedTask;
    }
    public async Task Start(RunSpool output)
    {
        await lifecycle.WaitAsync();
        try
        {
            ObjectDisposedException.ThrowIf(closed, this);
            if (started || options is null || prepared is null) throw new InvalidOperationException("Prepare once before starting");
            started = true; spool = output;
            var elapsed = Stopwatch.StartNew();
            var imageCount = 0;
            var outcome = "COMPLETED";
            var exhausted = false;
            output.Event("AcquisitionStarted", new { prepared.RunId, requested = prepared,
                actualConfiguration = "UNKNOWN until returned image measurements", sourceExhausted = "UNKNOWN" });
            try
            {
                // Do not WithCancellation/break on target: drain every complete image
                // yielded by SDK even after cancellation. In-flight native partial
                // images may be unavailable and must be physically reconciled.
                await foreach (var image in controller.Scan(options, cancellation.Token))
                {
                    using (image)
                    {
                        var id = Guid.NewGuid();
                        var temporary = Path.Combine(output.DirectoryPath, $"{id}.pending.png");
                        image.Save(temporary);
                        int width, height;
                        using (var bitmap = System.Drawing.Image.FromFile(temporary))
                        { width = bitmap.Width; height = bitmap.Height; }
                        output.PublishImage(temporary, id, ++imageCount, width, height);
                    }
                    if (prepared.ImageStopBudget is int budget && imageCount >= budget && stopReason == null)
                        RequestStop("diagnostic-image-budget; physical count remains unknown");
                }
            }
            catch (DeviceFeederEmptyException)
            {
                exhausted = true; outcome = "SOURCE_EXHAUSTED";
                output.Event("SourceExhausted", new { evidence = "SDK DeviceFeederEmptyException", imageCount });
            }
            catch (OperationCanceledException) { outcome = "CANCELLED"; }
            catch (Exception error)
            {
                outcome = "ERROR";
                RecordScanError(output, error);
            }
            if (cancelReason != null) outcome = "CANCELLED";
            else if (stopReason != null && outcome != "ERROR") outcome = prepared.AllowInterruptingStop
                ? "STOP_REQUESTED" : "DRAINED_AFTER_UNSUPPORTED_STOP";
            output.Event("AcquisitionCompleted", new { outcome, imageCount,
                elapsedMs = elapsed.ElapsedMilliseconds, knownPhysicalItems = (int?)null,
                sourceExhausted = exhausted ? "REPORTED_EMPTY" : "UNKNOWN", stopReason, cancelReason,
                nativeState = "SDK enumeration ended; physical feeder/transport state requires observation" });
            if (outcome == "ERROR") throw new InvalidOperationException("Acquisition failed; complete images and error evidence remain in spool");
        }
        finally { spool = null; lifecycle.Release(); }
    }
    // ConfigureDiagnostic is the only path that replaces the SDK NullLogger.
    // Preserve exact driver context privately; the transport event stays sanitized.
    internal void RecordScanError(RunSpool output, Exception error)
    {
        try { context.Logger.LogError(error, "Scanner acquisition failed; private diagnostic context"); }
        catch (IOException) { /* Diagnostic disk failure must not suppress the journal. */ }
        catch (ObjectDisposedException) { /* Retain the safe failure even if the private sink closed. */ }
        output.Event("ScannerError", SafeError(error));
    }
    public static object SafeError(Exception error) => new
    {
        type = error.GetType().FullName, nativeStatus = error.HResult,
        innerType = error.InnerException?.GetType().FullName,
        innerStatus = error.InnerException?.HResult,
        details = "Messages/paths omitted from default export; retain private diagnostic context if needed"
    };
    public void RequestStop(string reason)
    {
        if (Interlocked.CompareExchange(ref stopReason, reason, null) != null) return;
        // PS286 qualification observed two emitted cards and a third in transport
        // after one image. Never silently alias graceful stop to native cancel.
        var interrupt = prepared?.AllowInterruptingStop == true;
        spool?.Event("StopRequested", new { reason,
            method = interrupt ? "SDK CancellationToken (explicit diagnostic opt-in)" : "UNSUPPORTED; draining current feeder run",
            guarantee = "NONE", inFlightMayBeLost = interrupt });
        if (interrupt) cancellation.Cancel();
    }
    public void Cancel(string reason)
    {
        if (Interlocked.CompareExchange(ref cancelReason, reason, null) != null) return;
        spool?.Event("CancelRequested", new { reason, method = "SDK CancellationToken", distinctGracefulStop = false });
        cancellation.Cancel();
    }
    public void Close()
    {
        if (closed) return;
        if (!lifecycle.Wait(0)) throw new InvalidOperationException("Cancel and await Start before closing");
        try { closed = true; context.Dispose(); cancellation.Dispose(); }
        finally { lifecycle.Release(); }
    }
    public void Dispose() => Close();
}
