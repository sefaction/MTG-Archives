# Windows scanner connection — delivery slice 1

Tracking [#501](https://github.com/sefaction/MTG-Archives/issues/501) and agent
[#311](https://github.com/sefaction/MTG-Archives/issues/311). This branch depends
on individually unapproved scanner qualification PR #474, reconciled with main
e560f15. Recognition #463 remains separate/open. No production change.

## Implemented

The Scan cards page can issue a ten-minute, one-use connection code and list or
revoke the current account's Windows helpers. A helper claims that code with a
client-generated stable ID and secret saved before HTTP; repeated claims after
lost acknowledgments return the same enrollment, not another credential.
Concurrent claims are fenced by a serializable transaction.

The server stores only token/code hashes and a password-credential fingerprint.
Revocation, expiry, inactive user/player and changed passwords deny access. An
agent never receives Admin Mode. The browser list excludes hashes, credentials
and pairing codes; only the explicit enrollment response contains its code.
Pulse messages accept a bounded, strict device schema, reject injected commands
or owner fields, and report online only for a recent authenticated heartbeat.
Chunked request bodies are capped before accumulating excess bytes.

The .NET Windows helper uses direct NAPS2.Sdk discovery through the existing
generic backend. It makes outbound requests only, validates TLS normally, refuses
redirects and verifies the response's protocol and agent identity. HTTP requires
an explicit local-test option and a loopback origin. The site origin and local
mode are bound to the credential in Windows Credential Manager; editing the
nonsecret connection JSON cannot redirect it to another site. Its data is under
the current user's LocalAppData/MTGArchives/ScannerAgent, outside the executable
and Docker images. No Windows driver/binary is copied into the Linux image.

## Local developer use

This is not a distributable installer or a completed scanner workflow. The
existing manufacturer's driver and a compatible Windows .NET Desktop runtime
are needed. Build the locked existing SDK project as in the qualification README.
Open Scan cards → Connect a scanner → Create connection code, then:

```powershell
dotnet tools/scanner-agent/bin/Release/net8.0-windows/Mtg.ScannerAgent.dll connect https://YOUR-SITE/
# Paste the code at the prompt. It is not passed on the process command line.
dotnet tools/scanner-agent/bin/Release/net8.0-windows/Mtg.ScannerAgent.dll serve CONNECTION-ID
```

For local Docker, connect to `http://127.0.0.1:13001/` with `--local`. `report`
sends one real discovery report and exits; it never scans. `forget` removes only
that helper's local credential/configuration. Disconnect on the website to
revoke server access. No autostart, installer, updater or inbound listener is
configured by this slice. The existing source-only packaging/license gates remain
in [SCANNER_NAPS2_LICENSES.md](SCANNER_NAPS2_LICENSES.md).

## Verified local connection, September 29

PR #502 at `d365994` passed all four exact-head CI jobs. The local cumulative
web image contains the parent backend and this connection slice alongside the
separately unapproved recognition/review work; it does not merge any of them.
The running image's 471-file source manifest matched the cumulative source.

The real compiled Windows helper claimed a browser-issued code and reported
three actual SDK sources: Plustek PS286 Pro-TWAIN, A4 ADF2 Scanner(K7B) (WIA),
and EPSON ET-5800 Series (WIA). The browser showed Online and those sources.
Desktop and 320-pixel screenshots were inspected without page-wide overflow.
Website disconnection made a subsequent real helper report fail. The test took
18.6 seconds, created no acquisition session or Inventory, and removed its
owned account, pairing, helper, authentication and Windows credential fixtures.
No scan command or motor operation occurred. Enumerating a source is not proof
of physical connection or feeding safety.

The disposable database suite separately exercised concurrent claim replay,
lost acknowledgment, ownership and credential lifecycle rejection; core and
Windows build/credential guards passed. Original recognition workers, models,
reference storage and production remained unchanged.

## Remaining end-to-end goal

This slice does **not** implement START/STOP commands, native image transfer,
incremental uploads, device/run leases or server-restore fencing. It cannot yet
scan from the website. Those are the next slice, followed by the Windows package,
real PS286 local scan/review and fi-7160 physical qualification after arrival.
Enumeration and synthetic transport tests do not prove a device is connected,
safe to feed, precisely stoppable or reliable for duplex pairing.

Reuse existing durable acquisition photo/artifact/jobs and manual review/commit.
Retain excess/unassigned artifacts and source evidence. Never use the observed
PS286 cancellation failure as an exact capacity stop; initially support explicitly
operator-loaded simplex batches with truthful unsupported stop/drain status.
Production rollout and every individual merge still require separate approval.
