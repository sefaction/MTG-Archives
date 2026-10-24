import copy
import importlib.util
import io
import json
import tempfile
import unittest
import xml.etree.ElementTree as ET
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("crash_evidence", Path(__file__).with_name("crash-event-evidence.py"))
tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tool)
AT = "2026-10-01T02:03:04.1234567Z"
NS = tool.NS


def event(provider="Application Error", event_id="1000", pid="0x2a", at=AT, computer="PRIVATE_HOST"):
    root = ET.Element(NS + "Event")
    system = ET.SubElement(root, NS + "System")
    ET.SubElement(system, NS + "Provider", Name=provider)
    ET.SubElement(system, NS + "EventID").text = event_id
    ET.SubElement(system, NS + "EventRecordID").text = "123"
    ET.SubElement(system, NS + "TimeCreated", SystemTime=at)
    ET.SubElement(system, NS + "Execution", ProcessID="999" if event_id == "1000" else pid)
    ET.SubElement(system, NS + "Channel").text = "Application"
    ET.SubElement(system, NS + "Computer").text = computer
    data = ET.SubElement(root, NS + "EventData")
    fields = {"AppName": "NAPS2.Worker.exe", "AppVersion": "8.3.0.0", "ModuleName": "ntdll.dll",
              "ModuleVersion": "10.0.22631.0", "ExceptionCode": "c0000005", "FaultingOffset": "000123ab",
              "ProcessId": pid, "ProcessCreationTime": "0x1da7c61490090be",
              "AppPath": r"C:\Users\PRIVATE_USER\NAPS2.Worker.exe",
              "ModulePath": r"C:\PRIVATE_DIRECTORY\ntdll.dll", "IntegratorReportId": "PRIVATE_REPORT"}
    if event_id == "1026":
        ET.SubElement(data, NS + "Data").text = "PRIVATE_MESSAGE\nPRIVATE_STACK\nApplication: NAPS2.Worker.exe"
    else:
        for name, value in fields.items():
            ET.SubElement(data, NS + "Data", Name=name).text = value
    return root


def field(root, name, value):
    root.find(NS + "EventData").find(f"{NS}Data[@Name='{name}']").text = value


def report(events, **kwargs):
    return tool.summarize(events, [], 42, tool.timestamp(AT), **kwargs)


