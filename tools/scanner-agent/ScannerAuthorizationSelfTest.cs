using System.Net;
using System.Security.Cryptography;
using System.Text.Json;

namespace Mtg.Scanner;

// Real transport/journal lifecycle through a generic fake, never NAPS2/hardware.
internal static class ScannerAuthorizationSelfTest
{
    private static readonly Device Source = new("fixture-auth", "Fixture", "fixture", "Fixture");
    private sealed class Backend(bool waitForStop) : IScannerBackend
    {
        private readonly TaskCompletionSource<bool> drained = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int Starts, Stops, Cancels, Disposals;
        public bool Ended;
        public Task<IReadOnlyList<Device>> ListDevices() => Task.FromResult<IReadOnlyList<Device>>([Source]);
        public Task<Capabilities> GetCapabilities(string id) => Task.FromResult(new Capabilities(new() {
            ["feeder"] = new(Support.Unknown, "fixture; no physical source") }, null, null, null, null));
        public Task Prepare(ScanRequest request) => Task.CompletedTask;
        public async Task Start(RunSpool spool) {
            Starts++; spool.Event("AcquisitionStarted", new { fixture = true });
            Publish(spool, 1);
            if (waitForStop) { await drained.Task; Publish(spool, 2); }
            spool.Event("AcquisitionCompleted", new { outcome = "COMPLETED", imageCount = waitForStop ? 2 : 1,
                elapsedMs = 0, knownPhysicalItems = (int?)null, sourceExhausted = "UNKNOWN", fixture = true });
            Ended = true;
        }
        private static void Publish(RunSpool spool, int sequence) {
            var temporary = Path.Combine(spool.DirectoryPath, $"fixture-{sequence}.pending.png");
            using (var bitmap = new System.Drawing.Bitmap(10, 14)) bitmap.Save(temporary, System.Drawing.Imaging.ImageFormat.Png);
            spool.PublishImage(temporary, Guid.NewGuid(), sequence, 10, 14);
        }
        public void RequestStop(string reason) { Stops++; drained.TrySetResult(true); }
        public void Cancel(string reason) { Cancels++; drained.TrySetResult(true); }
        public void Close() { }
        public void Dispose() {
            Disposals++;
            if (Starts > 0 && !Ended) { drained.TrySetResult(true); throw new InvalidDataException("Backend disposed before native drain"); }
        }
    }
    private sealed class Handler(Guid agent, NativeInstruction run, string failure) : HttpMessageHandler
    {
        public NativeInstruction Run = run;
        public string Failure = failure;
        public int Requests, Claims, Uploads, Finishes, Denials;
        private Guid? artifact;
        private string? digest;
        private readonly Guid photo = Guid.NewGuid();
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
            Requests++;
            if (Denials > 0) throw new InvalidDataException("Permanent denial was retried");
            object response;
            var route = request.RequestUri!.AbsolutePath;
            if (route.EndsWith("/images")) {
                Uploads++;
                var meta = JsonSerializer.Deserialize<JsonElement>(request.Headers.GetValues("x-mtg-scanner").Single());
                var bytes = await request.Content!.ReadAsByteArrayAsync(cancellationToken);
                var nextDigest = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
                if (artifact != null && (artifact != meta.GetProperty("artifactId").GetGuid() || digest != nextDigest))
                    throw new InvalidDataException("Retry changed original identity");
                artifact = meta.GetProperty("artifactId").GetGuid(); digest = nextDigest;
                if (Failure == "upload") return Denied(HttpStatusCode.Forbidden);
                if (Failure == "temporary" && Uploads == 1) return Reply(HttpStatusCode.ServiceUnavailable, new { error = "fixture outage" });
                if (Failure == "temporary" && Uploads == 2) throw new HttpRequestException("fixture lost ACK after acceptance");
                response = new { version = 1, runId = Run.RunId, artifactId = artifact.Value, sequence = 1,
                    digest, photoId = photo, ready = true };
            } else if (route.EndsWith("/pulse")) {
                if (Failure == "pulse") return Denied(HttpStatusCode.Forbidden);
                response = new { version = 1 };
            } else {
                var body = JsonSerializer.Deserialize<JsonElement>(await request.Content!.ReadAsStringAsync(cancellationToken));
                switch (body.GetProperty("action").GetString()) {
                    case "poll":
                        if (Failure == "poll") return Denied(HttpStatusCode.Unauthorized);
                        response = new { version = 1, agentId = agent, epoch = Run.Epoch, run = Run }; break;
                    case "preflight":
                        if (Failure == "preflight") return Denied(HttpStatusCode.Forbidden);
                        throw new InvalidDataException("Unexpected preflight");
                    case "claim":
                        Claims++;
                        if (Failure == "claim") return Denied(HttpStatusCode.Forbidden);
                        Run = Run with { Status = "STARTED", ExecutionId = body.GetProperty("executionId").GetGuid() };
                        response = new { version = 1, runId = Run.RunId, executionId = Run.ExecutionId, feedAuthorized = true }; break;
                    case "finish":
                        Finishes++;
                        if (Failure == "finish") return Denied(HttpStatusCode.Forbidden);
                        response = new { version = 1, runId = Run.RunId, status = "DRAINED" }; break;
                    default: throw new InvalidDataException("Unexpected transport");
                }
            }
            return Reply(HttpStatusCode.OK, response);
        }
        private HttpResponseMessage Denied(HttpStatusCode status) { Denials++; return Reply(status, new { error = "fixture denied" }); }
        private static HttpResponseMessage Reply(HttpStatusCode status, object body) => new(status) {
            Content = new StringContent(JsonSerializer.Serialize(body, RunSpool.Json)) };
    }
    public static async Task Run(string fixtureRoot) {
        var parent = Path.GetFullPath(fixtureRoot);
        var root = Path.Combine(parent, Guid.NewGuid().ToString());
        Directory.CreateDirectory(root);
        try {
            foreach (var failure in new[] { "poll", "preflight", "claim", "pulse", "upload", "finish", "temporary" }) {
                var own = Path.Combine(root, failure); Directory.CreateDirectory(own);
                var agent = Guid.NewGuid();
                var run = new NativeInstruction(1, Guid.NewGuid(), Guid.NewGuid(), "fixture-session", Source.Id, 1,
                    new(600, 2.6m, 3.6m, "Start", false, "RGB", false, false, false), null, false, "QUEUED", null);
                using var handler = new Handler(agent, run, failure);
                using var client = new HttpClient(handler) { BaseAddress = new Uri("https://fixture.invalid/") };
                var backend = new Backend(failure is "pulse" or "upload"); var constructions = 0;
                Func<IScannerBackend> factory = () => { constructions++; return backend; };
                var denied = false;
                try { await ScannerNativeRunner.PollAndRun(client, agent, "fixture", own,
                    failure == "preflight" ? [] : [Source], CancellationToken.None, factory,
                    () => new { fixture = true }).WaitAsync(TimeSpan.FromSeconds(15)); }
                catch (ScannerConnectionRejected) { denied = true; }
                if (denied != (failure != "temporary") || handler.Denials != (denied ? 1 : 0) ||
                    backend.Cancels != 0 || backend.Disposals != constructions)
                    throw new InvalidDataException("Authorization classification or disposal failed");
                if (failure is "poll" or "preflight" or "claim") {
                    if (backend.Starts != 0 || handler.Uploads != 0 || handler.Finishes != 0)
                        throw new InvalidDataException("Permanent denial started a feed");
                } else {
                    var directory = Path.Combine(own, agent.ToString(), "runs", run.RunId.ToString());
                    var artifacts = ScannerNativeRunner.Artifacts(directory);
                    var count = failure is "pulse" or "upload" ? 2 : 1;
                    if (backend.Starts != 1 || !backend.Ended || artifacts.Count != count ||
                        backend.Stops != (count == 2 ? 1 : 0) || artifacts.Any(a => !File.Exists(Path.Combine(directory, a.FileName))))
                        throw new InvalidDataException("Drain lost originals or restarted feed");
                    if (failure == "temporary" && (handler.Uploads != 3 || handler.Finishes != 1))
                        throw new InvalidDataException("Temporary outage/ACK-loss did not settle same original");
                    if (failure is "upload" or "pulse") {
                        if (handler.Finishes != 0 || handler.Uploads != (failure == "upload" ? 1 : 0))
                            throw new InvalidDataException("Revoked scan kept sending");
                        // Restart may deliver retained transfers, never feed again.
                        handler.Failure = "upload"; handler.Denials = 0;
                        try { await ScannerNativeRunner.PollAndRun(client, agent, "fixture", own, [Source], CancellationToken.None,
                            () => throw new InvalidDataException("Recovery constructed backend"));
                            throw new InvalidDataException("Revoked recovery was accepted"); }
                        catch (ScannerConnectionRejected) { }
                        if (backend.Starts != 1 || ScannerNativeRunner.Artifacts(directory).Count != count)
                            throw new InvalidDataException("Recovery changed retained acquisition");
                    }
                }
            }
            Console.WriteLine("PASS native denial before START, during pulse/upload/finish, drain before disposal, retained overflow, no refeed;503/lost-ACK recovers same original; no hardware");
        } finally {
            if (Path.GetDirectoryName(root) != parent || !Guid.TryParse(Path.GetFileName(root), out _)) throw new InvalidOperationException("Fixture path escaped");
            Directory.Delete(root, true);
        }
    }
}
