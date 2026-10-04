using System.Text.Json;
using Mtg.Scanner;

try
{
    if (await ScannerCountedPreparation.Run(args)) return;
    if (await ScannerConnection.Run(args)) return;
    if (args.Length == 0 || args[0] is not ("list" or "list-wia" or "caps" or "scan" or "scan-diagnostic"))
        throw new ArgumentException("Commands: list | list-wia | caps <device-id> | scan <request.json> <private-spool-root> | scan-diagnostic <request.json> <private-spool-root> <mode>");
    var scan = args[0] is "scan" or "scan-diagnostic";
    if (scan && args.Length != (args[0] == "scan-diagnostic" ? 4 : 3))
        throw new ArgumentException("scan-diagnostic <request.json> <private-spool-root> default|memory|native|native-old-dsm|driver-ui");
    var scanRequest = scan ? JsonSerializer.Deserialize<ScanRequest>(File.ReadAllText(args[1]), RunSpool.Json)
        ?? throw new ArgumentException("Missing request") : null;
    using var diagnosticLog = args[0] == "scan-diagnostic"
        ? new StreamWriter(new FileStream(Path.Combine(Directory.CreateDirectory(args[2]).FullName,
            $"{scanRequest!.RunId}.private-sdk.log"), FileMode.CreateNew, FileAccess.Write, FileShare.Read)) : null;
    using var adapter = new Naps2Backend(scanRequest?.DeviceId ?? (args[0] == "list-wia" ? "Wia:" : null));
    if (diagnosticLog != null) adapter.ConfigureDiagnostic(args[3], diagnosticLog);
    IScannerBackend backend = adapter;
    var devices = await backend.ListDevices();
    if (args[0] is "list" or "list-wia")
        Console.WriteLine(JsonSerializer.Serialize(new { backend = Naps2Backend.Describe(), devices }, RunSpool.Json));
    else if (args[0] == "caps" && args.Length == 2)
        Console.WriteLine(JsonSerializer.Serialize(new { backend = Naps2Backend.Describe(), device = devices.Single(d => d.Id == args[1]), capabilities = await backend.GetCapabilities(args[1]) }, RunSpool.Json));
    else if (scan)
    {
        var request = scanRequest!;
        var caps = await backend.GetCapabilities(request.DeviceId);
        await backend.Prepare(request);
        using var spool = new RunSpool(args[2], request, new { description = Naps2Backend.Describe(), capabilities = caps,
            diagnosticMode = diagnosticLog != null ? args[3] : null });
        using var monitor = new CancellationTokenSource();
        ConsoleCancelEventHandler handler = (_, e) => { e.Cancel = true; backend.Cancel("operator Ctrl+C"); };
        Console.CancelKeyPress += handler;
        var watch = Task.Run(async () =>
        {
            while (!monitor.IsCancellationRequested)
            {
                if (File.Exists(Path.Combine(spool.DirectoryPath, "stop.request"))) backend.RequestStop("operator stop file");
                if (File.Exists(Path.Combine(spool.DirectoryPath, "cancel.request"))) backend.Cancel("operator cancel file");
                await Task.Delay(100, monitor.Token);
            }
        });
        try { await backend.Start(spool); }
        finally
        {
            monitor.Cancel();
            try { await watch; } catch (OperationCanceledException) { }
            Console.CancelKeyPress -= handler;
        }
    }
    else throw new ArgumentException("Invalid command arguments");
}
catch (Exception error)
{
    Console.Error.WriteLine(JsonSerializer.Serialize(new { kind = "AgentError", error = Naps2Backend.SafeError(error) }, RunSpool.Json));
    Environment.ExitCode = 1;
}
