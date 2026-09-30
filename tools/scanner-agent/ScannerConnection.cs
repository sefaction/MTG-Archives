using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Security.Cryptography;
using System.Diagnostics;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace Mtg.Scanner;

public record HelperConnection(Guid AgentId, string Site, string Name, bool AllowLocal, bool Disabled = false);
public record EnrollmentCredential(string Secret, string? PairCode, string Site, bool AllowLocal);
// Outbound HTTP only: no browser loopback API, listener or browser login cookie.
// Site pairing is a one-use handoff. Only an authenticated START can operate a scanner.
public static class ScannerConnection
{
    public const string Version = "0.3.0-native";
    public const string HelperVersion = "0.3.5";
    private static string Root => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MTGArchives", "ScannerAgent");
    public static Uri Site(string value, bool allowLocal)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.UserInfo.Length != 0 ||
            uri.AbsolutePath != "/" || uri.Query.Length != 0 || uri.Fragment.Length != 0 ||
            (uri.Scheme != "https" && !(allowLocal && uri.Scheme == "http" &&
                uri.Host is "localhost" or "127.0.0.1" or "[::1]")))
            throw new ArgumentException("Use the HTTPS website origin; HTTP requires --local and a loopback address");
        return uri;
    }
    private static string FileFor(Guid id) => Path.Combine(Root, $"{id}.json");
    private static FileStream AcquireServiceLock(Guid id)
    {
        Directory.CreateDirectory(Root);
        try { return new FileStream(Path.Combine(Root, $"{id}.serve.lock"), FileMode.OpenOrCreate,
            FileAccess.ReadWrite, FileShare.None); }
        catch (IOException) { throw new InvalidOperationException("Scanner helper is already running for this connection"); }
    }
    private static bool ServiceRunning(Guid id)
    {
        Directory.CreateDirectory(Root);
        try { using var probe = new FileStream(Path.Combine(Root, $"{id}.serve.lock"),
            FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); return false; }
        catch (IOException error) when ((error.HResult & 0xffff) is 32 or 33) { return true; }
    }
    private static HttpClient Client(Uri site) => new(new HttpClientHandler { AllowAutoRedirect = false })
        { BaseAddress = site, Timeout = TimeSpan.FromSeconds(15) };
    private sealed class RejectionHandler(System.Net.HttpStatusCode status) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(status));
    }
    private static async Task Send(HttpClient client, string route, object value, Guid agentId, string? token = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, route) { Content = JsonContent.Create(value, options: RunSpool.Json) };
        if (token != null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await client.SendAsync(request);
        if (ScannerConnectionRejected.IsPermanent(response.StatusCode)) throw new ScannerConnectionRejected(response.StatusCode);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"Scanner connection rejected ({(int)response.StatusCode})");
        var result = await response.Content.ReadFromJsonAsync<JsonElement>();
        if (result.GetProperty("version").GetInt32() != 1 || result.GetProperty("agentId").GetGuid() != agentId)
            throw new InvalidOperationException("Scanner acknowledgement identity changed");
    }
    private static void SaveConnection(HelperConnection connection)
    {
        Directory.CreateDirectory(Root);
        RunSpool.WriteNew(FileFor(connection.AgentId), connection);
    }
    private static void DisableConnection(HelperConnection connection)
    {
        var temporary = FileFor(connection.AgentId) + "." + Guid.NewGuid().ToString("N") + ".pending";
        try {
            RunSpool.WriteNew(temporary, connection with { Disabled = true });
            File.Move(temporary, FileFor(connection.AgentId), true);
        } finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    private static HelperConnection LoadConnection(string value)
    {
        if (!Guid.TryParse(value, out var id) || id == Guid.Empty) throw new ArgumentException("Choose a scanner connection identity");
        var connection = JsonSerializer.Deserialize<HelperConnection>(File.ReadAllText(FileFor(id)), RunSpool.Json)
            ?? throw new InvalidOperationException("Scanner connection unavailable");
        if (connection.AgentId != id) throw new InvalidOperationException("Scanner connection identity changed");
        Site(connection.Site, connection.AllowLocal);
        return connection;
    }
    private static EnrollmentCredential Credential(HelperConnection connection)
    {
        var credential = JsonSerializer.Deserialize<EnrollmentCredential>(WindowsCredential.Load(connection.AgentId), RunSpool.Json)
            ?? throw new InvalidOperationException("Scanner credential unavailable");
        if (credential.Site != connection.Site || credential.AllowLocal != connection.AllowLocal)
            throw new InvalidOperationException("Scanner credential site binding changed");
        return credential;
    }
    private static void SaveCredential(HelperConnection connection, EnrollmentCredential credential) =>
        WindowsCredential.Save(connection.AgentId, JsonSerializer.Serialize(credential, RunSpool.Json));
    private static async Task Pair(HttpClient client, HelperConnection connection, EnrollmentCredential credential)
    {
        await Send(client, "api/scanner-agent/pair", new { version = 1,
            pairCode = credential.PairCode, agentId = connection.AgentId, credential.Secret, connection.Name }, connection.AgentId);
        SaveCredential(connection, credential with { PairCode = null });
    }
    private static (Uri site, string code, bool local) ParsePairUri(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            uri.Scheme != "mtg-archive-scanner" || uri.Host != "connect" ||
            uri.AbsolutePath != "/" || uri.Fragment.Length != 0)
            throw new ArgumentException("Invalid scanner connection link");
        var fields = uri.Query.TrimStart('?').Split('&');
        if (fields.Length != 2 || !fields[0].StartsWith("site=", StringComparison.Ordinal) ||
            !fields[1].StartsWith("code=", StringComparison.Ordinal))
            throw new ArgumentException("Invalid scanner connection link");
        var siteText = Uri.UnescapeDataString(fields[0][5..]);
        var code = Uri.UnescapeDataString(fields[1][5..]);
        var local = siteText.StartsWith("http://", StringComparison.OrdinalIgnoreCase);
        var site = Site(siteText, local);
        if (!Regex.IsMatch(code, "^[a-f0-9-]{36}\\.[A-Za-z0-9_-]{43}$", RegexOptions.CultureInvariant) ||
            !Guid.TryParse(code[..36], out _))
            throw new ArgumentException("Invalid scanner connection link");
        return (site, code, local);
    }
    private static async Task<Guid> ConnectWithCode(Uri site, string code, bool local, bool announce)
    {
        if (code.Length is < 70 or > 100) throw new ArgumentException("Invalid scanner connection code");
        var connection = new HelperConnection(Guid.NewGuid(), site.AbsoluteUri, "Windows scanner", local);
        var credential = new EnrollmentCredential(Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_'), code, site.AbsoluteUri, local);
        // Save the same client-chosen identity/secret before claim: a lost ACK
        // can be recovered without generating another agent credential.
        SaveCredential(connection, credential);
        SaveConnection(connection);
        if (announce) Console.WriteLine($"Connection identity: {connection.AgentId}");
        using var client = Client(site);
        await Pair(client, connection, credential);
        return connection.AgentId;
    }
    private static async Task PairFromWebsite(string value)
    {
        if (Uri.TryCreate(value, UriKind.Absolute, out var resume) && resume.Host == "resume") {
            await ResumeFromWebsite(value); return;
        }
        var (site, code, local) = ParsePairUri(value);
        if (MessageBox.Show($"Connect this Windows scanner to {site.AbsoluteUri}?", "MTG Archives Scanner",
            MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        try {
            var id = await ConnectWithCode(site, code, local, false);
            StartService(id);
            MessageBox.Show("Connected. Return to Scan cards and choose your scanner.",
                "MTG Archives Scanner", MessageBoxButtons.OK, MessageBoxIcon.Information);
        } catch {
            MessageBox.Show("Connection failed. Return to Scan cards and try Connect a scanner again.",
                "MTG Archives Scanner", MessageBoxButtons.OK, MessageBoxIcon.Error);
            throw;
        }
    }
    private static void StartService(Guid id)
    {
        if (ServiceRunning(id)) return;
        var executable = Environment.ProcessPath;
        if (executable == null || !Path.GetFileName(executable).Equals("Mtg.ScannerAgent.exe", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Installed scanner helper executable unavailable");
        var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true };
        start.ArgumentList.Add("serve"); start.ArgumentList.Add(id.ToString());
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Scanner helper could not start");
        if (process.WaitForExit(800)) throw new InvalidOperationException("Scanner helper could not stay online");
    }
    private static Uri ParseResumeUri(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != "mtg-archive-scanner" ||
            uri.Host != "resume" || uri.AbsolutePath != "/" || uri.Fragment.Length != 0 ||
            !uri.Query.StartsWith("?site=", StringComparison.Ordinal) || uri.Query.Contains('&'))
            throw new ArgumentException("Invalid scanner reconnect link");
        var text = Uri.UnescapeDataString(uri.Query[6..]);
        return Site(text, text.StartsWith("http://", StringComparison.OrdinalIgnoreCase));
    }
    private static int ResumeSaved(Uri? site = null, Action<Guid>? start = null)
    {
        if (!Directory.Exists(Root)) return 0;
        var resumed = 0;
        foreach (var file in Directory.EnumerateFiles(Root, "*.json").Take(512)) {
            if (resumed >= 8) break;
            if (!Guid.TryParse(Path.GetFileNameWithoutExtension(file), out var id)) continue;
            try {
                var connection = LoadConnection(id.ToString());
                if (connection.Disabled || (site != null && connection.Site != site.AbsoluteUri)) continue;
                var credential = Credential(connection);
                if (credential.PairCode != null) continue;
                (start ?? StartService)(id); resumed++;
            } catch (Exception error) when (error is IOException or InvalidOperationException or ArgumentException or JsonException) { }
        }
        return resumed;
    }
    private static Task ResumeFromWebsite(string value)
    {
        var site = ParseResumeUri(value);
        if (MessageBox.Show($"Open your saved scanner connection for {site.AbsoluteUri}? No scan will start.",
            "MTG Archives Scanner", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
            return Task.CompletedTask;
        var count = ResumeSaved(site);
        MessageBox.Show(count > 0 ? "Scanner helper opened. Return to Scan cards; it will show online shortly." :
            "No saved connection is available for this site. Return to Scan cards and choose Connect this computer.",
            "MTG Archives Scanner", MessageBoxButtons.OK, count > 0 ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
        return Task.CompletedTask;
    }
    public static async Task<bool> Run(string[] args)
    {
        if (args.Length == 0) {
            var resumed = ResumeSaved();
            MessageBox.Show(resumed > 0 ? "Your saved scanner helper connections are open. Return to Imports → Scan cards to scan." :
                "The scanner helper is installed. Open Imports → Scan cards on your MTG Archives site, then choose Connect a scanner.",
                "MTG Archives Scanner", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return true;
        }
        if (args[0] is not ("version" or "connect" or "pair-uri" or "resume" or "serve" or "report" or "forget" or "connection-selftest" or "native-selftest" or "fixture-server")) return false;
        if (args[0] == "version" && args.Length == 1) {
            Console.WriteLine(JsonSerializer.Serialize(new { helperVersion = HelperVersion, protocolVersion = Version, naps2SdkVersion = "1.3.0" }, RunSpool.Json));
            return true;
        }
        if (args[0] == "native-selftest") { await ScannerNativeSelfTest.Run(Path.Combine(Root, "selftests")); return true; }
        if (args[0] == "connection-selftest")
        {
            var id = Guid.NewGuid();
            var secret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
            try {
                WindowsCredential.Save(id, secret);
                if (WindowsCredential.Load(id) != secret) throw new InvalidOperationException("Credential roundtrip failed");
                foreach (var rejected in new[] { "http://example.com/", "https://user@example.com/", "https://example.com/path", "file:///test" })
                {
                    try { Site(rejected, true); throw new InvalidOperationException("Unsafe site accepted"); }
                    catch (ArgumentException) { }
                }
                Site("https://example.com/", false); Site("http://127.0.0.1:13001/", true);
                foreach (var status in new[] { System.Net.HttpStatusCode.Unauthorized, System.Net.HttpStatusCode.Forbidden, System.Net.HttpStatusCode.ServiceUnavailable }) {
                    using var handler = new RejectionHandler(status);
                    using var client = new HttpClient(handler) { BaseAddress = new Uri("https://fixture.invalid/") };
                    try { await Send(client, "api/scanner-agent/pulse", new { version = 1 }, id, "fixture");
                        throw new InvalidDataException("Rejected response was acknowledged"); }
                    catch (ScannerConnectionRejected error) when (status != System.Net.HttpStatusCode.ServiceUnavailable && error.Status == status) { }
                    catch (InvalidOperationException error) when (status == System.Net.HttpStatusCode.ServiceUnavailable && error is not ScannerConnectionRejected) { }
                }
                using (var first = AcquireServiceLock(id)) {
                    if (!ServiceRunning(id)) throw new InvalidDataException("Running service was not detected");
                    try { using var duplicate = AcquireServiceLock(id); throw new InvalidDataException("Duplicate helper service acquired a connection"); }
                    catch (InvalidOperationException) { }
                }
                if (ServiceRunning(id)) throw new InvalidDataException("Closed service still appears active");
                using (AcquireServiceLock(id)) { } // A closed service can reopen cleanly.
                ParseResumeUri("mtg-archive-scanner://resume?site=https%3A%2F%2Fexample.com%2F");
                ParseResumeUri("mtg-archive-scanner://resume?site=http%3A%2F%2F127.0.0.1%3A13001%2F");
                foreach (var invalid in new[] {
                    "mtg-archive-scanner://resume?site=http%3A%2F%2Fexample.com%2F",
                    "mtg-archive-scanner://resume?site=https%3A%2F%2Fexample.com%2F&extra=1",
                    "mtg-archive-scanner://resume?site=https%3A%2F%2Fexample.com%2Fpath",
                    "https://resume/?site=https%3A%2F%2Fexample.com%2F" }) {
                    try { ParseResumeUri(invalid); throw new InvalidDataException("Unsafe resume link accepted"); }
                    catch (ArgumentException) { }
                }
                var saved = new HelperConnection(id, $"https://{id}.invalid/", "fixture", false);
                SaveConnection(saved);
                SaveCredential(saved, new EnrollmentCredential("fixture", null, saved.Site, false));
                var opened = new List<Guid>();
                if (ResumeSaved(new Uri("https://different.invalid/"), opened.Add) != 0 || opened.Count != 0)
                    throw new InvalidDataException("Reconnect resumed a different site");
                if (ResumeSaved(new Uri(saved.Site), opened.Add) != 1 || opened.Single() != id)
                    throw new InvalidDataException("Reconnect did not select the saved site");
                DisableConnection(saved);
                if (!LoadConnection(id.ToString()).Disabled || ResumeSaved(new Uri(saved.Site), opened.Add) != 0 || opened.Count != 1)
                    throw new InvalidDataException("Revoked connection resumed instead of staying disabled");
                var sample = ParsePairUri("mtg-archive-scanner://connect?site=https%3A%2F%2Fexample.com%2F&code=" +
                    Guid.NewGuid().ToString() + "." + new string('A', 43));
                if (sample.site.AbsoluteUri != "https://example.com/" || sample.local) throw new InvalidOperationException("Pair link changed");
                foreach (var unsafeLink in new[] {
                    "mtg-archive-scanner://connect?site=http%3A%2F%2Fexample.com%2F&code=" + Guid.NewGuid() + "." + new string('A', 43),
                    "mtg-archive-scanner://connect?site=https%3A%2F%2Fexample.com%2Fpath&code=" + Guid.NewGuid() + "." + new string('A', 43),
                    "mtg-archive-scanner://connect?site=https%3A%2F%2Fexample.com%2F&code=bad",
                    "mtg-archive-scanner://connect?site=https%3A%2F%2Fexample.com%2F&code=" + Guid.NewGuid() + "." + new string('A', 43) + "&extra=1"
                }) {
                    try { ParsePairUri(unsafeLink); throw new InvalidOperationException("Unsafe pair link accepted"); }
                    catch (ArgumentException) { }
                }
                Console.WriteLine("PASS scanner private Windows credential and outbound-origin guards; no device used");
            } finally { WindowsCredential.Remove(id); File.Delete(FileFor(id)); File.Delete(Path.Combine(Root, $"{id}.serve.lock")); }
            return true;
        }
        if (args[0] == "pair-uri" && args.Length == 2)
        {
            await PairFromWebsite(args[1]);
            return true;
        }
        if (args[0] == "resume" && args.Length == 1)
        {
            ResumeSaved();
            return true;
        }
        if (args[0] == "connect" && args.Length is 2 or 3)
        {
            var local = args.Length == 3 && args[2] == "--local";
            if (args.Length == 3 && !local) throw new ArgumentException("Unknown connect option");
            var site = Site(args[1], local);
            Console.Write("Connection code from Scan cards: ");
            var code = Console.ReadLine()?.Trim() ?? "";
            await ConnectWithCode(site, code, local, true);
            Console.WriteLine("Connected. Run serve with this connection identity to report scanners.");
        }
        else if (args[0] is "serve" or "report" or "fixture-server" && args.Length == (args[0] == "fixture-server" ? 3 : 2))
        {
            var connection = LoadConnection(args[1]);
            var credential = Credential(connection);
            using var serviceLock = args[0] == "serve" ? AcquireServiceLock(connection.AgentId) : null;
            var fixture = args[0] == "fixture-server";
            if (fixture && (!connection.AllowLocal || Site(connection.Site, true).Scheme != "http" ||
                Environment.GetEnvironmentVariable("MTG_LOCAL_PILOT_TEST") != "1"))
                throw new ArgumentException("Fixture acquisition requires opt-in and an explicit local-loopback connection");
            using var client = Client(Site(connection.Site, connection.AllowLocal));
            using var stop = new CancellationTokenSource();
            ConsoleCancelEventHandler handler = (_, e) => { e.Cancel = true; stop.Cancel(); };
            Console.CancelKeyPress += handler;
            IReadOnlyList<Device> devices = [];
            using IScannerBackend discoveryBackend = fixture ? new ScannerFixtureBackend(args[2]) : new Naps2Backend();
            var nextDiscovery = DateTime.MinValue;
            var nextRetention = DateTime.MinValue;
            try {
                while (!stop.IsCancellationRequested)
                {
                    try {
                        if (DateTime.UtcNow >= nextDiscovery) {
                            devices = await discoveryBackend.ListDevices();
                            nextDiscovery = DateTime.UtcNow.AddSeconds(30);
                        }
                        var pulse = new { version = 1, agentVersion = Version, devices };
                        try { await Send(client, "api/scanner-agent/pulse", pulse, connection.AgentId, $"{connection.AgentId}.{credential.Secret}"); }
                        catch (InvalidOperationException) when (credential.PairCode != null) {
                            await Pair(client, connection, credential);
                            await Send(client, "api/scanner-agent/pulse", pulse, connection.AgentId, $"{connection.AgentId}.{credential.Secret}");
                        }
                        if (credential.PairCode != null) {
                            credential = credential with { PairCode = null }; SaveCredential(connection, credential);
                        }
                        Console.WriteLine($"Scanner connection online; {devices.Count} source(s). No scan requested.");
                        if (args[0] == "report") break;
                        await ScannerNativeRunner.PollAndRun(client, connection.AgentId,
                            $"{connection.AgentId}.{credential.Secret}", Root, devices, stop.Token,
                            fixture ? () => new ScannerFixtureBackend(args[2]) : null,
                            fixture ? () => new { backend = "fixture", purpose = "LOCAL_PROTOCOL_TEST_ONLY" } : null);
                        if (args[0] == "serve" && DateTime.UtcNow >= nextRetention) {
                            nextRetention = DateTime.UtcNow.AddMinutes(5);
                            try {
                                var removed = await ScannerOriginalRetention.Check(client,
                                    $"{connection.AgentId}.{credential.Secret}", Root, connection.AgentId);
                                if (removed > 0) Console.WriteLine($"Expired scanner originals removed: {removed}");
                            } catch (Exception error) when (error is HttpRequestException or TaskCanceledException or
                                InvalidOperationException or IOException or JsonException) {
                                Console.WriteLine("Scanner original retention check unavailable; local originals retained.");
                            }
                        }
                    }
                    catch (ScannerConnectionRejected) when (args[0] != "report") {
                        // Retain credentials/originals, but do not restart a revoked
                        // connection at each sign-in or open. A new pairing is required.
                        DisableConnection(connection);
                        // A revoked helper must release its discovery worker, not keep retrying
                        // forever. Originals and credentials remain private for reconciliation.
                        Console.WriteLine("Scanner connection disconnected on the website. Background helper stopped; originals retained.");
                        break;
                    }
                    catch (Exception error) when (args[0] != "report" && error is HttpRequestException or InvalidOperationException or TaskCanceledException) {
                        Console.WriteLine("Scanner connection unavailable; credentials and pending enrollment retained. Retrying.");
                    }
                    await Task.Delay(5000, stop.Token);
                }
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
            finally { Console.CancelKeyPress -= handler; }
        }
        else if (args[0] == "forget" && args.Length == 2)
        {
            var connection = LoadConnection(args[1]);
            WindowsCredential.Remove(connection.AgentId);
            File.Delete(FileFor(connection.AgentId));
            Console.WriteLine("Local connection removed. Disconnect its entry on the website to revoke server access.");
        }
        else throw new ArgumentException("Use connect <site> [--local], serve <connection-id>, report <connection-id>, or forget <connection-id>");
        return true;
    }
}
