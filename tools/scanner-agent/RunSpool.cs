using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Mtg.Scanner;

// A transport spool, not another acquisition database. Never deletes an original
// on stop, cancel, upload failure, or a capacity rejection. Files stay private.
public sealed class RunSpool : IDisposable
{
    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() }
    };
    private readonly FileStream lease;
    private readonly FileStream journal;
    private readonly object gate = new();
    private int sequence;
    public string DirectoryPath { get; }
    public RunSpool(string root, ScanRequest request, object backend)
    {
        Directory.CreateDirectory(root);
        DirectoryPath = Path.Combine(Path.GetFullPath(root), request.RunId.ToString());
        // CreateNew lease/run document prevents accidentally rescanning a replayed run.
        Directory.CreateDirectory(DirectoryPath);
        lease = new FileStream(Path.Combine(DirectoryPath, "run.lock"), FileMode.CreateNew,
            FileAccess.Write, FileShare.None);
        WriteNew(Path.Combine(DirectoryPath, "run.json"), new { version = 1, request, backend,
            createdAt = DateTimeOffset.UtcNow, physicalCount = (int?)null });
        journal = new FileStream(Path.Combine(DirectoryPath, "events.jsonl"), FileMode.CreateNew,
            FileAccess.Write, FileShare.Read);
    }
    public void Event(string kind, object evidence)
    {
        lock (gate)
        {
            var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
            {
                version = 1, sequence = ++sequence, timestamp = DateTimeOffset.UtcNow,
                kind, evidence
            }, Json) + "\n");
            journal.Write(bytes);
            journal.Flush(true);
            Console.WriteLine(Encoding.UTF8.GetString(bytes).TrimEnd());
        }
    }
    public ScannerArtifact PublishImage(string temporaryFile, Guid id, int imageSequence,
        int width, int height)
    {
        // Image is published before the manifest. A crash can leave an orphan; audit
        // reports it rather than silently discarding it or fabricating a transfer.
        var fileName = $"{id}.png";
        var target = Path.Combine(DirectoryPath, fileName);
        using (var file = new FileStream(temporaryFile, FileMode.Open, FileAccess.ReadWrite))
            file.Flush(true);
        File.Move(temporaryFile, target);
        using var input = File.OpenRead(target);
        var artifact = new ScannerArtifact(id, imageSequence, fileName,
            Convert.ToHexString(SHA256.HashData(input)).ToLowerInvariant(),
            input.Length, width, height, Timestamp: DateTimeOffset.UtcNow);
        WriteNew(Path.Combine(DirectoryPath, $"{id}.json"), artifact);
        Event("ImageReceived", artifact);
        return artifact;
    }
    public static void WriteNew(string file, object value)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, Json);
        using var output = new FileStream(file, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
        output.Write(bytes);
        output.Flush(true);
    }
    public void Dispose() { journal.Dispose(); lease.Dispose(); }
}
