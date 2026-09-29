using System.Diagnostics;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Mtg.Scanner;

public record NativeSettings(int Dpi, decimal WidthInches, decimal HeightInches,
    string HorizontalPlacement, bool Duplex, string Color, bool AutoCrop, bool Deskew, bool RemoveBlank);
public record NativeInstruction(int Version, Guid RunId, Guid Epoch, string SessionId,
    string DeviceId, int LoadedCount, NativeSettings Settings, int? PhysicalTarget,
    bool StopRequested, string Status, Guid? ExecutionId);
public record NativeBinding(int Version, NativeInstruction Instruction, Guid ExecutionId);

// Generic outbound acquisition transport; the existing backend owns all driver
// calls. A durable run directory is never reopened for a second physical feed.
public static class ScannerNativeRunner
{
    private static async Task<JsonElement> Post(HttpClient client, string route, string token, object body)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, route) { Content = JsonContent.Create(body, options: RunSpool.Json) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await client.SendAsync(request);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Scanner transport unavailable; originals retained");
        var result = await response.Content.ReadFromJsonAsync<JsonElement>();
        if (result.GetProperty("version").GetInt32() != 1) throw new InvalidOperationException("Scanner protocol changed");
        return result;
    }
    private static void Identity(JsonElement result, Guid runId)
    {
        if (result.GetProperty("runId").GetGuid() != runId) throw new InvalidOperationException("Scanner run acknowledgement changed");
    }
    private static void Validate(NativeInstruction run)
    {
        var s = run.Settings;
        if (run.Version != 1 || run.RunId == Guid.Empty || run.Epoch == Guid.Empty ||
            run.LoadedCount is < 1 or > 500 || run.PhysicalTarget is <= 0 ||
            s.Dpi is not (300 or 600) || s.WidthInches is < 2.5m or > 4 ||
            s.HeightInches is < 3.5m or > 6 || s.HorizontalPlacement is not ("Start" or "Center" or "End") ||
            s.Duplex || s.Color != "RGB" || s.AutoCrop || s.Deskew || s.RemoveBlank)
            throw new InvalidOperationException("Unsupported scanner instruction; no feed started");
    }
    private static bool SameInstruction(NativeInstruction a, NativeInstruction b) =>
        a.RunId == b.RunId && a.Epoch == b.Epoch && a.SessionId == b.SessionId &&
        a.DeviceId == b.DeviceId && a.LoadedCount == b.LoadedCount &&
        a.Settings == b.Settings && a.PhysicalTarget == b.PhysicalTarget;
    public static async Task PollAndRun(HttpClient client, Guid agentId, string token, string root,
        IReadOnlyList<Device> devices, CancellationToken stop, Func<IScannerBackend>? backendFactory = null, Func<object>? backendDescription = null)
    {
        var poll = await Post(client, "api/scanner-agent/runs", token, new { action = "poll", version = 1 });
        if (poll.GetProperty("agentId").GetGuid() != agentId) throw new InvalidOperationException("Scanner connection changed");
        var value = poll.GetProperty("run");
        if (value.ValueKind == JsonValueKind.Null) return;
        var run = value.Deserialize<NativeInstruction>(RunSpool.Json) ?? throw new InvalidOperationException("Scanner instruction unavailable");
        Validate(run);
        if (poll.GetProperty("epoch").GetGuid() != run.Epoch)
            throw new InvalidOperationException("Scanner site generation changed; reconcile retained originals");
        var runsRoot = Path.Combine(root, agentId.ToString(), "runs");
        var directory = Path.Combine(runsRoot, run.RunId.ToString());
        if (Directory.Exists(directory))
        {
            var binding = JsonSerializer.Deserialize<NativeBinding>(await File.ReadAllTextAsync(Path.Combine(directory, "binding.json")), RunSpool.Json)
                ?? throw new InvalidOperationException("Scanner journal needs reconciliation");
            if (!SameInstruction(binding.Instruction, run) || run.ExecutionId != binding.ExecutionId)
                throw new InvalidOperationException("Scanner run binding changed; no refeed permitted");
            Console.WriteLine("Recovering retained transfers only. Scanner will not restart.");
            await Recover(client, token, directory, binding);
            return;
        }
        if (run.Status != "QUEUED" || run.StopRequested || run.ExecutionId != null)
            throw new InvalidOperationException("Started scanner run has no local journal; manual reconciliation required");
        if (!devices.Any(d=>d.Id == run.DeviceId)) throw new InvalidOperationException("Selected scanner source unavailable");
        Directory.CreateDirectory(runsRoot);
        var drive = new DriveInfo(Path.GetPathRoot(Path.GetFullPath(runsRoot))!);
        if (drive.AvailableFreeSpace < 2L * 1024 * 1024 * 1024 + run.LoadedCount * 10L * 1024 * 1024)
            throw new InvalidOperationException("Private scanner spool needs more free space; no feed started");
        // Shared across this Windows user's pairings/processes, not per run.
        var locks = Path.Combine(root, "devices"); Directory.CreateDirectory(locks);
        var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(run.DeviceId)));
        using var deviceLock = new FileStream(Path.Combine(locks, $"{key}.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        using IScannerBackend backend = (backendFactory ?? (() => new Naps2Backend()))();
        await backend.ListDevices();
        var caps = await backend.GetCapabilities(run.DeviceId);
        if (caps.Features["feeder"].Support == Support.ReportedUnsupported)
            throw new InvalidOperationException("Source reports no feeder; no feed started");
        var request = new ScanRequest(run.RunId, run.DeviceId, run.Settings.Dpi,
            run.Settings.WidthInches, run.Settings.HeightInches, false, null,
            run.PhysicalTarget, false, run.Settings.HorizontalPlacement);
        await backend.Prepare(request);
        using var spool = new RunSpool(runsRoot, request, new { description = (backendDescription ?? Naps2Backend.Describe)(), capabilities = caps });
        var saved = new NativeBinding(1, run, Guid.NewGuid());
        RunSpool.WriteNew(Path.Combine(directory, "binding.json"), saved);
        // Existing run.lock/binding before network or motor: restart cannot feed.
        JsonElement claim;
        while (true)
        {
            if (stop.IsCancellationRequested) return;
            try {
                claim = await Post(client, "api/scanner-agent/runs", token, new { action = "claim", version = 1,
                    runId = run.RunId, epoch = run.Epoch, executionId = saved.ExecutionId });
                Identity(claim, run.RunId);
                if (claim.GetProperty("executionId").GetGuid() != saved.ExecutionId || !claim.GetProperty("feedAuthorized").GetBoolean())
                    throw new InvalidDataException("Start claim requires physical reconciliation; no feed started");
                break;
            }
            catch (Exception error) when (error is HttpRequestException or TaskCanceledException or InvalidOperationException) {
                Console.WriteLine("Start acknowledgement unavailable. Same journal/claim retained; waiting before feed.");
                await Task.Delay(1000);
            }
        }
        // Do not rerun this call after a crash, even if it is unclear whether the
        // native call started. Recover() only delivers retained artifacts.
        var scan = Task.Run(async () => await backend.Start(spool));
        var delivered = new HashSet<Guid>();
        var nextPulse = DateTime.MinValue;
        while (true)
        {
            if (stop.IsCancellationRequested) backend.RequestStop("operator helper stop; graceful SDK stop unsupported, drain");
            try {
                if (DateTime.UtcNow >= nextPulse)
                {
                    await Post(client, "api/scanner-agent/pulse", token, new { version = 1, agentVersion = ScannerConnection.Version, devices });
                    var status = await Post(client, "api/scanner-agent/runs", token, new { action = "poll", version = 1 });
                    if (status.GetProperty("epoch").GetGuid() != run.Epoch) backend.RequestStop("site generation changed; retain/drain");
                    var current = status.GetProperty("run");
                    if (current.ValueKind != JsonValueKind.Null && current.GetProperty("runId").GetGuid() == run.RunId &&
                        current.GetProperty("stopRequested").GetBoolean()) backend.RequestStop("website stop; SDK graceful stop unsupported, drain");
                    nextPulse = DateTime.UtcNow.AddSeconds(5);
                }
                var artifacts = Artifacts(directory);
                var next = artifacts.FirstOrDefault(a=>!delivered.Contains(a.Id));
                if (next != null) { await Deliver(client, token, directory, saved, next); delivered.Add(next.Id); continue; }
                if (scan.IsCompleted) break;
            }
            catch (Exception error) when (error is HttpRequestException or TaskCanceledException or InvalidOperationException or IOException or JsonException) {
                Console.WriteLine("Upload unavailable. Complete originals stay in the private spool; current feeder run drains.");
                if (scan.IsCompleted && stop.IsCancellationRequested) break;
                await Task.Delay(1000);
            }
            await Task.Delay(100);
        }
        try { await scan; } catch { /* Safe ScannerError/AcquisitionCompleted evidence is already in spool. */ }
        if (!stop.IsCancellationRequested) await Finish(client, token, directory, saved);
    }
    internal static List<ScannerArtifact> Artifacts(string directory)
    {
        var values = new List<ScannerArtifact>();
        foreach (var file in Directory.EnumerateFiles(directory, "*.json"))
        {
            if (!Guid.TryParse(Path.GetFileNameWithoutExtension(file), out var id)) continue;
            var artifact = JsonSerializer.Deserialize<ScannerArtifact>(File.ReadAllText(file), RunSpool.Json)
                ?? throw new InvalidDataException("Scanner artifact manifest unavailable");
            if (artifact.Id != id || artifact.FileName != $"{id}.png" || artifact.Sequence < 1 ||
                artifact.Sequence > 5000 || artifact.Bytes <= 0 || artifact.Timestamp == null ||
                artifact.Side != "UNKNOWN" || artifact.PhysicalBoundary != "UNKNOWN")
                throw new InvalidDataException("Scanner manifest requires reconciliation");
            values.Add(artifact);
        }
        if (values.GroupBy(a=>a.Sequence).Any(g=>g.Count()!=1)) throw new InvalidDataException("Scanner sequence conflict");
        return values.OrderBy(a=>a.Sequence).ToList();
    }
    private static async Task Deliver(HttpClient client, string token, string directory, NativeBinding binding, ScannerArtifact artifact)
    {
        var timestamp = artifact.Timestamp ?? throw new InvalidDataException("Scanner timestamp unavailable");
        var file = Path.Combine(directory, artifact.FileName);
        var info = new FileInfo(file);
        if (info.LinkTarget != null || info.Length != artifact.Bytes || info.Length > 10L * 1024 * 1024)
            throw new InvalidDataException("Scanner original needs reconciliation; file retained");
        var bytes = await File.ReadAllBytesAsync(file);
        if (Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() != artifact.Sha256)
            throw new InvalidDataException("Scanner original integrity changed; file retained");
        var run = binding.Instruction;
        using var request = new HttpRequestMessage(HttpMethod.Post, "api/scanner-agent/images") { Content = new ByteArrayContent(bytes) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        request.Headers.Add("x-mtg-scanner", JsonSerializer.Serialize(new { version = 1, runId = run.RunId,
            epoch = run.Epoch, executionId = binding.ExecutionId, artifactId = artifact.Id,
            sequence = artifact.Sequence, timestamp = timestamp.ToString("O"),
            side = artifact.Side, physicalBoundary = artifact.PhysicalBoundary }, RunSpool.Json));
        using var response = await client.SendAsync(request);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Scanner upload rejected; original retained");
        var ack = await response.Content.ReadFromJsonAsync<JsonElement>();
        Identity(ack, run.RunId);
        if (ack.GetProperty("version").GetInt32() != 1 || ack.GetProperty("artifactId").GetGuid() != artifact.Id ||
            ack.GetProperty("sequence").GetInt32() != artifact.Sequence || ack.GetProperty("digest").GetString() != artifact.Sha256 ||
            !ack.GetProperty("ready").GetBoolean() || ack.GetProperty("photoId").GetGuid() == Guid.Empty)
            throw new InvalidDataException("Scanner upload acknowledgement changed; original retained");
        var receipt = Path.Combine(directory, $"{artifact.Id}.receipt.json");
        if (!File.Exists(receipt)) RunSpool.WriteNew(receipt, ack);
        else {
            var prior = JsonSerializer.Deserialize<JsonElement>(await File.ReadAllTextAsync(receipt));
            if (prior.GetProperty("photoId").GetGuid() != ack.GetProperty("photoId").GetGuid() ||
                prior.GetProperty("digest").GetString() != artifact.Sha256)
                throw new InvalidDataException("Scanner receipt changed; reconcile instead of discarding original");
        }
    }
    private static async Task Recover(HttpClient client, string token, string directory, NativeBinding binding)
    {
        // Revalidate receipts with server rather than assume a previous ACK means
        // bytes survived a server restore. No native backend is created here.
        foreach (var artifact in Artifacts(directory)) await Deliver(client, token, directory, binding, artifact);
        await Finish(client, token, directory, binding);
    }
    private static async Task Finish(HttpClient client, string token, string directory, NativeBinding binding)
    {
        var artifacts = Artifacts(directory);
        if (artifacts.Where((a,i)=>a.Sequence != i+1).Any() ||
            Directory.EnumerateFiles(directory, "*.png").Any(file=>!artifacts.Any(a=>a.FileName==Path.GetFileName(file))))
            throw new InvalidDataException("Unjournaled/missing scanner image requires reconciliation");
        using var stream = new FileStream(Path.Combine(directory, "events.jsonl"), FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        using var reader = new StreamReader(stream);
        var text = await reader.ReadToEndAsync();
        if (text.Length > 8 * 1024 * 1024) throw new InvalidDataException("Scanner journal requires reconciliation");
        var events = text.Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(s=>JsonSerializer.Deserialize<JsonElement>(s)).ToList();
        if (events.Where((e,i)=>e.GetProperty("sequence").GetInt32()!=i+1).Any()) throw new InvalidDataException("Scanner event order requires reconciliation");
        var ended = events.LastOrDefault();
        var complete = ended.ValueKind != JsonValueKind.Undefined && ended.GetProperty("kind").GetString() == "AcquisitionCompleted";
        var evidence = complete ? ended.GetProperty("evidence") : default;
        var outcome = complete ? evidence.GetProperty("outcome").GetString() : "INTERRUPTED";
        if (outcome is not ("COMPLETED" or "SOURCE_EXHAUSTED" or "DRAINED_AFTER_UNSUPPORTED_STOP" or "ERROR")) outcome = "INTERRUPTED";
        if (complete && evidence.GetProperty("imageCount").GetInt32() != artifacts.Count)
            throw new InvalidDataException("Scanner completion count differs from retained originals");
        var error = events.LastOrDefault(e=>e.GetProperty("kind").GetString()=="ScannerError");
        object? nativeError = error.ValueKind == JsonValueKind.Undefined ? null : new {
            type = error.GetProperty("evidence").GetProperty("type").GetString(), nativeStatus = error.GetProperty("evidence").GetProperty("nativeStatus").GetInt32() };
        var run = binding.Instruction;
        var ack = await Post(client, "api/scanner-agent/runs", token, new { action = "finish", version = 1,
            runId = run.RunId, epoch = run.Epoch, executionId = binding.ExecutionId,
            outcome = new { outcome, imageCount = artifacts.Count, elapsedMs = complete ? evidence.GetProperty("elapsedMs").GetInt64() : 0,
                knownPhysicalItems = (int?)null, sourceExhausted = complete ? evidence.GetProperty("sourceExhausted").GetString() : "UNKNOWN", nativeError } });
        Identity(ack, run.RunId);
        Console.WriteLine($"Scanner run settled: {artifacts.Count} image(s) retained/delivered; physical count awaits operator confirmation.");
    }
}
