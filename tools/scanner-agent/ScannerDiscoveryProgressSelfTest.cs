using NAPS2.Scan;
using System.Text.Json;

namespace Mtg.Scanner;

// No real driver or worker. Model returned pending Tasks and synchronous
// blocking before the driver supplies a Task; release every gate in finally.
internal static class ScannerDiscoveryProgressSelfTest
{
    private static void Check(bool value, string message) { if (!value) throw new InvalidDataException(message); }
    private static readonly Device Device = new("fixture", "Fixture", "fixture", "fixture");
    private sealed class Backend(Func<Task<IReadOnlyList<Device>>> enumerate) : IScannerBackend
    {
        public int Calls;
        public Task<IReadOnlyList<Device>> ListDevices() { Interlocked.Increment(ref Calls); return enumerate(); }
        public Task<Capabilities> GetCapabilities(string id) => throw new NotImplementedException();
        public Task Prepare(ScanRequest request) => throw new NotImplementedException();
        public Task Start(RunSpool spool) => throw new InvalidDataException("Must not feed");
        public void RequestStop(string reason) => throw new NotImplementedException();
        public void Cancel(string reason) => throw new NotImplementedException();
        public void Close() { }
        public void Dispose() { }
    }
    private static async Task Await(Func<bool> condition)
    {
        for (var count = 0; count < 200 && !condition(); count++) await Task.Delay(5);
        Check(condition(), "Controlled discovery task failed to settle");
    }
    public static async Task Run()
    {
        var now = DateTimeOffset.Parse("2026-09-30T00:00:00Z");
        var gate = new TaskCompletionSource<IReadOnlyList<Device>>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var backend = new Backend(() => gate.Task);
        var refresh = new ScannerDiscoveryRefresh(backend, () => now);
        refresh.PollRefreshIfDue(); await Await(() => backend.Calls == 1);
        for (var count = 0; count < 100; count++) { now = now.AddMinutes(1); refresh.PollRefreshIfDue(); }
        Check(backend.Calls == 1 && refresh.Pending && refresh.Devices.Count == 0 &&
            refresh.Issues.Single().Code == "DISCOVERY_IN_PROGRESS", "Pending observation started extra work or fabricated results");
        var drain = refresh.Drain(); Check(!drain.IsCompleted, "Shutdown did not retain native operation");
        gate.SetResult([Device]); await drain;
        Check(!refresh.Pending && refresh.Devices.Single() == Device && refresh.Issues.Count == 0, "Late completion lost during draining");
        try { refresh.PollRefreshIfDue(); throw new InvalidDataException("Draining restarted discovery"); } catch (InvalidOperationException) { }
        Console.WriteLine("PASS single pending operation/heartbeat snapshot/late completion/shutdown stops future work");

        using var release = new ManualResetEventSlim(); var began = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var blocking = new Backend(() => { began.SetResult(); release.Wait(); return Task.FromResult<IReadOnlyList<Device>>([Device]); });
        var blockingRefresh = new ScannerDiscoveryRefresh(blocking);
        try {
            blockingRefresh.PollRefreshIfDue(); await began.Task.WaitAsync(TimeSpan.FromSeconds(2));
            Check(blockingRefresh.Pending && blocking.Calls == 1, "Synchronous call was not tracked");
        } finally { release.Set(); await blockingRefresh.Drain(); }
        Console.WriteLine("PASS synchronous driver blocking leaves the service loop free");

        var pending = new TaskCompletionSource<IReadOnlyList<Device>>(TaskCreationOptions.RunContinuationsAsynchronously);
        var repeatCount = 0;
        using var repeating = new Backend(() => ++repeatCount == 1
            ? Task.FromResult<IReadOnlyList<Device>>([Device]) : pending.Task);
        var repeated = new ScannerDiscoveryRefresh(repeating, () => now);
        repeated.PollRefreshIfDue(); await Await(() => repeating.Calls == 1);
        await Await(() => { repeated.PollRefreshIfDue(); return !repeated.Pending; });
        now = now.AddSeconds(30); repeated.PollRefreshIfDue(); await Await(() => repeating.Calls == 2);
        Check(repeated.Pending && repeated.Devices.Single() == Device, "Previous completed choices disappeared during refresh");
        var old = ScannerConnection.DiscoveryPulse(repeated.Devices, repeated.Issues, false);
        var recoveryOnly = ScannerConnection.DiscoveryPulse(repeated.Devices, repeated.Issues, true);
        var current = ScannerConnection.DiscoveryPulse(repeated.Devices, repeated.Issues, true, true);
        Check(old.Count == 3 && ((IReadOnlyList<Device>)old["devices"]).Count == 0 &&
            ((IReadOnlyList<Device>)recoveryOnly["devices"]).Count == 0 &&
            !JsonSerializer.Serialize(recoveryOnly, RunSpool.Json).Contains("DISCOVERY_IN_PROGRESS") &&
            ((IReadOnlyList<Device>)current["devices"]).Count == 1, "Pending compatibility/choice snapshot wrong");
        pending.SetResult([]); await repeated.Drain();
        Check(repeated.Devices.Count == 0 && repeated.Issues.Count == 0, "Late removal was ignored");
        Console.WriteLine("PASS completed choices retained during refresh/new removal retained/old-site negotiation");

        using var failed = new Backend(() => throw new IOException("PRIVATE native path"));
        var failure = new ScannerDiscoveryRefresh(failed, () => now);
        failure.PollRefreshIfDue(); await Await(() => { failure.PollRefreshIfDue(); return !failure.Pending; });
        Check(failure.Issues.Single().Code == "DISCOVERY_FAILED", "Completed error not published");
        now = now.AddSeconds(5); failure.PollRefreshIfDue(); Check(failed.Calls == 1, "Completed error retried too soon");
        await failure.Drain();
        Console.WriteLine("PASS completed errors remain sanitized/bounded without discovery spin");

        using var fast = new Backend(() => Task.FromResult<IReadOnlyList<Device>>([Device]));
        var fastRefresh = new ScannerDiscoveryRefresh(fast);
        await fastRefresh.PulseTurn();
        Check(!fastRefresh.Pending && fastRefresh.Devices.Count == 1 && fast.Calls == 1, "Fast refresh fabricated a five-second busy period");
        await fastRefresh.Drain();
        Console.WriteLine("PASS fast discovery settles in the pulse without a routine busy flicker");

        var nativeGate = new TaskCompletionSource<List<ScanDevice>>(TaskCreationOptions.RunContinuationsAsynchronously);
        var calls = 0;
        using (var adapter = new Naps2Backend("Wia:", _ => { Interlocked.Increment(ref calls); return nativeGate.Task; },
            () => throw new InvalidDataException("TWAIN initialized"))) {
            var operation = new ScannerDiscoveryRefresh(adapter); operation.PollRefreshIfDue(); await Await(() => calls == 1);
            try { adapter.Close(); throw new InvalidDataException("In-flight adapter closed"); } catch (InvalidOperationException) { }
            var shutdown = operation.Drain(); Check(!shutdown.IsCompleted, "Adapter drain fabricated completion");
            nativeGate.SetResult([new(Driver.Wia, "fixture-native", "Fixture native")]); await shutdown;
            Check(operation.Devices.Single().Id == "Wia:fixture-native", "Real adapter late result lost"); adapter.Close();
        }
        Console.WriteLine("PASS real NAPS2 adapter drain/close fencing; no driver, worker or motor");
    }
}
