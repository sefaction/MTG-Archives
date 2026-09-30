using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Mtg.Scanner;

// Generic fake backend only: never constructs NAPS2 or operates a device.
internal static class ScannerPreflightSelfTest
{
    private sealed class Backend(string fault) : IScannerBackend
    {
        public int Starts, Disposals;
        public Task<IReadOnlyList<Device>> ListDevices() => fault == "discovery"
            ? throw new IOException("PRIVATE driver path")
            : Task.FromResult<IReadOnlyList<Device>>(fault == "removed" ? [] : [Source]);
        public Task<Capabilities> GetCapabilities(string id) => fault == "capabilities"
            ? throw new InvalidOperationException("PRIVATE driver status")
            : Task.FromResult(new Capabilities(new() { ["feeder"] = new(
                fault == "flatbed" ? Support.ReportedUnsupported : Support.Unknown, "fixture") }, null, null, null, null));
        public Task Prepare(ScanRequest request) => fault == "prepare"
            ? throw new InvalidOperationException("PRIVATE driver message") : Task.CompletedTask;
        public Task Start(RunSpool spool) {
            Starts++;
            spool.Event("AcquisitionStarted", new { fixture = true });
            spool.Event("AcquisitionCompleted", new { outcome = "COMPLETED", imageCount = 0,
                elapsedMs = 0, knownPhysicalItems = (int?)null, sourceExhausted = "UNKNOWN" });
            return Task.CompletedTask;
        }
        public void RequestStop(string reason) { }
        public void Cancel(string reason) { }
        public void Close() { }
        public void Dispose() => Disposals++;
    }
    private static readonly Device Source = new("fixture-preflight", "Fixture", "fixture", "Fixture");
    private sealed class Handler(Guid agent, NativeInstruction instruction) : HttpMessageHandler
    {
        public readonly List<string> Problems = [];
        public int Claims, Finishes;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
            var body = JsonSerializer.Deserialize<JsonElement>(await request.Content!.ReadAsStringAsync(cancellationToken));
            object result;
            if (request.RequestUri!.AbsolutePath.EndsWith("/pulse")) result = new { version = 1 };
            else switch (body.GetProperty("action").GetString()) {
                case "poll": result = new { version = 1, agentId = agent, epoch = instruction.Epoch, run = instruction }; break;
                case "preflight":
                    if (body.GetProperty("runId").GetGuid() != instruction.RunId || body.GetProperty("epoch").GetGuid() != instruction.Epoch ||
                        body.EnumerateObject().Count() != 5 || body.ToString().Contains("PRIVATE"))
                        throw new InvalidDataException("Preflight report leaked or changed identity");
                    Problems.Add(body.GetProperty("code").GetString()!);
                    result = new { version = 1, runId = instruction.RunId, retryable = true }; break;
                case "claim":
                    Claims++; result = new { version = 1, runId = instruction.RunId,
                        executionId = body.GetProperty("executionId").GetGuid(), feedAuthorized = true }; break;
                case "finish":
                    Finishes++; result = new { version = 1, runId = instruction.RunId, status = "DRAINED" }; break;
                default: throw new InvalidDataException("Unexpected preflight transport");
            }
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(result, RunSpool.Json)) };
        }
    }
    public static async Task Run(string fixtureRoot) {
        var parent = Path.GetFullPath(fixtureRoot);
        var root = Path.Combine(parent, Guid.NewGuid().ToString());
        Directory.CreateDirectory(root);
        try {
            foreach (var fault in new[] { "cached-missing", "removed", "busy", "discovery", "capabilities", "prepare", "flatbed", "storage" }) {
                var own = Path.Combine(root, fault); Directory.CreateDirectory(own);
                var agent = Guid.NewGuid();
                var instruction = new NativeInstruction(1, Guid.NewGuid(), Guid.NewGuid(), "fixture-session", Source.Id,
                    1, new(600, 2.6m, 3.6m, "Start", false, "RGB", false, false, false), null, false, "QUEUED", null);
                using var handler = new Handler(agent, instruction);
                using var client = new HttpClient(handler) { BaseAddress = new Uri("https://fixture.invalid/") };
                var calls = 0;
                var backend = new Backend(fault);
                Func<IScannerBackend> factory = () => { calls++; return backend; };
                FileStream? held = null;
                if (fault == "busy") {
                    Directory.CreateDirectory(Path.Combine(own, "devices"));
                    var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Source.Id)));
                    held = new FileStream(Path.Combine(own, "devices", key + ".lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
                }
                if (fault == "storage") File.WriteAllText(Path.Combine(own, "devices"), "not a directory");
                try { await ScannerNativeRunner.PollAndRun(client, agent, "fixture", own,
                    fault == "cached-missing" ? [] : [Source], CancellationToken.None, factory, () => new { fixture = true }); }
                finally { held?.Dispose(); }
                var code = fault switch { "cached-missing" or "removed" => "SCANNER_UNAVAILABLE", "busy" => "SCANNER_BUSY",
                    "flatbed" => "FEEDER_UNAVAILABLE", "storage" => "STORAGE_UNAVAILABLE", _ => "DRIVER_ERROR" };
                if (!handler.Problems.SequenceEqual([code]) || handler.Claims != 0 || backend.Starts != 0 ||
                    Directory.Exists(Path.Combine(own, agent.ToString(), "runs")) ||
                    backend.Disposals != calls) throw new InvalidDataException("Failed preflight authorized a feed, leaked state or retained a lock");
                // A transient preparation error creates no run journal and can
                // recover using the same run identity, without a replacement batch.
                if (fault == "storage") File.Delete(Path.Combine(own, "devices"));
                var recovered = new Backend("ready");
                await ScannerNativeRunner.PollAndRun(client, agent, "fixture", own, [Source], CancellationToken.None,
                    () => recovered, () => new { fixture = true });
                if (handler.Claims != 1 || handler.Finishes != 1 || recovered.Starts != 1 || recovered.Disposals != 1)
                    throw new InvalidDataException("Preflight recovery failed");
            }
            Console.WriteLine("PASS eight preflight failures: bounded reports, no START/artifacts, disposed backend/locks, same-run recovery; no hardware");
        } finally {
            if (Path.GetDirectoryName(root) != parent || !Guid.TryParse(Path.GetFileName(root), out _)) throw new InvalidOperationException("Fixture path escaped");
            Directory.Delete(root, true);
        }
    }
}
