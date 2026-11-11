using System.Net;
using System.Security.Cryptography;

namespace Mtg.Scanner;

// Setup downloads the manufacturer's unchanged installer directly. It never
// substitutes a mirror, accepts a caller-supplied URL, or executes a download
// before its complete, version-pinned bytes have been verified.
internal static class Fi7160SetupPackages
{
    internal sealed record Package(string FileName, Uri Url, long Bytes, string Sha256);

    internal static readonly Package Driver = new(
        "PSIPTWAIN-3_40_2.exe",
        new Uri("https://origin.pfultd.com/downloads/IMAGE/fi/psip-twain32/3402/PSIPTWAIN-3_40_2.exe"),
        257447688,
        "90fd4101dce351e5f5fccdd4409c385817adf9c995be39126a8f8066f05ae833");

    internal const string DriverVersion = "3.40.2.1815";

    internal static async Task<string> DownloadDriver(string cacheDirectory,
        IProgress<long>? progress, CancellationToken cancellationToken)
    {
        using var handler = new HttpClientHandler { AllowAutoRedirect = false };
        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(20) };
        return await Download(client, Driver, cacheDirectory, progress, cancellationToken);
    }

    // Internal injection is for hardware-free tests, not a setup command-line
    // override. The production entry point above always uses Driver.
    internal static async Task<string> Download(HttpClient client, Package package,
        string cacheDirectory, IProgress<long>? progress, CancellationToken cancellationToken)
    {
        ValidateDescriptor(package);
        if (!Path.IsPathFullyQualified(cacheDirectory))
            throw new InvalidDataException("An absolute setup cache directory is required.");
        var root = Path.GetFullPath(cacheDirectory);
        RejectReparseDirectories(root);
        Directory.CreateDirectory(root);
        RejectReparseDirectories(root);
        var destination = Path.Combine(root, package.FileName);
        if (File.Exists(destination))
        {
            // Retain an unexpected existing file for diagnosis. Never replace it
            // silently, and never return an unchecked cache hit to the launcher.
            await Verify(destination, package, cancellationToken);
            return destination;
        }

        using var response = await client.GetAsync(package.Url,
            HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (response.StatusCode != HttpStatusCode.OK ||
            response.RequestMessage?.RequestUri != package.Url)
            throw new InvalidDataException("The manufacturer's pinned download was not returned directly.");
        if (response.Content.Headers.ContentLength is long declared && declared != package.Bytes)
            throw new InvalidDataException("The scanner driver download has an unexpected size.");

        var temporary = Path.Combine(root, ".driver-download-" + Guid.NewGuid().ToString("N"));
        try
        {
            await using (var target = new FileStream(temporary, FileMode.CreateNew,
                FileAccess.Write, FileShare.None, 65536, FileOptions.Asynchronous))
            await using (var input = await response.Content.ReadAsStreamAsync(cancellationToken))
            {
                var buffer = new byte[65536];
                long received = 0;
                while (true)
                {
                    var count = await input.ReadAsync(buffer, cancellationToken);
                    if (count == 0) break;
                    received = checked(received + count);
                    if (received > package.Bytes)
                        throw new InvalidDataException("The scanner driver download exceeded its declared size.");
                    await target.WriteAsync(buffer.AsMemory(0, count), cancellationToken);
                    progress?.Report(received);
                }
                if (received != package.Bytes)
                    throw new InvalidDataException("The scanner driver download was interrupted.");
                await target.FlushAsync(cancellationToken);
                target.Flush(true);
            }
            await Verify(temporary, package, cancellationToken);
            RejectReparseDirectories(root);
            // Do not overwrite a file published by a concurrent setup instance.
            File.Move(temporary, destination);
            return destination;
        }
        finally
        {
            // Only the unique incomplete download created by this call is owned.
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    internal static async Task Verify(string file, Package package, CancellationToken cancellationToken)
    {
        if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("The setup package must be a regular file.");
        await using var input = new FileStream(file, FileMode.Open, FileAccess.Read,
            FileShare.Read, 65536, FileOptions.Asynchronous);
        if (input.Length != package.Bytes)
            throw new InvalidDataException("The scanner driver package has an unexpected size.");
        var actual = Convert.ToHexString(await SHA256.HashDataAsync(input, cancellationToken));
        if (!actual.Equals(package.Sha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The scanner driver package failed its integrity check.");
    }

    private static void ValidateDescriptor(Package package)
    {
        if (package.Url.Scheme != "https" || package.Url.Host != "origin.pfultd.com" ||
            !package.Url.IsDefaultPort || package.Url.UserInfo.Length != 0 ||
            package.Url.Query.Length != 0 || package.Url.Fragment.Length != 0 ||
            !package.Url.AbsolutePath.StartsWith("/downloads/IMAGE/fi/psip-twain32/", StringComparison.Ordinal) ||
            package.Url.Segments[^1] != package.FileName ||
            Path.GetFileName(package.FileName) != package.FileName ||
            package.Bytes <= 0 || package.Sha256.Length != 64 ||
            !package.Sha256.All(Uri.IsHexDigit))
            throw new InvalidDataException("Invalid pinned scanner setup package.");
    }

    private static void RejectReparseDirectories(string directory)
    {
        for (var current = new DirectoryInfo(directory); current != null; current = current.Parent)
            if (current.Exists && (current.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException("The setup cache must not use redirected directories.");
    }
}
