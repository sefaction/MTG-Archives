using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Security.Cryptography;

namespace Mtg.Scanner;

public record HelperConnection(Guid AgentId, string Site, string Name, bool AllowLocal);
public record EnrollmentCredential(string Secret, string? PairCode, string Site, bool AllowLocal);
// Outbound HTTP only: no browser loopback API, listener or browser login cookie.
// This delivery slice connects/discovers. It never starts a scanner or executes
// arbitrary remote commands; START/artifact delivery follows separately.
public static class ScannerConnection
{
    public const string Version = "0.3.0-native";
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
    private static HttpClient Client(Uri site) => new(new HttpClientHandler { AllowAutoRedirect = false })
        { BaseAddress = site, Timeout = TimeSpan.FromSeconds(15) };
    private static async Task Send(HttpClient client, string route, object value, Guid agentId, string? token = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, route) { Content = JsonContent.Create(value, options: RunSpool.Json) };
        if (token != null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await client.SendAsync(request);
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
    public static async Task<bool> Run(string[] args)
    {
        if (args.Length == 0 || args[0] is not ("connect" or "serve" or "report" or "forget" or "connection-selftest" or "native-selftest" or "fixture-server")) return false;
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
                Console.WriteLine("PASS scanner private Windows credential and outbound-origin guards; no device used");
            } finally { WindowsCredential.Remove(id); }
            return true;
        }
        if (args[0] == "connect" && args.Length is 2 or 3)
        {
            var local = args.Length == 3 && args[2] == "--local";
            if (args.Length == 3 && !local) throw new ArgumentException("Unknown connect option");
            var site = Site(args[1], local);
            Console.Write("Connection code from Scan cards: ");
            var code = Console.ReadLine()?.Trim() ?? "";
            if (code.Length is < 70 or > 100) throw new ArgumentException("Invalid scanner connection code");
            var connection = new HelperConnection(Guid.NewGuid(), site.AbsoluteUri, "Windows scanner", local);
            var credential = new EnrollmentCredential(Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
                .TrimEnd('=').Replace('+', '-').Replace('/', '_'), code, site.AbsoluteUri, local);
            // Save the same client-chosen identity/secret before claim: a lost ACK
            // can be recovered without generating another agent credential.
            SaveCredential(connection, credential);
            SaveConnection(connection);
            Console.WriteLine($"Connection identity: {connection.AgentId}");
            using var client = Client(site);
            await Pair(client, connection, credential);
            Console.WriteLine("Connected. Run serve with this connection identity to report scanners.");
        }
        else if (args[0] is "serve" or "report" or "fixture-server" && args.Length == (args[0] == "fixture-server" ? 3 : 2))
        {
            var connection = LoadConnection(args[1]);
            var credential = Credential(connection);
            var fixture = args[0] == "fixture-server";
            if (fixture && (!connection.AllowLocal || Site(connection.Site, true).Scheme != "http" ||
                Environment.GetEnvironmentVariable("MTG_LOCAL_PILOT_TEST") != "1"))
                throw new ArgumentException("Fixture acquisition requires opt-in and an explicit local-loopback connection");
            using var client = Client(Site(connection.Site, connection.AllowLocal));
            using var stop = new CancellationTokenSource();
            ConsoleCancelEventHandler handler = (_, e) => { e.Cancel = true; stop.Cancel(); };
            Console.CancelKeyPress += handler;
            IReadOnlyList<Device> devices = [];
            var nextDiscovery = DateTime.MinValue;
            try {
                while (!stop.IsCancellationRequested)
                {
                    try {
                        if (DateTime.UtcNow >= nextDiscovery) {
                            using IScannerBackend backend = fixture ? new ScannerFixtureBackend(args[2]) : new Naps2Backend();
                            devices = await backend.ListDevices();
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
