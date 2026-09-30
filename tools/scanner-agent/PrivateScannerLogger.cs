using Microsoft.Extensions.Logging;

namespace Mtg.Scanner;

// Native diagnostics can contain driver paths/identities. Only the explicit
// local diagnostic command writes this file; it never enters website exports.
internal sealed class PrivateScannerLogger(TextWriter output) : ILogger
{
    private readonly object gate = new();
    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
    public bool IsEnabled(LogLevel logLevel) => true;
    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state,
        Exception? exception, Func<TState, Exception?, string> formatter)
    {
        lock (gate) {
            output.WriteLine($"{DateTimeOffset.UtcNow:O} {logLevel}: {formatter(state, exception)}");
            if (exception != null) output.WriteLine(exception);
            output.Flush();
        }
    }
}
