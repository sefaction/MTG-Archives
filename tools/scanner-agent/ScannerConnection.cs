using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Security.Cryptography;
using System.Diagnostics;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace Mtg.Scanner;

public record HelperConnection(Guid AgentId, string Site, string Name, bool AllowLocal, bool Disabled = false, string? Account = null);
public record EnrollmentCredential(string Secret, string? PairCode, string Site, bool AllowLocal);
// Outbound HTTP only: no browser loopback API, listener or browser login cookie.
// Site pairing is a one-use handoff. Only an authenticated START can operate a scanner.
public static class ScannerConnection
{
    public const string Version = "0.3.0-native";
    public const string HelperVersion = "0.4.3";
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
    private static IEnumerable<Guid> SavedIdentities() => Directory.Exists(Root)
        ? Directory.EnumerateFiles(Root, "*.json").Take(512)
            .Select(file => Guid.TryParse(Path.GetFileNameWithoutExtension(file), out var id) ? id : Guid.Empty)
            .Where(id => id != Guid.Empty) : [];
    private static void RequireSingleService(Guid id)
    {
        if (SavedIdentities().Any(other => other != id && ServiceRunning(other)))
            throw new InvalidOperationException("Another scanner connection is open. Choose the open connection and close it before switching.");
    }
    private static FileStream AcquireSingleService(Guid id)
    {
        Directory.CreateDirectory(Root);
        FileStream lease;
        try { lease = ScannerConnectionSelection.AcquireLease(Root); }
        catch (IOException) { throw new InvalidOperationException("Another scanner connection is already open"); }
        try { RequireSingleService(id); return lease; }
        catch { lease.Dispose(); throw; }
    }
    private static HttpClient Client(Uri site) => new(new HttpClientHandler { AllowAutoRedirect = false })
        { BaseAddress = site, Timeout = TimeSpan.FromSeconds(15) };
    private sealed class RejectionHandler(System.Net.HttpStatusCode status) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(status));
    }
    private static async Task<JsonElement> Send(HttpClient client, string route, object value, Guid agentId, string? token = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, route) { Content = JsonContent.Create(value, options: RunSpool.Json) };
        if (token != null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await client.SendAsync(request);
        if (ScannerConnectionRejected.IsPermanent(response.StatusCode)) throw new ScannerConnectionRejected(response.StatusCode);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"Scanner connection rejected ({(int)response.StatusCode})");
        var result = await response.Content.ReadFromJsonAsync<JsonElement>();
        if (result.GetProperty("version").GetInt32() != 1 || result.GetProperty("agentId").GetGuid() != agentId)
            throw new InvalidOperationException("Scanner acknowledgement identity changed");
        return result;
    }
    internal static Dictionary<string, object> DiscoveryPulse(IReadOnlyList<Device> devices,
        IReadOnlyList<ScannerDiscoveryIssue> issues, bool reporting, bool progressReporting = false) {
        var pending = issues.Any(issue => issue.Code == "DISCOVERY_IN_PROGRESS");
        // Older sites cannot gate Start on progress. Do not advertise sources
        // there until discovery settles, or send them an unknown diagnostic code.
        var pulse = new Dictionary<string, object> { ["version"] = 1, ["agentVersion"] = Version,
            ["devices"] = pending && !progressReporting ? Array.Empty<Device>() : devices };
        if (reporting) pulse["discoveryIssues"] = progressReporting ? issues :
            issues.Where(issue => issue.Code != "DISCOVERY_IN_PROGRESS").ToArray();
        return pulse;
    }
    private static void SaveConnection(HelperConnection connection)
    {
        Directory.CreateDirectory(Root);
        RunSpool.WriteNew(FileFor(connection.AgentId), connection);
    }
    private static void DisableConnection(HelperConnection connection)
        => ReplaceConnection(connection with { Disabled = true });
    private static void ReplaceConnection(HelperConnection connection)
    {
        var temporary = FileFor(connection.AgentId) + "." + Guid.NewGuid().ToString("N") + ".pending";
        try {
            RunSpool.WriteNew(temporary, connection);
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
    private static HelperConnection RememberAccount(HelperConnection connection, JsonElement acknowledgement)
    {
        if (!acknowledgement.TryGetProperty("connectionAccount", out var account) || account.ValueKind != JsonValueKind.String)
            return connection;
        var text = account.GetString();
        if (string.IsNullOrWhiteSpace(text) || text.Length > 160 || text.Any(char.IsControl) || text == connection.Account)
            return connection;
        var updated = connection with { Account = text };
        ReplaceConnection(updated);
        return updated;
    }
    private static string CloseRequest(Guid id) => Path.Combine(Root, $"{id}.close.request");
    private static string ServiceInfo(Guid id) => Path.Combine(Root, $"{id}.serve-info.json");
    private static void WriteServiceInfo(Guid id)
    {
        var temporary = ServiceInfo(id) + "." + Guid.NewGuid().ToString("N") + ".pending";
        try {
            RunSpool.WriteNew(temporary, new { version = 1, agentId = id, processId = Environment.ProcessId, closeAfterBatch = true });
            File.Move(temporary, ServiceInfo(id), true);
        } finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    private static void RequestClose(Guid id)
    {
        if (!ServiceRunning(id)) return;
        try {
            var info = JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(ServiceInfo(id)));
            if (info.GetProperty("version").GetInt32() != 1 || info.GetProperty("agentId").GetGuid() != id ||
                !info.GetProperty("closeAfterBatch").GetBoolean() || Process.GetProcessById(info.GetProperty("processId").GetInt32()).HasExited)
                throw new InvalidOperationException("Scanner connection close status is unavailable");
        } catch (Exception error) when (error is IOException or JsonException or KeyNotFoundException or ArgumentException or InvalidOperationException) {
            throw new InvalidOperationException("This older helper cannot be closed here. Finish its current batch before updating the helper.");
        }
        var path = CloseRequest(id);
        if (!File.Exists(path)) RunSpool.WriteNew(path, new { version = 1, agentId = id });
    }
    private static Guid? ChooseConnection(IReadOnlyList<HelperConnection> available, Guid? preferred)
        => ScannerConnectionSelection.Choose(available, preferred, ServiceRunning, RequestClose);
    private static async Task Pair(HttpClient client, HelperConnection connection, EnrollmentCredential credential)
    {
        var acknowledgement = await Send(client, "api/scanner-agent/pair", new { version = 1,
            pairCode = credential.PairCode, agentId = connection.AgentId, credential.Secret, connection.Name }, connection.AgentId);
        RememberAccount(connection, acknowledgement);
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
            ScannerConnectionSelection.Save(Root, id);
            // The foreground launcher must leave after startup, so counted
            // preparation sees only the selected background helper owner.
        } catch {
            MessageBox.Show("Connection failed. Return to Scan cards and try Connect a scanner again.",
                "MTG Archives Scanner", MessageBoxButtons.OK, MessageBoxIcon.Error);
            throw;
        }
    }
    private static void StartService(Guid id)
    {
        RequireSingleService(id);
        if (ServiceRunning(id)) {
            if (File.Exists(CloseRequest(id))) throw new InvalidOperationException("This connection is closing after its current batch. Wait for it to finish, then open the helper again.");
            return;
        }
        if (File.Exists(CloseRequest(id))) File.Delete(CloseRequest(id));
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
    private static int ResumeSaved(Uri? site = null, Action<Guid>? start = null,
        Func<IReadOnlyList<HelperConnection>, Guid?, Guid?>? choose = null)
    {
        if (!Directory.Exists(Root)) return 0;
        var available = new List<HelperConnection>();
        foreach (var id in SavedIdentities()) {
            try {
                var connection = LoadConnection(id.ToString());
                if (connection.Disabled || (site != null && connection.Site != site.AbsoluteUri)) continue;
                var credential = Credential(connection);
                if (credential.PairCode != null) continue;
                available.Add(connection);
            } catch (Exception error) when (error is IOException or InvalidOperationException or ArgumentException or JsonException) { }
        }
        available = available.OrderBy(c => c.Site).ThenBy(c => c.Name).ThenBy(c => c.AgentId).ToList();
        var preferred = ScannerConnectionSelection.Read(Root);
        // A website reconnect explicitly requests that site, never another origin.
        if (site != null && !available.Any(c => c.AgentId == preferred)) preferred = null;
        var selected = ScannerConnectionSelection.Resolve(available, preferred, choose);
        if (selected == null) return 0;
        var current = LoadConnection(selected.Value.ToString());
        if (current.Disabled || Credential(current).PairCode != null) return 0;
        (start ?? StartService)(selected.Value);
        if (start == null) ScannerConnectionSelection.Save(Root, selected.Value);
        return 1;
    }
    private static Task ResumeFromWebsite(string value)
    {
        var site = ParseResumeUri(value);
        if (MessageBox.Show($"Open your saved scanner connection for {site.AbsoluteUri}? No scan will start.",
            "MTG Archives Scanner", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
            return Task.CompletedTask;
        int count;
        var chooserShown = false;
        try { count = ResumeSaved(site, choose: (available, preferred) => { chooserShown = true; return ChooseConnection(available, preferred); }); }
        catch (InvalidOperationException error) {
            MessageBox.Show(error.Message, "MTG Archives Scanner", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return Task.CompletedTask;
        }
        if (count == 0 && !chooserShown) MessageBox.Show("No saved connection is available for this site. Return to Scan cards and choose Connect this computer.",
            "MTG Archives Scanner", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        return Task.CompletedTask;
    }
    public static async Task<bool> Run(string[] args)
    {
        if (args.Length == 0) {
            int resumed;
            var chooserShown = false;
            try { resumed = ResumeSaved(choose: (available, preferred) => { chooserShown = true; return ChooseConnection(available, preferred); }); }
            catch (InvalidOperationException error) {
                MessageBox.Show(error.Message, "MTG Archives Scanner", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return true;
            }
            if (resumed == 0 && !chooserShown) MessageBox.Show("Open Imports → Scan cards on your MTG Archives website, then choose Connect a scanner.",
                "MTG Archives Scanner", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return true;
        }
        if (args[0] is not ("version" or "connect" or "pair-uri" or "resume" or "serve" or "report" or "forget" or "connection-selftest" or "connection-picker-fixture" or "native-selftest" or "discovery-selftest" or "fixture-server" or "discovery-fixture-server")) return false;
        if (args[0] == "connection-picker-fixture" && args.Length == 1) {
            var choices = new[] {
                new HelperConnection(Guid.Parse("11111111-1111-4111-8111-111111111111"), "http://127.0.0.1:13001/", "Local scanner", true, Account: "Brian"),
                new HelperConnection(Guid.Parse("22222222-2222-4222-8222-222222222222"), "https://example.invalid/", "Other website", false, Account: "Brian"),
                new HelperConnection(Guid.Parse("33333333-3333-4333-8333-333333333333"), "http://127.0.0.1:13001/", "Another account", true, Account: "Sam") };
            var selected = ScannerConnectionSelection.Choose(choices, choices[0].AgentId, id => id == choices[0].AgentId,
                _ => Console.WriteLine("Fixture close requested; no service or scanner exists"));
            Console.WriteLine(selected == null ? "Fixture chooser cancelled; no service started" : $"Fixture selected {selected}; no service started");
            return true;
        }
        if (args[0] == "version" && args.Length == 1) {
            Console.WriteLine(JsonSerializer.Serialize(new { helperVersion = HelperVersion, protocolVersion = Version, naps2SdkVersion = "1.3.0" }, RunSpool.Json));
            return true;
        }
        if (args[0] == "native-selftest") { await ScannerNativeSelfTest.Run(Path.Combine(Root, "selftests")); return true; }
        if (args[0] == "discovery-selftest") { await ScannerDiscoveryProgressSelfTest.Run(); await ScannerDiscoverySelfTest.Run(); await ScannerDiagnosticSelfTest.Run(); return true; }
        if (args[0] == "connection-selftest")
        {
            ScannerConnectionSelection.SelfTest();
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
                using (var acknowledgement = JsonDocument.Parse("{\"connectionAccount\":\"Fixture owner\"}"))
                    saved = RememberAccount(saved, acknowledgement.RootElement);
                if (LoadConnection(id.ToString()).Account != "Fixture owner" || Credential(saved).Secret != "fixture")
                    throw new InvalidDataException("Account label changed credential binding");
                using (var acknowledgement = JsonDocument.Parse("{\"connectionAccount\":{\"name\":\"invalid\"}}"))
                    if (RememberAccount(saved, acknowledgement.RootElement) != saved)
                        throw new InvalidDataException("Malformed account label was accepted");
                var opened = new List<Guid>();
                if (ResumeSaved(new Uri("https://different.invalid/"), opened.Add) != 0 || opened.Count != 0)
                    throw new InvalidDataException("Reconnect resumed a different site");
                if (ResumeSaved(new Uri(saved.Site), opened.Add) != 1 || opened.Single() != id)
                    throw new InvalidDataException("Reconnect did not select the saved site");
                var duplicateId = Guid.NewGuid();
                try {
                    var duplicate = saved with { AgentId = duplicateId };
                    SaveConnection(duplicate); SaveCredential(duplicate, new EnrollmentCredential("fixture", null, duplicate.Site, false));
                    using (AcquireServiceLock(id)) {
                        try { RequireSingleService(duplicateId); throw new InvalidDataException("Legacy connection owner was ignored"); }
                        catch (InvalidOperationException) { }
                        try { RequestClose(id); throw new InvalidDataException("Legacy service close capability was assumed"); }
                        catch (InvalidOperationException) { }
                        WriteServiceInfo(id);
                        RequestClose(id);
                        if (!File.Exists(CloseRequest(id)) || !ServiceRunning(id) || Credential(saved).Secret != "fixture")
                            throw new InvalidDataException("Close request interrupted ownership or lost the saved connection");
                    }
                    File.Delete(CloseRequest(id)); File.Delete(ServiceInfo(id));
                    var selected = new List<Guid>();
                    if (ResumeSaved(new Uri(saved.Site), selected.Add) != 0 || selected.Count != 0)
                        throw new InvalidDataException("Ambiguous same-site reconnect opened multiple connections");
                    if (ResumeSaved(new Uri(saved.Site), selected.Add, (_, _) => duplicateId) != 1 || selected.Single() != duplicateId)
                        throw new InvalidDataException("Explicit same-site choice did not open exactly one connection");
                } finally {
                    WindowsCredential.Remove(duplicateId); File.Delete(FileFor(duplicateId));
                    File.Delete(Path.Combine(Root, $"{duplicateId}.serve.lock"));
                }
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
            } finally {
                WindowsCredential.Remove(id); File.Delete(FileFor(id)); File.Delete(Path.Combine(Root, $"{id}.serve.lock"));
                File.Delete(CloseRequest(id)); File.Delete(ServiceInfo(id));
            }
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
        else if (args[0] is "serve" or "report" or "fixture-server" or "discovery-fixture-server" && args.Length == (args[0] is "fixture-server" or "discovery-fixture-server" ? 3 : 2))
        {
            var connection = LoadConnection(args[1]);
            var credential = Credential(connection);
            using var singleService = args[0] == "serve" ? AcquireSingleService(connection.AgentId) : null;
            using var serviceLock = args[0] == "serve" ? AcquireServiceLock(connection.AgentId) : null;
            if (args[0] == "serve") {
                ScannerConnectionSelection.Save(Root, connection.AgentId);
                WriteServiceInfo(connection.AgentId);
            }
            var fixture = args[0] == "fixture-server";
            var discoveryFixture = args[0] == "discovery-fixture-server";
            if ((fixture || discoveryFixture) && (!connection.AllowLocal || Site(connection.Site, true).Scheme != "http" ||
                Environment.GetEnvironmentVariable("MTG_LOCAL_PILOT_TEST") != "1"))
                throw new ArgumentException("Fixture acquisition requires opt-in and an explicit local-loopback connection");
            using var client = Client(Site(connection.Site, connection.AllowLocal));
            using var stop = new CancellationTokenSource();
            ConsoleCancelEventHandler handler = (_, e) => { e.Cancel = true; stop.Cancel(); };
            Console.CancelKeyPress += handler;
            IReadOnlyList<Device> devices = [];
            using IScannerBackend discoveryBackend = discoveryFixture ? ScannerDiscoveryFixture.Create(args[2]) :
                fixture ? new ScannerFixtureBackend(args[2]) : new Naps2Backend();
            var discovery = new ScannerDiscoveryRefresh(discoveryBackend);
            var discoveryReporting = false; // Older websites accept the unchanged pulse.
            var discoveryProgressReporting = false;
            var nextRetention = DateTime.MinValue;
            try {
                while (!stop.IsCancellationRequested && !File.Exists(CloseRequest(connection.AgentId)))
                {
                    try {
                        if (args[0] == "report") await discovery.RefreshIfDue();
                        else await discovery.PulseTurn();
                        devices = discovery.Devices;
                        var pulse = DiscoveryPulse(devices, discovery.Issues, discoveryReporting, discoveryProgressReporting);
                        JsonElement acknowledgement;
                        try { acknowledgement = await Send(client, "api/scanner-agent/pulse", pulse, connection.AgentId, $"{connection.AgentId}.{credential.Secret}"); }
                        catch (InvalidOperationException) when (credential.PairCode != null) {
                            await Pair(client, connection, credential);
                            acknowledgement = await Send(client, "api/scanner-agent/pulse", pulse, connection.AgentId, $"{connection.AgentId}.{credential.Secret}");
                        }
                        discoveryReporting = acknowledgement.TryGetProperty("discoveryReporting", out var reporting) && reporting.ValueKind == JsonValueKind.True;
                        discoveryProgressReporting = acknowledgement.TryGetProperty("discoveryProgressReporting", out var progressReporting) && progressReporting.ValueKind == JsonValueKind.True;
                        connection = RememberAccount(connection, acknowledgement);
                        if (credential.PairCode != null) {
                            credential = credential with { PairCode = null }; SaveCredential(connection, credential);
                        }
                        Console.WriteLine(discovery.Pending ? "Scanner connection online; checking scanner drivers. No scan requested." :
                            $"Scanner connection online; {devices.Count} source(s). No scan requested.");
                        if (!discovery.Pending && discovery.Issues.Count > 0) Console.WriteLine("Some scanner drivers could not be checked; available sources remain usable. See the website for recovery guidance.");
                        if (args[0] == "report") {
                            if (discoveryReporting && !pulse.ContainsKey("discoveryIssues"))
                                await Send(client, "api/scanner-agent/pulse", DiscoveryPulse(devices, discovery.Issues, true),
                                    connection.AgentId, $"{connection.AgentId}.{credential.Secret}");
                            break;
                        }
                        if (!discoveryFixture && !discovery.Pending && !File.Exists(CloseRequest(connection.AgentId))) await ScannerNativeRunner.PollAndRun(client, connection.AgentId,
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
            finally {
                Console.CancelKeyPress -= handler;
                if (discovery.Pending) Console.WriteLine("Scanner driver detection is still finishing. No new scans will start; saved scans are kept.");
                // Revocation disables future work immediately. Wait for real native
                // completion before the using declaration disposes its context.
                try { await discovery.Drain(); }
                finally { if (args[0] == "serve" && File.Exists(ServiceInfo(connection.AgentId))) File.Delete(ServiceInfo(connection.AgentId)); }
            }
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
