import { closeSync, openSync, readSync, statSync } from "node:fs";
import type { NativeFailureObserver } from "./acquisition-native-failure";

const MAX_BYTES = 4096;
const eventNames = ["low", "high", "max", "oom", "oom_kill", "oom_group_kill"] as const;
type EventName = typeof eventNames[number];
type Events = Readonly<Record<EventName, number | null>>;
export type NativeMemorySample = Readonly<{
  events: Events;
  currentBytes: number;
  maxBytes: number | "max";
  peakBytes: number;
  swapCurrentBytes: number;
  swapMaxBytes: number | "max";
  swapPeakBytes: number;
}>;
type UnavailableReason = "PLATFORM" | "CGROUP_SCOPE" | "READ_OR_FORMAT";
export type NativeMemoryCapture = Readonly<
  {status: "available"; sample: NativeMemorySample; identity: string} |
  {status: "unavailable"; reason: UnavailableReason}
>;
export type NativeMemoryWindow = Readonly<{
  scope: "self-cgroup-native-child-lifetime";
  status: "available" | "unavailable" | "counter-reset" | "scope-changed";
  before: NativeMemorySample | null;
  after: NativeMemorySample | null;
  unavailableReason: UnavailableReason | null;
  eventsDelta: Events | null;
}>;

function count(text: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw Error("Invalid memory counter");
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw Error("Invalid memory counter");
  return value;
}
export function parseNativeMemoryEvents(text: string): Events {
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) throw Error("Invalid memory counters");
  const values = Object.fromEntries(eventNames.map(key => [key, null])) as Record<EventName, number | null>;
  for (const line of text.trim().split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (!eventNames.includes(parts[0] as EventName)) continue; // Future kernel counters are not projected.
    const key = parts[0] as EventName;
    if (parts.length !== 2 || values[key] !== null) throw Error("Invalid memory counters");
    values[key] = count(parts[1]);
  }
  for (const key of eventNames.slice(0, 5)) if (values[key] === null) throw Error("Missing memory counter");
  return Object.freeze(values);
}
// Never accept caller-supplied paths or read exception text, process argv or environment.
function boundedRead(path: string): string {
  const fd = openSync(path, "r");
  try {
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = readSync(fd, bytes, length, bytes.length - length, null);
      if (!read) break;
      length += read;
    }
    if (length > MAX_BYTES) throw Error("Memory file too large");
    return bytes.subarray(0, length).toString("utf8");
  } finally { closeSync(fd); }
}
export function captureNativeMemory(): NativeMemoryCapture {
  if (process.platform !== "linux") return Object.freeze({status: "unavailable", reason: "PLATFORM"});
  try {
    // Only a namespaced cgroup root is accepted. On a host/non-root membership,
    // fixed root files could describe a different group, so report unavailable.
    if (boundedRead("/proc/self/cgroup").trim() !== "0::/")
      return Object.freeze({status: "unavailable", reason: "CGROUP_SCOPE"});
    const root = "/sys/fs/cgroup/";
    const identity = statSync(root, {bigint: true});
    const readCount = (name: string) => count(boundedRead(root + name).trim());
    const readLimit = (name: string) => {
      const text = boundedRead(root + name).trim();
      return text === "max" ? "max" as const : count(text);
    };
    const sample: NativeMemorySample = Object.freeze({
      events: parseNativeMemoryEvents(boundedRead(root + "memory.events")),
      currentBytes: readCount("memory.current"), maxBytes: readLimit("memory.max"),
      peakBytes: readCount("memory.peak"), swapCurrentBytes: readCount("memory.swap.current"),
      swapMaxBytes: readLimit("memory.swap.max"), swapPeakBytes: readCount("memory.swap.peak"),
    });
    return Object.freeze({status: "available", sample, identity: `${identity.dev}:${identity.ino}`});
  } catch { return Object.freeze({status: "unavailable", reason: "READ_OR_FORMAT"}); }
}
export function nativeMemoryWindow(before: NativeMemoryCapture, after: NativeMemoryCapture): NativeMemoryWindow {
  const base = {
    scope: "self-cgroup-native-child-lifetime" as const,
    before: before.status === "available" ? before.sample : null,
    after: after.status === "available" ? after.sample : null,
    unavailableReason: before.status === "unavailable" ? before.reason : after.status === "unavailable" ? after.reason : null,
    eventsDelta: null,
  };
  if (before.status !== "available" || after.status !== "available")
    return Object.freeze({...base, status: "unavailable"});
  if (before.identity !== after.identity) return Object.freeze({...base, status: "scope-changed"});
  const delta = {} as Record<EventName, number | null>;
  for (const key of eventNames) {
    const first = before.sample.events[key], last = after.sample.events[key];
    if ((first === null) !== (last === null)) return Object.freeze({...base, status: "scope-changed"});
    if (first !== null && last !== null && last < first) return Object.freeze({...base, status: "counter-reset"});
    delta[key] = first === null || last === null ? null : last - first;
  }
  return Object.freeze({...base, status: "available", eventsDelta: Object.freeze(delta)});
}
export function observeNativeMemoryWindow(observe?: NativeFailureObserver): NativeFailureObserver | undefined {
  if (!observe) return undefined;
  const before = captureNativeMemory();
  // Capture once per child generation, including preparation and idle exits.
  // The group can contain other processes. A delta never attributes a kill to this child.
  return failure => observe(Object.freeze({...failure, memory: nativeMemoryWindow(before, captureNativeMemory())}));
}
