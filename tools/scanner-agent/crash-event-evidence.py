"""Summarize existing Windows event XML; never query Windows or start a scanner."""

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

NS = "{http://schemas.microsoft.com/win/2004/08/events/event}"
MAX_BYTES = 4 * 1024 * 1024
MAX_EVENTS = 256
MAX_INPUTS = 16
APPLICATION = "NAPS2.Worker.exe"
EPOCH = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)
TICKS_PER_SECOND = 10_000_000


class EvidenceError(ValueError):
    """Only fixed, non-private messages may cross the CLI boundary."""


def timestamp(value):
    match = re.fullmatch(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)", value)
    if not match:
        raise EvidenceError("INVALID_TIMESTAMP")
    try:
        # Windows timestamps have seven fractional digits. Keep integer 100 ns
        # ticks instead of rounding through datetime microseconds or floats.
        whole = dt.datetime.fromisoformat(match[1] + match[3].replace("Z", "+00:00"))
        delta = whole.astimezone(dt.timezone.utc) - EPOCH
        return (delta.days * 86400 + delta.seconds) * TICKS_PER_SECOND + int((match[2] or "").ljust(7, "0"))
    except (ValueError, OverflowError):
        raise EvidenceError("INVALID_TIMESTAMP") from None


def timestamp_text(ticks):
    seconds, fraction = divmod(ticks, TICKS_PER_SECOND)
    return (EPOCH + dt.timedelta(seconds=seconds)).strftime("%Y-%m-%dT%H:%M:%S") + f".{fraction:07d}Z"


def process_id(value):
    try:
        if not re.fullmatch(r"(?:0[xX][0-9a-fA-F]{1,8}|[0-9]{1,10})", value):
            raise ValueError()
        result = int(value, 16 if value.lower().startswith("0x") else 10)
        if not 0 < result <= 0xFFFFFFFF:
            raise ValueError()
        return result
    except ValueError:
        raise EvidenceError("INVALID_PROCESS_ID") from None


