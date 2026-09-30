namespace Mtg.Scanner;

// The contract contains no scanner library types. Transfer count is NOT card count.
public enum Support { ReportedSupported, ReportedUnsupported, Unknown, NotExposed }
public enum Qualification { Qualified, KnownWorking, GenericUnqualified, Unsupported }
public record Device(string Id, string Name, string Backend, string Source,
    Qualification Qualification = Qualification.GenericUnqualified);
public record Capability(Support Support, string Evidence);
public record Capabilities(Dictionary<string, Capability> Features, int[]? Dpi,
    string? Manufacturer, string? Model, string? ProtocolVersion);
public record ScanRequest(Guid RunId, string DeviceId, int Dpi = 300,
    decimal WidthInches = 2.6m, decimal HeightInches = 3.6m, bool Duplex = false,
    int? ImageStopBudget = null, int? SessionPhysicalTarget = null,
    bool AllowInterruptingStop = false, string HorizontalPlacement = "Center");
public record ScannerEvent(string Kind, object Evidence);
public record ScannerDiscoveryIssue(string Source, string Code, int? RetryAfterSeconds);
public record ScannerArtifact(Guid Id, int Sequence, string FileName, string Sha256,
    long Bytes, int Width, int Height, string Side = "UNKNOWN",
    string PhysicalBoundary = "UNKNOWN", DateTimeOffset? Timestamp = null);

public interface IScannerBackend : IDisposable
{
    Task<IReadOnlyList<Device>> ListDevices();
    IReadOnlyList<ScannerDiscoveryIssue> DiscoveryIssues => [];
    Task<Capabilities> GetCapabilities(string deviceId);
    Task Prepare(ScanRequest request);
    Task Start(RunSpool spool);
    void RequestStop(string reason);
    void Cancel(string reason);
    void Close();
}
