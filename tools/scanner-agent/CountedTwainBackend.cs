using System.Diagnostics;
using System.Text.Json;

namespace Mtg.Scanner;

// Explicit profile route; refusal never falls back to an unbounded SDK scan.
public sealed class CountedTwainBackend : IScannerBackend
{
    private readonly string? fixtureScenario;
    private readonly bool requireEmpty;
    public CountedTwainBackend() { }
    internal CountedTwainBackend(string fixtureScenario, bool requireEmpty = false) { this.fixtureScenario = fixtureScenario; this.requireEmpty = requireEmpty; }
    internal CountedTwainBackend(bool requireEmpty) { this.requireEmpty = requireEmpty; }
    public const string DeviceId = "CountedTwain:PaperStream IP fi-7160";
    public const string BackendId = "fi7160-counted-twain-v1";
    public static string WorkerPath => Path.Combine(AppContext.BaseDirectory, "counted-twain", "Mtg.CountedTwain.exe");
    internal const string ProfileDriver = "3.40 3.40.2.1815 Mar 16 2026";
    internal const int ProfileVersion = 2;
    public static Device ProfileDevice => new(DeviceId, "fi-7160 (Cards, Pre-Pick Off)", BackendId, "Twain", Qualification.KnownWorking);
    private Process? worker;
    private ScanRequest? prepared;
    private RunSpool? spool;
    private bool started, closed;
    private bool stopped;
    internal JsonElement? PreparationEvidence { get; private set; }
    internal JsonElement? CloseEvidence { get; private set; }
    public Task<IReadOnlyList<Device>> ListDevices() => Task.FromResult<IReadOnlyList<Device>>([ProfileDevice]);
    public Task<Capabilities> GetCapabilities(string id)
    {
        if (id != DeviceId) throw new ArgumentException("Wrong counted profile");
        return Task.FromResult(new Capabilities(new() {
            ["feeder"] = new(Support.ReportedSupported, "PaperStream fi-7160 scoped profile"),
            ["countControl"] = new(Support.ReportedSupported, "Scoped one/two/five/ten physical tests passed; exact driver, twelve capture settings and observed profile invariant required before Start"),
            ["physicalBoundaries"] = new(Support.NotExposed, "Transfer count remains image count; operator reconciliation required")
        }, [600], "PFU", "fi-7160", "2.4"));
    }
    internal static void Validate(ScanRequest request)
    {
        if (request.RunId == Guid.Empty || request.DeviceId != DeviceId || request.SessionPhysicalTarget is not (>= 1 and <= 5000) ||
            request.Dpi != 600 || request.WidthInches != 2.7m || request.HeightInches != 3.6m ||
            request.HorizontalPlacement != "Center" || request.Duplex || request.ImageStopBudget != null || request.AllowInterruptingStop)
            throw new InvalidOperationException("Unsupported counted profile; no feed authorized");
    }
    private async Task Write(object value)
    {
        await worker!.StandardInput.WriteLineAsync(JsonSerializer.Serialize(value, RunSpool.Json));
        await worker.StandardInput.FlushAsync();
    }
    private async Task<JsonElement> Read()
    {
        var line = await worker!.StandardOutput.ReadLineAsync();
        if (line == null || line.Length > 16384) throw new InvalidDataException("Counted worker channel ended; retain originals and reconcile");
        return JsonSerializer.Deserialize<JsonElement>(line);
    }
    public async Task Prepare(ScanRequest request)
    {
        ObjectDisposedException.ThrowIf(closed, this);
        if (worker != null) throw new InvalidOperationException("Use one backend per feed segment");
        Validate(request);
        var start = new ProcessStartInfo(WorkerPath) { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true };
        start.ArgumentList.Add(fixtureScenario == null ? "helper-channel-v2" : "fixture-channel-v1");
        if (fixtureScenario != null) start.ArgumentList.Add(fixtureScenario);
        worker = Process.Start(start) ?? throw new InvalidOperationException("Counted worker unavailable");
        await Write(new { action = "prepare", profileVersion = ProfileVersion, parent = Environment.ProcessId,
            target = request.SessionPhysicalTarget, requireEmpty });
        var ack = await Read();
        RequirePrepared(ack, request.SessionPhysicalTarget!.Value, requireEmpty);
        PreparationEvidence = ack;
        prepared = request;
    }
    private static bool True(JsonElement value, string name) => value.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.True;
    private static bool False(JsonElement value, string name) => value.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.False;
    private static bool Number(JsonElement value, string name, decimal expected) => value.TryGetProperty(name, out var p) &&
        p.ValueKind == JsonValueKind.Number && p.TryGetDecimal(out var actual) && actual == expected;
    private static bool Frame(JsonElement value, string name, decimal expected) => value.TryGetProperty(name, out var p) &&
        p.ValueKind == JsonValueKind.Number && p.TryGetDecimal(out var actual) && Math.Abs(actual - expected) < .001m;
    private static bool String(JsonElement value, string name, string expected) => value.TryGetProperty(name, out var p) &&
        p.ValueKind == JsonValueKind.String && p.GetString() == expected;
    internal static void RequirePrepared(JsonElement ack, int target, bool requireEmpty = false)
    {
        if (!String(ack, "kind", "prepared") || !Number(ack, "target", target) || !Number(ack, "profileVersion", ProfileVersion) ||
            !String(ack, "driver", ProfileDriver) || !String(ack, "protocol", "2.4") ||
            !String(ack, "source", "PaperStream IP fi-7160") || !Number(ack, "dpi", 600) ||
            !Frame(ack, "widthInches", 2.7m) || !Frame(ack, "heightInches", 3.6m) ||
            !True(ack, "captureReadbacksVerified") || !True(ack, "observedInvariantVerified") ||
            !False(ack, "autoScan") || !False(ack, "blankDiscard") || requireEmpty && !False(ack, "feederLoaded"))
            throw new InvalidOperationException("Counted capability negotiation failed; no feed started");
    }
    public async Task Start(RunSpool output)
    {
        ObjectDisposedException.ThrowIf(closed, this);
        if (requireEmpty || started || prepared == null) throw new InvalidOperationException("Prepare once before Start; empty qualification cannot feed");
        started = true; spool = output;
        output.Event("AcquisitionStarted", new { requested = prepared, route = BackendId,
            actualConfiguration = fixtureScenario != null ? "Fixture channel; no TWAIN session constructed" :
                "PaperStream 3.40.2.1815 / legacy x86 DSM / verified simplex native RGB24 600 / current 2.7x3.6 frame / AUTOSCAN=false / blank-page discard disabled",
            physicalCount = "UNKNOWN; operator observation required" });
        var retained = 0; var error = false;
        try
        {
            await Write(new { action = "start", directory = output.DirectoryPath });
            while (true)
            {
                var message = await Read();
                var kind = message.GetProperty("kind").GetString();
                if (kind == "image")
                {
                    var id = message.GetProperty("id").GetGuid();
                    var sequence = message.GetProperty("sequence").GetInt32();
                    if (sequence != retained + 1) throw new InvalidDataException("Counted transfer sequence changed");
                    output.PublishImage(Path.Combine(output.DirectoryPath, $"{id}.pending.png"), id, sequence,
                        message.GetProperty("width").GetInt32(), message.GetProperty("height").GetInt32());
                    retained++;
                    // Retain every overtransfer and make the run unsafe to resume.
                    if (retained > prepared.SessionPhysicalTarget) error = true;
                }
                else if (kind == "problem")
                {
                    var code = message.GetProperty("code").GetString();
                    if (code != "SOURCE_EMPTY") error = true;
                    output.Event("CountedDriverProblem", new { code });
                }
                else if (kind == "waiting") output.Event("TransportNeedsAttention", message);
                else if (kind == "completed")
                {
                    // Completion is authoritative only after the actual child
                    // exit. A late shutdown fault must not publish success.
                    await worker!.WaitForExitAsync();
                    if (worker.ExitCode != 0 || !CleanClosure(message)) error = true;
                    if (message.GetProperty("imageCount").GetInt32() != retained) error = true;
                    var outcome = message.GetProperty("outcome").GetString();
                    if (outcome == "ERROR") error = true;
                    if (error) output.Event("ScannerError", new { type = "CountedTwainReconciliationRequired", nativeStatus = 0 });
                    output.Event("AcquisitionCompleted", new { outcome = error ? "ERROR" : stopped ? "DRAINED_AFTER_UNSUPPORTED_STOP" : outcome,
                        imageCount = retained, elapsedMs = message.GetProperty("elapsedMs").GetInt64(), knownPhysicalItems = (int?)null,
                        sourceExhausted = message.GetProperty("sourceExhausted").GetString(), nativeState = error ? "Source settled; reconciliation/settings inspection required" : "Source disabled, settings restored and DSM closed" });
                    break;
                }
                else throw new InvalidDataException("Unexpected counted worker response");
            }
        }
        catch (Exception exception)
        {
            output.Event("ScannerError", Naps2Backend.SafeError(exception));
            // No fabricated successful completion. Pending originals stay in
            // the same durable spool; recovery cannot start a new native feed.
            throw;
        }
        finally { spool = null; }
    }
    public void RequestStop(string reason)
    {
        stopped = true;
        spool?.Event("StopRequested", new { reason, method = "Await current preconfigured count; no new segment", guarantee = "No immediate interrupt" });
    }
    public void Cancel(string reason) => RequestStop(reason);
    private static bool CleanClosure(JsonElement message) => Number(message, "restoredSettings", 12) &&
        True(message, "sourceClosed") && True(message, "dsmClosed") && True(message, "ownedLoopJoined");
    public void Close()
    {
        if (closed) return;
        try
        {
            if (worker == null) return;
            if (!started)
            {
                if (!worker.HasExited) try { Write(new { action = "close" }).GetAwaiter().GetResult(); } catch (IOException) { }
                JsonElement? completion = null;
                string? line;
                while ((line = worker.StandardOutput.ReadLine()) != null)
                {
                    var message = JsonSerializer.Deserialize<JsonElement>(line);
                    if (String(message, "kind", "completed")) completion = message;
                }
                worker.WaitForExit();
                if (prepared != null && (worker.ExitCode != 0 || completion == null ||
                    !CleanClosure(completion.Value) || !Number(completion.Value, "acquisitionEnables", 0) ||
                    !Number(completion.Value, "imageCount", 0) || !String(completion.Value, "outcome", "COMPLETED")))
                    throw new InvalidDataException("Counted preparation did not close cleanly; inspect settings before retrying");
                CloseEvidence = completion;
            }
            else
            {
                // Never terminate an active transport. Drain any remaining
                // responses so originals stay recoverable from the same spool.
                while (worker.StandardOutput.ReadLine() != null) { }
                worker.WaitForExit();
            }
        }
        finally { worker?.Dispose(); closed = true; }
    }
    public void Dispose() => Close();
}
