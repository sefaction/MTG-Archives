using System.Net;

namespace Mtg.Scanner;

// Authentication rejection ends a saved connection; network outages remain retryable.
public sealed class ScannerConnectionRejected(HttpStatusCode status) : InvalidOperationException("Scanner connection is no longer authorized")
{
    public HttpStatusCode Status { get; } = status;
    public static bool IsPermanent(HttpStatusCode status) => status is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden;
}
