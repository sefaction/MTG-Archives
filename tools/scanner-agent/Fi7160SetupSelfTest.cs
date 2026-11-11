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
            await ProfileAndWizardChecks(root);
            Console.WriteLine("PASS pinned fi-7160 download/cache, tampered/truncated/oversized/redirect refusal, cancelled transfer and existing-file preservation; no network, install, driver or scanner");
        }
        catch (Exception error) { Console.Error.WriteLine("Setup self-test: " + error); throw; }
        finally
        {
            if (Path.GetDirectoryName(root) != Path.GetTempPath().TrimEnd(Path.DirectorySeparatorChar) ||
                !Path.GetFileName(root).StartsWith("mtg-fi7160-setup-", StringComparison.Ordinal))
                throw new InvalidOperationException("Unexpected owned setup fixture directory.");
            Directory.Delete(root, true);
        }
    }

    private static async Task ProfileAndWizardChecks(string root)
    {
        var entries = Fi7160Profiles.Entries();
        var baseline = Fi7160Profiles.Xml(entries["FTS_EX000004.xml"]);
        var fast = Fi7160Profiles.Xml(entries["FTS_EX000005.xml"]);
        foreach (var pair in new[] { (baseline, 600), (fast, 300) })
        {
            var resolutions = pair.Item1.Elements("capability").Where(c => (string?)c.Element("name") is "4376" or "4377").ToArray();
            if (resolutions.Length != 4 || resolutions.Any(c => (string?)c.Element("whole") != pair.Item2.ToString() || (string?)c.Element("frac") != "0") ||
                pair.Item1.Elements("capability").Any(c => (string?)c.Element("valueType") == "12" && !string.IsNullOrEmpty((string?)c.Element("value"))))
                throw new InvalidDataException("Portable Cards payload includes wrong resolution or personal string metadata.");
        }
        foreach (var cap in fast.Elements("capability").Where(c => (string?)c.Element("name") is "4376" or "4377")) cap.Element("whole")!.Value = "600";
        if (!System.Xml.Linq.XNode.DeepEquals(baseline, fast)) throw new InvalidDataException("The fast preset changed a setting other than resolution.");
        var fixture = Path.Combine(root, "profile-store"); Directory.CreateDirectory(fixture);
        File.WriteAllText(Path.Combine(fixture, "SettingInfo.ini"), "[Informations]\r\n000042=" + Fi7160Profiles.Name600 + "\r\n000043=" + Fi7160Profiles.Name300 + "\r\n");
        File.WriteAllBytes(Path.Combine(fixture, "FTS_EX000042.xml"), entries["FTS_EX000004.xml"]);
        File.WriteAllBytes(Path.Combine(fixture, "FTS_EX000043.xml"), entries["FTS_EX000005.xml"]);
        if (!Fi7160Profiles.Installed(fixture)) throw new InvalidDataException("Vendor-remapped profile IDs were not recognized.");
        File.WriteAllBytes(Path.Combine(fixture, "FTS_EX000043.xml"), entries["FTS_EX000004.xml"]);
        if (Fi7160Profiles.Installed(fixture)) throw new InvalidDataException("A profile name alone produced readiness with wrong settings.");
        var bundle = Fi7160Profiles.Materialize(Path.Combine(root, "profiles"));
        if (Fi7160Profiles.Materialize(Path.Combine(root, "profiles")) != bundle) throw new InvalidDataException("Repeat profile preparation changed its package.");
        File.WriteAllText(bundle, "unexpected existing data");
        var refused = false;
        try { Fi7160Profiles.Materialize(Path.Combine(root, "profiles")); } catch (InvalidDataException) { refused = true; }
        if (!refused || File.ReadAllText(bundle) != "unexpected existing data") throw new InvalidDataException("An existing Cards package was overwritten.");
        var beforeImport = Fi7160SetupSystem.BackupProfiles(fixture, Path.Combine(root, "profile-backups"));
        var recoveryJournal = Path.Combine(root, "profile-import-pending.json");
        Fi7160SetupSystem.BeginProfileImport(beforeImport, recoveryJournal);
        File.AppendAllText(Path.Combine(fixture, "SettingInfo.ini"), "000044=Unrelated new profile\r\n");
        File.WriteAllText(Path.Combine(fixture, "FTS_EX000044.xml"), "new profile fixture");
        File.WriteAllText(Path.Combine(fixture, "Id.bin"), "updated allocation index");
        Fi7160SetupSystem.VerifyPreserved(beforeImport); // Native additive changes are allowed.
        var oldProfile = Path.Combine(fixture, "FTS_EX000042.xml");
        File.WriteAllText(oldProfile, "changed by an erroneous replacing import");
        refused = false;
        try { Fi7160SetupSystem.VerifyPreserved(beforeImport); } catch (InvalidOperationException) { refused = true; }
        if (!refused || !File.ReadAllBytes(Path.Combine(beforeImport.Directory, "FTS_EX000042.xml")).SequenceEqual(entries["FTS_EX000004.xml"]) ||
            File.ReadAllText(oldProfile) != "changed by an erroneous replacing import")
            throw new InvalidDataException("Replacing import was not refused with a retained backup and no automatic live-store rewrite.");
        refused = false;
        try { Fi7160SetupSystem.RecoverProfileImport(recoveryJournal, Path.Combine(root, "profile-backups"), fixture); } catch (InvalidOperationException) { refused = true; }
        if (!refused || !File.Exists(recoveryJournal)) throw new InvalidDataException("Failed profile preservation cleared the persistent recovery gate.");
        File.WriteAllBytes(oldProfile, entries["FTS_EX000004.xml"]);
        Fi7160SetupSystem.RecoverProfileImport(recoveryJournal, Path.Combine(root, "profile-backups"), fixture);
        if (File.Exists(recoveryJournal)) throw new InvalidDataException("Verified unchanged profiles could not leave interrupted-import recovery.");
        File.WriteAllText(Path.Combine(fixture, "SettingInfo.ini"), "[Informations]\r\n000042=Wrong name\r\n");
        refused = false;
        try { Fi7160SetupSystem.VerifyPreserved(beforeImport); } catch (InvalidOperationException) { refused = true; }
        if (!refused) throw new InvalidDataException("Changed/deleted pre-existing profile names were accepted.");
        if (Fi7160SetupSystem.ScanPage("https://example.com/").AbsoluteUri != "https://example.com/imports/scan?input=scanner" ||
            Fi7160SetupSystem.ScanPage("http://127.0.0.1:13001").Port != 13001)
            throw new InvalidDataException("The wizard lost its website origin or local review port.");
        foreach (var url in new[] { "http://example.com/", "https://example.com/other", "https://name:password@example.com/", "file:///C:/example" })
        {
            refused = false; try { Fi7160SetupSystem.ScanPage(url); } catch (ArgumentException) { refused = true; }
            if (!refused) throw new InvalidDataException("An unsafe setup website was accepted.");
        }
        using var proof = System.Text.Json.JsonDocument.Parse("{\"verified\":true,\"sourceClosed\":true,\"dsmClosed\":true,\"ownedLoopJoined\":true,\"acquisitionEnables\":0}");
        Fi7160SetupCompanion.RequireProof(proof.RootElement);
        foreach (var field in new[] { "verified", "sourceClosed", "dsmClosed", "ownedLoopJoined", "acquisitionEnables" })
        {
            var malformed = System.Text.Json.Nodes.JsonNode.Parse(proof.RootElement.GetRawText())!.AsObject(); malformed.Remove(field);
            using var missing = System.Text.Json.JsonDocument.Parse(malformed.ToJsonString());
            refused = false; try { Fi7160SetupCompanion.RequireProof(missing.RootElement); } catch (InvalidDataException) { refused = true; }
            if (!refused) throw new InvalidDataException("Missing settings/closure proof produced readiness.");
        }
        foreach (var scenario in new[] { "fresh", "installed", "incompatible", "restart" })
        {
            var system = new Fi7160SetupPreview(scenario); var state = system.Inspect();
            if (scenario == "fresh") { await system.InstallDriver(new Progress<long>(), default); await system.ImportProfiles(); state = system.Inspect(); }
            if (state.DriverSupported != (scenario is "fresh" or "installed")) throw new InvalidDataException("Wrong driver/restart wizard gate.");
        }
        foreach (var command in new object[] {
            new { action = "start", parent = Environment.ProcessId, emptyClearConfirmed = true },
            new { action = "configure-settings-only", parent = Environment.ProcessId, emptyClearConfirmed = false } })
        {
            var start = new System.Diagnostics.ProcessStartInfo(CountedTwainBackend.WorkerPath) { UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true };
            start.ArgumentList.Add("setup-profile-v1");
            using var child = System.Diagnostics.Process.Start(start)!;
            await child.StandardInput.WriteLineAsync(System.Text.Json.JsonSerializer.Serialize(command)); child.StandardInput.Close();
            var response = await child.StandardOutput.ReadToEndAsync(); await child.WaitForExitAsync();
            if (child.ExitCode != 1 || !response.Contains("\"sourceClosed\":false", StringComparison.Ordinal) ||
                !response.Contains("\"verified\":false", StringComparison.Ordinal) || !response.Contains("\"acquisitionEnables\":0", StringComparison.Ordinal))
                throw new InvalidDataException("Invalid settings command reached native setup or claimed success.");
        }
        Console.WriteLine("PASS portable fi-7160 profiles, resolution-only delta, remapped IDs, wrong-settings refusal, retry preservation, website origins, missing closure proof, restart/version gates and real companion no-START dispatch");
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
