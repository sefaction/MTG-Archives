using NAPS2.Scan;
using System.Text.Json;

namespace Mtg.Scanner;

// Real adapter, fake enumeration delegates. No worker, driver or motor is used.
internal static class ScannerDiscoverySelfTest
{
    private static void Check(bool value, string message) { if (!value) throw new InvalidDataException(message); }
    private static readonly ScanDevice Wia = new(Driver.Wia, "fixture-wia", "Fixture WIA");
    private static readonly ScanDevice Twain = new(Driver.Twain, "fixture-twain", "Fixture TWAIN");
    private sealed class FailingBackend : IScannerBackend {
        public bool Fail = true;
        public int Calls;
        public Task<IReadOnlyList<Device>> ListDevices() {
            Calls++;
            return Fail ? throw new IOException("PRIVATE driver path") : Task.FromResult<IReadOnlyList<Device>>([new("fixture", "Fixture", "fixture", "fixture")]);
        }
        public Task<Capabilities> GetCapabilities(string id) => throw new NotImplementedException();
        public Task Prepare(ScanRequest request) => throw new NotImplementedException();
        public Task Start(RunSpool spool) => throw new InvalidDataException("Discovery must not start acquisition");
        public void RequestStop(string reason) => throw new NotImplementedException();
        public void Cancel(string reason) => throw new NotImplementedException();
        public void Close() { }
        public void Dispose() { }
    }
    public static async Task Run()
    {
        var now = DateTimeOffset.Parse("2026-09-30T00:00:00Z");
        var origin = now; var starts = 0; var wiaCalls = 0; var twainCalls = 0; var failing = true; var connected = true;
        using (var backend = new Naps2Backend(null, driver => {
            if (driver == Driver.Wia) { wiaCalls++; return Task.FromResult(connected ? new List<ScanDevice> { Wia } : []); }
            twainCalls++; return failing ? throw new IOException("PRIVATE driver path") : Task.FromResult(new List<ScanDevice> { Twain });
        }, () => starts++, () => now)) {
            var devices = await backend.ListDevices();
            Check(devices.Count == 1 && devices[0].Id == "Wia:fixture-wia", "Failing TWAIN hid usable WIA source");
            Check(backend.DiscoveryIssues.Single().Code == "DISCOVERY_FAILED", "Partial failure missing");
            for (var seconds = 5; seconds < 30; seconds += 5) { now = origin.AddSeconds(seconds); await backend.ListDevices(); }
            Check(starts == 1 && wiaCalls == 1 && twainCalls == 1, "Failed discovery spun or started extra worker");
            now = origin.AddSeconds(30); await backend.ListDevices();
            Check(starts == 1 && twainCalls == 2 && backend.DiscoveryIssues.Single().RetryAfterSeconds == 60, "Backoff or worker reuse failed");
            now = origin.AddSeconds(60); await backend.ListDevices(); Check(twainCalls == 2, "Failed source retried too early");
            now = origin.AddSeconds(90); failing = false; Check((await backend.ListDevices()).Count == 2, "Failed source did not recover");
            Check(backend.DiscoveryIssues.Count == 0, "Recovered source retained warning");
            now = origin.AddSeconds(120); connected = false;
            Check((await backend.ListDevices()).Single().Id == "Twain:fixture-twain", "Removed WIA remained available");
            now = origin.AddSeconds(150); connected = true;
            Check((await backend.ListDevices()).Count == 2 && starts == 1 && twainCalls == 3, "Reconnect or successful TWAIN cache failed");
        }
        Console.WriteLine("PASS partial failure/backoff/recovery/WIA reconnect/one worker initialization");

        using (var backend = new Naps2Backend(null, driver => driver == Driver.Wia
            ? throw new IOException("PRIVATE WIA failure") : Task.FromResult(new List<ScanDevice> { Twain }), () => { })) {
            Check((await backend.ListDevices()).Single().Id == "Twain:fixture-twain", "Failing WIA hid usable TWAIN source");
            Check(backend.DiscoveryIssues.Single().Source == "Wia", "Wrong failed source reported");
        }
        using (var backend = new Naps2Backend(null, _ => throw new IOException("PRIVATE both failed"), () => { })) {
            Check((await backend.ListDevices()).Count == 0 && backend.DiscoveryIssues.Count == 2, "Both failures must be explicit without fabricating sources");
        }
        Console.WriteLine("PASS inverse and all-source failures remain explicit");

        var setupCalls = 0;
        using (var backend = new Naps2Backend(null, driver => driver == Driver.Wia
            ? Task.FromResult(new List<ScanDevice> { Wia }) : throw new InvalidDataException("Query followed failed setup"),
            () => { setupCalls++; throw new IOException("PRIVATE setup failure"); }, () => now)) {
            for (var count = 0; count < 10; count++) { now = now.AddMinutes(10); Check((await backend.ListDevices()).Count == 1, "Setup failure hid working source"); }
            Check(setupCalls == 1 && backend.DiscoveryIssues.Single().Code == "DISCOVERY_RESTART_REQUIRED" &&
                backend.DiscoveryIssues.Single().RetryAfterSeconds is null, "Failed setup repeated or recovery guidance wrong");
        }
        Console.WriteLine("PASS failed worker setup is attempted once per context");

        var workerCalls = 0; var otherCalls = 0;
        using (var backend = new Naps2Backend("Wia:", driver => {
            if (driver != Driver.Wia) otherCalls++;
            return Task.FromResult(new List<ScanDevice> { Wia });
        }, () => workerCalls++)) Check((await backend.ListDevices()).Count == 1 && workerCalls == 0 && otherCalls == 0, "WIA-only discovery initialized TWAIN");
        using (var backend = new Naps2Backend("Wia:", _ => throw new IOException("PRIVATE selected source"), () => workerCalls++)) {
            try { await backend.ListDevices(); throw new InvalidDataException("Selected source failure was hidden"); }
            catch (InvalidOperationException) { Check(backend.DiscoveryIssues.Single().Code == "DISCOVERY_FAILED", "Selected discovery evidence missing"); }
        }
        Console.WriteLine("PASS selected source failure and WIA-only no-worker path");

        using var fake = new FailingBackend(); var refresh = new ScannerDiscoveryRefresh(fake, () => now);
        await refresh.RefreshIfDue();
        Check(refresh.Devices.Count == 0 && refresh.Issues.Single().Code == "DISCOVERY_FAILED", "Generic failure skipped truthful heartbeat snapshot");
        now = now.AddSeconds(5); await refresh.RefreshIfDue(); Check(fake.Calls == 1, "Generic driver discovery spun every five seconds");
        now = now.AddSeconds(30); fake.Fail = false; await refresh.RefreshIfDue();
        Check(refresh.Devices.Count == 1 && refresh.Issues.Count == 0, "Generic backend did not recover");
        var issue = new ScannerDiscoveryIssue("Windows", "DISCOVERY_FAILED", 30);
        var legacy = ScannerConnection.DiscoveryPulse(refresh.Devices, [issue], false);
        var negotiated = ScannerConnection.DiscoveryPulse(refresh.Devices, [issue], true);
        Check(legacy.Count == 3 && !legacy.ContainsKey("discoveryIssues") && negotiated.ContainsKey("discoveryIssues"), "Old website negotiation failed");
        Check(!JsonSerializer.Serialize(negotiated, RunSpool.Json).Contains("PRIVATE"), "Discovery diagnostics leaked native details");
        Console.WriteLine("PASS generic refresh cadence, heartbeat snapshots, legacy negotiation and redaction");

        var gate = new TaskCompletionSource<List<ScanDevice>>(TaskCreationOptions.RunContinuationsAsynchronously);
        using (var backend = new Naps2Backend("Wia:", _ => gate.Task, () => throw new InvalidDataException("TWAIN worker started"))) {
            var pending = backend.ListDevices();
            try { backend.Close(); throw new InvalidDataException("In-flight driver was disposed"); } catch (InvalidOperationException) { }
            Check(!pending.IsCompleted, "Observation fabricated native completion"); gate.SetResult([Wia]);
            Check((await pending).Count == 1, "In-flight result lost"); backend.Close();
        }
        Console.WriteLine("PASS in-flight discovery is never timed out or prematurely disposed; no hardware/motor");
    }
}