def read_events(paths):
    if not 1 <= len(paths) <= MAX_INPUTS:
        raise EvidenceError("INVALID_INPUT_COUNT")
    events, inputs, total = [], [], 0
    for path in paths:
        try:
            # Bound bytes read even if an ordinary input file grows.
            with Path(path).open("rb") as stream:
                data = stream.read(MAX_BYTES + 1)
        except OSError:
            raise EvidenceError("INPUT_UNAVAILABLE") from None
        total += len(data)
        if total > MAX_BYTES:
            raise EvidenceError("INPUT_TOO_LARGE")
        try:
            encoding = "utf-16" if data.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
            xml = data.decode(encoding)
            if re.search(r"<!\s*(?:DOCTYPE|ENTITY)", xml, re.I):
                raise EvidenceError("XML_DECLARATIONS_NOT_ALLOWED")
            root = ET.fromstring(xml)
        except (UnicodeError, ET.ParseError, ValueError) as error:
            if isinstance(error, EvidenceError):
                raise
            raise EvidenceError("INVALID_EVENT_XML") from None
        if root.tag == NS + "Event":
            batch = [root]
        elif root.tag in ("Events", NS + "Events") and all(child.tag == NS + "Event" for child in root):
            batch = list(root)
        else:
            raise EvidenceError("UNSUPPORTED_EVENT_XML")
        events.extend(batch)
        if len(events) > MAX_EVENTS:
            raise EvidenceError("TOO_MANY_EVENTS")
        inputs.append({"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
    return events, inputs


def text_at(event, path):
    element = event.find("/".join(NS + part for part in path.split("/")))
    return element.text.strip() if element is not None and element.text else ""


def attribute_at(event, path, name):
    element = event.find("/".join(NS + part for part in path.split("/")))
    return element.get(name, "") if element is not None else ""


def safe_field(fields, name, pattern):
    value = fields.get(name, "")
    return value if re.fullmatch(pattern, value) else None


def summarize(events, inputs, pid, at, window=5):
    if not 0 <= window <= 10:
        raise EvidenceError("INVALID_WINDOW")
    crashes, runtimes, unidentifiable_runtimes = [], [], 0
    for event in events:
        if text_at(event, "System/Channel") != "Application":
            continue
        provider = attribute_at(event, "System/Provider", "Name")
        event_id = text_at(event, "System/EventID")
        if (provider, event_id) not in (("Application Error", "1000"), (".NET Runtime", "1026")):
            continue
        when = timestamp(attribute_at(event, "System/TimeCreated", "SystemTime"))
        if abs(when - at) > window * TICKS_PER_SECOND:
            continue
        computer = text_at(event, "System/Computer")
        record = text_at(event, "System/EventRecordID")
        if not computer or not re.fullmatch(r"[0-9]{1,20}", record):
            raise EvidenceError("MISSING_EVENT_IDENTITY")
        if event_id == "1026":
            # This is the event emitter PID, not an inferred PID from message text.
            try:
                emitter_pid = process_id(attribute_at(event, "System/Execution", "ProcessID"))
            except EvidenceError:
                unidentifiable_runtimes += 1
                continue
            if emitter_pid == pid:
                runtimes.append((computer, when, record))
            continue
        fields = {}
        for element in event.findall(NS + "EventData/" + NS + "Data"):
            name = element.get("Name", "")
            if name in fields:
                raise EvidenceError("DUPLICATE_EVENT_FIELD")
            fields[name] = element.text.strip() if element.text else ""
        if fields.get("AppName", "").casefold() != APPLICATION.casefold():
            continue
        # System/Execution can name the reporting service; use the fault PID.
        if process_id(fields.get("ProcessId", "")) != pid:
            continue
        summary = {
            "eventRecordId": record,
            "timeUtc": timestamp_text(when),
            "faultProcessId": pid,
            "application": APPLICATION,
            "applicationVersion": safe_field(fields, "AppVersion", r"[0-9]{1,10}(?:\.[0-9]{1,10}){1,3}"),
            "moduleName": safe_field(fields, "ModuleName", r"[A-Za-z0-9_. -]{1,120}\.(?:dll|DLL|exe|EXE|ds|DS)"),
            "moduleVersion": safe_field(fields, "ModuleVersion", r"[0-9]{1,10}(?:\.[0-9]{1,10}){1,3}"),
            "exceptionCode": safe_field(fields, "ExceptionCode", r"(?:0[xX])?[0-9a-fA-F]{8}"),
            "faultingOffset": safe_field(fields, "FaultingOffset", r"(?:0[xX])?[0-9a-fA-F]{1,16}"),
            "processCreationTime": safe_field(fields, "ProcessCreationTime", r"(?:0[xX])?[0-9a-fA-F]{1,16}"),
        }
        crashes.append((computer, summary))
    # Do not pick the nearest event or collapse duplicate exports into a diagnosis.
    unique = len(crashes) == 1
    runtime_matches = [
        {"eventRecordId": record, "timeUtc": timestamp_text(when), "eventEmitterProcessId": pid}
        for computer, when, record in runtimes if unique and computer == crashes[0][0]
    ]
    return {
        "version": 1,
        "status": "one_matching_crash" if unique else "ambiguous" if crashes else "no_matching_crash",
        "inputs": inputs,
        "target": {"application": APPLICATION, "processId": pid, "timeUtc": timestamp_text(at), "windowSeconds": window},
        "crashes": [summary for _, summary in crashes],
        "runtimeEventsWithSameComputerAndPidInWindow": runtime_matches,
        "runtimeEventsInWindowWithoutUsableEmitterPid": unidentifiable_runtimes,
        "limits": [
            "Event association is not root-cause attribution or proof against PID reuse.",
            "The fault module is not necessarily the cause; loaded DSM and binary identity remain unknown.",
            "Missing or rejected fields remain null; no paths, messages, stack traces or computer names are exported.",
            "No hardware, service, event collection, binary inspection or runtime configuration operation was performed.",
        ],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("xml", nargs="+", help="Existing private Event Viewer XML files (not EVTX)")
    parser.add_argument("--pid", required=True, help="Known crashed worker PID, decimal or 0x hexadecimal")
    parser.add_argument("--at", required=True, help="Known crash timestamp with explicit UTC offset")
    parser.add_argument("--window-seconds", type=int, default=5, choices=range(11))
    args = parser.parse_args(argv)
    try:
        pid, at = process_id(args.pid), timestamp(args.at)
        events, inputs = read_events(args.xml)
        print(json.dumps(summarize(events, inputs, pid, at, args.window_seconds), indent=2))
        return 0
    except EvidenceError as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