class CrashEvidenceTests(unittest.TestCase):
    def test_fault_pid_is_not_reporting_service_pid_and_output_is_private(self):
        result = report([event(), event(".NET Runtime", "1026", "42")])
        self.assertEqual(result["status"], "one_matching_crash")
        self.assertEqual(result["crashes"][0]["faultProcessId"], 42)
        self.assertEqual(result["crashes"][0]["moduleName"], "ntdll.dll")
        self.assertEqual(result["crashes"][0]["timeUtc"], AT)
        self.assertEqual(len(result["runtimeEventsWithSameComputerAndPidInWindow"]), 1)
        self.assertNotIn("PRIVATE_", json.dumps(result))
        self.assertIn("root-cause", " ".join(result["limits"]))

    def test_no_match_for_wrong_application_fault_pid_provider_or_channel(self):
        for kind in ("application", "pid", "provider", "channel"):
            candidate = event()
            if kind == "application":
                field(candidate, "AppName", "Unrelated.exe")
            elif kind == "pid":
                field(candidate, "ProcessId", "999")
            elif kind == "provider":
                candidate.find(NS + "System/" + NS + "Provider").set("Name", "Other")
            else:
                candidate.find(NS + "System/" + NS + "Channel").text = "System"
            self.assertEqual(report([candidate])["status"], "no_matching_crash", kind)

    def test_runtime_association_requires_same_computer_pid_and_time(self):
        for candidate in (event(".NET Runtime", "1026", "43"),
                          event(".NET Runtime", "1026", computer="OTHER_HOST"),
                          event(".NET Runtime", "1026", at="2026-10-01T02:04:04Z")):
            self.assertEqual(report([event(), candidate])["runtimeEventsWithSameComputerAndPidInWindow"], [])

    def test_runtime_message_or_stack_cannot_supply_missing_native_module(self):
        result = report([event(".NET Runtime", "1026")])
        self.assertEqual(result["status"], "no_matching_crash")
        self.assertEqual(result["crashes"], [])
        self.assertEqual(result["runtimeEventsWithSameComputerAndPidInWindow"], [])

    def test_runtime_without_emitter_pid_is_disclosed_without_blocking_native_evidence(self):
        for pid in ("0", "", "PRIVATE_BAD_PID"):
            candidate = event(".NET Runtime", "1026", pid)
            result = report([event(), candidate])
            self.assertEqual(result["status"], "one_matching_crash")
            self.assertEqual(result["runtimeEventsWithSameComputerAndPidInWindow"], [])
            self.assertEqual(result["runtimeEventsInWindowWithoutUsableEmitterPid"], 1)
            self.assertNotIn("PRIVATE_", json.dumps(result))

    def test_multiple_crashes_including_duplicate_exports_remain_ambiguous(self):
        first = event()
        second = copy.deepcopy(first)
        field(second, "ModuleName", "kernelbase.dll")
        for candidates in ([first, second], [first, copy.deepcopy(first)]):
            result = report([*candidates, event(".NET Runtime", "1026")])
            self.assertEqual(result["status"], "ambiguous")
            self.assertEqual(len(result["crashes"]), 2)
            self.assertEqual(result["runtimeEventsWithSameComputerAndPidInWindow"], [])

    def test_paths_and_malformed_fields_are_not_exported(self):
        candidate = event()
        for name in ("ModuleName", "ModuleVersion", "ExceptionCode", "FaultingOffset", "ProcessCreationTime", "AppVersion"):
            field(candidate, name, r"C:\PRIVATE_FIELD\secret")
        result = report([candidate])
        self.assertNotIn("PRIVATE_", json.dumps(result))
        for name in ("moduleName", "moduleVersion", "exceptionCode", "faultingOffset", "processCreationTime", "applicationVersion"):
            self.assertIsNone(result["crashes"][0][name])

    def test_missing_identity_duplicate_fields_and_invalid_target_are_refused(self):
        candidate = event()
        candidate.find(NS + "System/" + NS + "Computer").text = ""
        with self.assertRaisesRegex(tool.EvidenceError, "MISSING_EVENT_IDENTITY"):
            report([candidate])
        candidate = event()
        ET.SubElement(candidate.find(NS + "EventData"), NS + "Data", Name="ProcessId").text = "43"
        with self.assertRaisesRegex(tool.EvidenceError, "DUPLICATE_EVENT_FIELD"):
            report([candidate])
        for value in ("0", "-1", "0x100000000", "PRIVATE_BAD_PID"):
            with self.assertRaisesRegex(tool.EvidenceError, "INVALID_PROCESS_ID"):
                tool.process_id(value)
        for value in ("2026-10-01T02:03:04", "PRIVATE_BAD_TIME", "2026-99-01T02:03:04Z", "2026-10-01T02:03:04+00:60"):
            with self.assertRaisesRegex(tool.EvidenceError, "INVALID_TIMESTAMP"):
                tool.timestamp(value)

    def test_explicit_offsets_and_window_boundaries(self):
        self.assertEqual(tool.timestamp("2026-09-30T21:03:04.1234567-05:00"), tool.timestamp(AT))
        self.assertEqual(report([event(at="2026-10-01T02:03:09.1234567Z")])["status"], "one_matching_crash")
        self.assertEqual(report([event(at="2026-10-01T02:03:09.1234577Z")])["status"], "no_matching_crash")
        with self.assertRaisesRegex(tool.EvidenceError, "INVALID_WINDOW"):
            report([], window=11)
        # A single 100 ns step outside the boundary must not be rounded in.
        self.assertEqual(report([event(at="2026-10-01T02:03:09.1234568Z")])["status"], "no_matching_crash")

    def test_utf8_utf16_single_and_collection_exports_have_bounded_private_receipts(self):
        with tempfile.TemporaryDirectory() as directory:
            for encoding in ("utf-8", "utf-16"):
                for collection in (False, True):
                    root = ET.Element("Events") if collection else event()
                    if collection:
                        root.extend([event(), event(".NET Runtime", "1026")])
                    data = ET.tostring(root, encoding="unicode").encode(encoding)
                    path = Path(directory) / "PRIVATE_INPUT.xml"
                    path.write_bytes(data)
                    events, receipts = tool.read_events([path])
                    self.assertEqual(len(events), 2 if collection else 1)
                    self.assertEqual(receipts, [{"sha256": tool.hashlib.sha256(data).hexdigest(), "bytes": len(data)}])
                    self.assertNotIn("PRIVATE_", json.dumps(receipts))

    def test_malformed_hostile_oversized_and_excess_event_inputs_fail_closed(self):
        for paths in ([], ["PRIVATE_INPUT"] * (tool.MAX_INPUTS + 1)):
            with self.assertRaisesRegex(tool.EvidenceError, "INVALID_INPUT_COUNT"):
                tool.read_events(paths)
        cases = [(b"<PRIVATE_BAD_XML", "INVALID_EVENT_XML"),
                 (b'<!DOCTYPE x [<!ENTITY secret "PRIVATE_SECRET">]><x>&secret;</x>', "XML_DECLARATIONS_NOT_ALLOWED"),
                 ("<!DOCTYPE x><x/>".encode("utf-16"), "XML_DECLARATIONS_NOT_ALLOWED"),
                 (b"<Other/>", "UNSUPPORTED_EVENT_XML"),
                 (b" " * (tool.MAX_BYTES + 1), "INPUT_TOO_LARGE")]
        root = ET.Element("Events")
        root.extend(event() for _ in range(tool.MAX_EVENTS + 1))
        cases.append((ET.tostring(root), "TOO_MANY_EVENTS"))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "PRIVATE_INPUT.xml"
            for data, code in cases:
                path.write_bytes(data)
                with self.assertRaisesRegex(tool.EvidenceError, code):
                    tool.read_events([path])
            path.write_bytes(b" " * (tool.MAX_BYTES // 2 + 1))
            # Aggregate input bound is independent of individual file length.
            valid = ET.tostring(event())
            path.write_bytes(valid + b" " * (tool.MAX_BYTES // 2))
            with self.assertRaisesRegex(tool.EvidenceError, "INPUT_TOO_LARGE"):
                tool.read_events([path, path])

    def test_cli_does_not_echo_parse_errors_paths_or_original_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "PRIVATE_INPUT.xml"
            path.write_text("<PRIVATE_PAYLOAD", encoding="utf-8")
            for target in (path, path.with_name("PRIVATE_MISSING.xml")):
                output, errors = io.StringIO(), io.StringIO()
                with redirect_stdout(output), redirect_stderr(errors):
                    code = tool.main([str(target), "--pid", "42", "--at", AT])
                self.assertEqual(code, 2)
                self.assertEqual(output.getvalue(), "")
                self.assertNotIn("PRIVATE_", errors.getvalue())
                self.assertIn(json.loads(errors.getvalue())["error"], ("INVALID_EVENT_XML", "INPUT_UNAVAILABLE"))

    def test_actual_cli_reads_private_export_and_only_prints_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "PRIVATE_INPUT.xml"
            path.write_bytes(ET.tostring(event()))
            output, errors = io.StringIO(), io.StringIO()
            with redirect_stdout(output), redirect_stderr(errors):
                code = tool.main([str(path), "--pid", "0x2a", "--at", AT])
            self.assertEqual(code, 0)
            self.assertEqual(errors.getvalue(), "")
            self.assertEqual(json.loads(output.getvalue())["status"], "one_matching_crash")
            self.assertNotIn("PRIVATE_", output.getvalue())


if __name__ == "__main__":
    unittest.main()
