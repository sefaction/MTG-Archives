using System.Net;
using System.Security.Cryptography;
using System.Text;

namespace Mtg.Scanner;

internal static class Fi7160SetupSelfTest
{
    internal static async Task Run()
    {
        var root = Path.Combine(Path.GetTempPath(), "mtg-fi7160-setup-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var bytes = Encoding.UTF8.GetBytes("Synthetic setup package; never executable.");
        var package = Fi7160SetupPackages.Driver with
        {
            Bytes = bytes.Length,
            Sha256 = Convert.ToHexString(SHA256.HashData(bytes))
        };
        try
        {
            var valid = new Handler(bytes);
            using var client = new HttpClient(valid);
            var file = await Fi7160SetupPackages.Download(client, package, Path.Combine(root, "valid"), null, default);
            if (!File.ReadAllBytes(file).SequenceEqual(bytes) || valid.Calls != 1)
                throw new InvalidDataException("Verified setup download was not published.");
            await Fi7160SetupPackages.Download(client, package, Path.Combine(root, "valid"), null, default);
            if (valid.Calls != 1) throw new InvalidDataException("Verified cache was downloaded again.");

            var changed = bytes.ToArray(); changed[0] ^= 1;
            await Refused(root, "tampered", package, new Handler(changed));
            await Refused(root, "truncated", package, new Handler(bytes[..^1], false));
            await Refused(root, "oversized", package, new Handler([.. bytes, 0], false));
            await Refused(root, "redirect", package, new Handler(bytes, true, HttpStatusCode.Redirect));

            File.WriteAllBytes(file, changed);
            var refusedCache = false;
            try { await Fi7160SetupPackages.Download(client, package, Path.Combine(root, "valid"), null, default); }
            catch (InvalidDataException) { refusedCache = true; }
            if (!refusedCache || !File.ReadAllBytes(file).SequenceEqual(changed) || valid.Calls != 1)
                throw new InvalidDataException("Unexpected existing setup file was replaced or trusted.");

            var outside = new Handler(bytes);
            await Refused(root, "wrong-origin", package with { Url = new Uri("https://example.invalid/driver.exe") }, outside);
            if (outside.Calls != 0) throw new InvalidDataException("Unapproved origin was contacted.");
            using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
            var cancelHandler = new Handler(bytes);
            using var cancelClient = new HttpClient(cancelHandler);
            var refusedCancellation = false;
            try { await Fi7160SetupPackages.Download(cancelClient, package, Path.Combine(root, "cancel"), null, cancelled.Token); }
            catch (OperationCanceledException) { refusedCancellation = true; }
            if (!refusedCancellation || File.Exists(Path.Combine(root, "cancel", package.FileName)))
                throw new InvalidDataException("Cancelled setup published a package.");
            Console.WriteLine("PASS pinned fi-7160 download/cache, tampered/truncated/oversized/redirect refusal, cancelled transfer and existing-file preservation; no network, install, driver or scanner");
        }
        finally
        {
            if (Path.GetDirectoryName(root) != Path.GetTempPath().TrimEnd(Path.DirectorySeparatorChar) ||
                !Path.GetFileName(root).StartsWith("mtg-fi7160-setup-", StringComparison.Ordinal))
                throw new InvalidOperationException("Unexpected owned setup fixture directory.");
            Directory.Delete(root, true);
        }
    }

    private static async Task Refused(string root, string name, Fi7160SetupPackages.Package package, Handler handler)
    {
        using var client = new HttpClient(handler);
        var folder = Path.Combine(root, name);
        var refused = false;
        try { await Fi7160SetupPackages.Download(client, package, folder, null, default); }
        catch (InvalidDataException) { refused = true; }
        if (!refused || File.Exists(Path.Combine(folder, package.FileName)) ||
            Directory.Exists(folder) && Directory.EnumerateFiles(folder).Any())
            throw new InvalidDataException("Rejected setup payload was published or retained as a package: " + name);
    }

    private sealed class Handler(byte[] bytes, bool includeLength = true, HttpStatusCode status = HttpStatusCode.OK)
        : HttpMessageHandler
    {
        internal int Calls;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Calls++;
            if (request.RequestUri != Fi7160SetupPackages.Driver.Url)
                throw new InvalidDataException("Unexpected setup URL.");
            HttpContent content = includeLength ? new ByteArrayContent(bytes) : new StreamContent(new NonSeekableInput(bytes));
            if (!includeLength) content.Headers.ContentLength = null;
            var result = new HttpResponseMessage(status) { RequestMessage = request, Content = content };
            if (status == HttpStatusCode.Redirect) result.Headers.Location = new Uri("https://example.invalid/driver.exe");
            return Task.FromResult(result);
        }
    }

    private sealed class NonSeekableInput(byte[] bytes) : Stream
    {
        private readonly MemoryStream input = new(bytes);
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override int Read(byte[] buffer, int offset, int count) => input.Read(buffer, offset, count);
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
            => input.ReadAsync(buffer, cancellationToken);
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        protected override void Dispose(bool disposing) { if (disposing) input.Dispose(); base.Dispose(disposing); }
    }
}
