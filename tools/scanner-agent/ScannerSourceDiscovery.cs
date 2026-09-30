namespace Mtg.Scanner;

// No library types, native error messages, paths or credentials are published.
// Calls finish naturally: a timeout is not proof that a native call has stopped.
internal sealed class ScannerSourceDiscovery<T>(string source, Func<Task<IReadOnlyList<T>>> enumerate,
    bool cacheSuccess, Action? initialize = null, Func<DateTimeOffset>? clock = null)
{
    private readonly Func<DateTimeOffset> now = clock ?? (() => DateTimeOffset.UtcNow);
    private IReadOnlyList<T> items = [];
    private bool initialized, successful, restartRequired;
    private int failures;
    private DateTimeOffset retryAt = DateTimeOffset.MinValue;
    public ScannerDiscoveryIssue? Issue => restartRequired
        ? new(source, "DISCOVERY_RESTART_REQUIRED", null)
        : failures == 0 ? null : new(source, "DISCOVERY_FAILED",
            Math.Clamp((int)Math.Ceiling((retryAt - now()).TotalSeconds), 0, 300));
    internal static bool Recoverable(Exception error) => error is not
        (OutOfMemoryException or AccessViolationException or StackOverflowException);
    public async Task<IReadOnlyList<T>> Refresh()
    {
        if (restartRequired || (successful && cacheSuccess) || now() < retryAt) return items;
        if (!initialized) {
            // A failed worker setup may have allocated native state. Never repeat
            // setup in this context or spawn another worker to hide the failure.
            try { initialize?.Invoke(); initialized = true; }
            catch (Exception error) when (Recoverable(error)) {
                restartRequired = true; items = []; return items;
            }
        }
        try {
            items = (await enumerate()).ToArray(); successful = true; failures = 0;
            retryAt = now().AddSeconds(30);
        } catch (Exception error) when (Recoverable(error)) {
            items = []; successful = false; failures = Math.Min(failures + 1, 5);
            retryAt = now().AddSeconds(Math.Min(30 * (1 << (failures - 1)), 300));
        }
        return items;
    }
}

// A failed generic backend must not skip the helper heartbeat or spin every5s.
internal sealed class ScannerDiscoveryRefresh(IScannerBackend backend, Func<DateTimeOffset>? clock = null)
{
    private sealed record Result(IReadOnlyList<Device> Devices, IReadOnlyList<ScannerDiscoveryIssue> Issues);
    private readonly Func<DateTimeOffset> now = clock ?? (() => DateTimeOffset.UtcNow);
    private DateTimeOffset next = DateTimeOffset.MinValue;
    private Task<Result>? inFlight;
    private bool stopping;
    private IReadOnlyList<ScannerDiscoveryIssue> settledIssues = [];
    public IReadOnlyList<Device> Devices { get; private set; } = [];
    public IReadOnlyList<ScannerDiscoveryIssue> Issues { get; private set; } = [];
    public bool Pending => inFlight is not null;
    private async Task<Result> Discover()
    {
        try { return new((await backend.ListDevices()).ToArray(), backend.DiscoveryIssues.ToArray()); }
        catch (Exception error) when (ScannerSourceDiscovery<Device>.Recoverable(error)) {
            return new([], [new("Windows", "DISCOVERY_FAILED", 30)]);
        }
    }
    private void Settle(Result result)
    {
        Devices = result.Devices; settledIssues = result.Issues; Issues = settledIssues;
        next = now().AddSeconds(30);
    }
    // Only the service loop owns this state. Native work never writes the pulse
    // snapshot; the loop harvests a completed task, with exactly one in flight.
    public void PollRefreshIfDue()
    {
        if (stopping) throw new InvalidOperationException("Discovery is draining");
        if (inFlight?.IsCompleted == true) {
            var completed = inFlight; inFlight = null;
            Settle(completed.GetAwaiter().GetResult());
        }
        if (inFlight is not null || now() < next) return;
        Issues = settledIssues.Where(issue => issue.Source != "Windows")
            .Append(new ScannerDiscoveryIssue("Windows", "DISCOVERY_IN_PROGRESS", null)).ToArray();
        // A driver may block synchronously before returning its Task. Move the
        // single invocation off the heartbeat loop, without an observation timeout.
        inFlight = Task.Run(Discover);
    }
    public async Task Drain()
    {
        stopping = true;
        if (inFlight is null) return;
        var pending = inFlight;
        try { Settle(await pending); }
        finally { inFlight = null; }
    }
    public async Task RefreshIfDue()
    {
        if (stopping || inFlight is not null) throw new InvalidOperationException("Discovery is active or draining");
        if (now() < next) return;
        next = now().AddSeconds(30);
        Settle(await Discover());
    }
}
