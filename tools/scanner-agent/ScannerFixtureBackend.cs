namespace Mtg.Scanner;

// Explicit local-only protocol fixture behind the SAME scanner boundary. It
// copies a preserved original without preprocessing and never creates NAPS2.
// Selecting this backend requires the guarded fixture-server command, not a
// remote website field. It cannot be used with a production connection.
public sealed class ScannerFixtureBackend(string original) : IScannerBackend
{
    private ScanRequest? request;
    public Task<IReadOnlyList<Device>> ListDevices() => Task.FromResult<IReadOnlyList<Device>>(
        new[] { new Device("fixture:single-card", "Local protocol fixture (no scanner)", "fixture", "Fixture") });
    public Task<Capabilities> GetCapabilities(string id) => id != "fixture:single-card"
        ? throw new ArgumentException("Fixture source unavailable")
        : Task.FromResult(new Capabilities(new() { ["feeder"] = new(Support.Unknown,"No physical source; local fixture") }, null, null, null, null));
    public Task Prepare(ScanRequest value) { request = value; return Task.CompletedTask; }
    public async Task Start(RunSpool spool)
    {
        if (request == null || request.DeviceId != "fixture:single-card") throw new InvalidOperationException("Prepare fixture first");
        spool.Event("AcquisitionStarted",new { fixture=true, physicalSource="NONE" });
        var temporary=Path.Combine(spool.DirectoryPath,"fixture.pending.png");
        // Preserve original format/bytes, so the existing intake validation can
        // detect unsupported input instead of this adapter silently rewriting it.
        await using(var input=File.OpenRead(original))
        await using(var output=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None)) {
            await input.CopyToAsync(output);output.Flush(true);
        }
        int width,height;
        using(var image=System.Drawing.Image.FromFile(temporary)) {width=image.Width;height=image.Height;}
        spool.PublishImage(temporary,Guid.NewGuid(),1,width,height);
        spool.Event("AcquisitionCompleted",new {outcome="COMPLETED",imageCount=1,elapsedMs=0,
            knownPhysicalItems=(int?)null,sourceExhausted="UNKNOWN",fixture=true});
    }
    public void RequestStop(string reason) { /* No physical source to stop. */ }
    public void Cancel(string reason) { /* No physical source to cancel. */ }
    public void Close() { }
    public void Dispose() => Close();
}
