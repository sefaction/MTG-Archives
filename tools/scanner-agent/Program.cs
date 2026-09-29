using System.Text.Json;
using Mtg.Scanner;

try
{
    if (await ScannerConnection.Run(args)) return;
    if (args.Length == 0 || args[0] is not ("list" or "caps" or "scan"))
        throw new ArgumentException("Commands: list | caps <device-id> | scan <request.json> <private-spool-root>");
    using IScannerBackend backend = new Naps2Backend();
    var devices = await backend.ListDevices();
    if (args[0] == "list")
        Console.WriteLine(JsonSerializer.Serialize(new { backend = Naps2Backend.Describe(), devices }, RunSpool.Json));
    else if (args[0] == "caps" && args.Length == 2)
        Console.WriteLine(JsonSerializer.Serialize(new { backend = Naps2Backend.Describe(), device = devices.Single(d => d.Id == args[1]), capabilities = await backend.GetCapabilities(args[1]) }, RunSpool.Json));
    else if (args[0] == "scan" && args.Length == 3)
    {
        var request = JsonSerializer.Deserialize<ScanRequest>(File.ReadAllText(args[1]), RunSpool.Json)
            ?? throw new ArgumentException("Missing request");
        var caps = await backend.GetCapabilities(request.DeviceId);
        await backend.Prepare(request);
        using var spool = new RunSpool(args[2], request, new { description = Naps2Backend.Describe(), capabilities = caps });
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
