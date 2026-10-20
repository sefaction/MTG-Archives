import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parserStream } from "stream-json";
import type { Token } from "stream-json/parser.js";
import { extractMtgjsonIdentifierMappings } from "./pricing-mtgjson";

type Card = { uuid?: string; scryfallId?: string; identifiers?: { scryfallId?: string } };
type Frame = { kind: "object" | "array"; path: string[]; key: string; index: number };
type Setter = (value: string) => void;

// Bound retained identity data, not the complete feed or ignored card text.
const MAX_TEXT = 64 * 1024;
const MAX_RETAINED_CHARS = 64 * 1024 * 1024;
const MAX_ENTRIES = 500_000;
const MAX_DEPTH = 128;
// Token slices can otherwise retain an entire decoded input chunk. UTF-16 copy
// also preserves unpaired surrogates, unlike an encode/decode through UTF-8.
const detached = (value: string) => Buffer.from(value, "utf16le").toString("utf16le");

/** Validate the entire JSON entity before returning any publishable mappings. */
export async function readMtgjsonIdentifierMappings(
  source: Readable,
  options: { signal?: AbortSignal } = {},
) {
  const root = new Map<string, Card | null>();
  const wrapped = new Map<string, Card | null>();
  const frames: Frame[] = [];
  let rootIsObject = false, hasDataObject = false, inKey = false;
  let key = "", text = "", setters: Setter[] = [], retainedChars = 0;
  function charge(chars: number) {
    retainedChars += chars;
    if (retainedChars > MAX_RETAINED_CHARS) throw new Error("Identifier projection exceeds retained-text limit.");
  }
  function entry(map: Map<string, Card | null>, name: string, object: boolean) {
    if (!map.has(name)) {
      if (map.size >= MAX_ENTRIES) throw new Error("Identifier projection exceeds entry limit.");
      charge(name.length);
    }
    map.set(detached(name), object ? {} : null);
  }
  function valuePath() {
    const parent = frames.at(-1);
    return parent ? [...parent.path, parent.kind === "array" ? String(parent.index) : parent.key] : [];
  }
  function finishValue() {
    const parent = frames.at(-1);
    if (parent?.kind === "array") parent.index++;
  }
  // Keep only the fields read by the existing extractor. Map insertion order plus
  // Object.fromEntries retains JSON.parse/Object.entries duplicate and key order.
  function beginValue(path: string[], kind: string): Setter[] {
    if (!path.length) rootIsObject = kind === "object";
    if (!rootIsObject) return [];
    if (path.length === 1) {
      entry(root, path[0], kind === "object");
      if (path[0] === "data") { hasDataObject = kind === "object"; wrapped.clear(); }
    }
    if (hasDataObject && path.length === 2 && path[0] === "data") entry(wrapped, path[1], kind === "object");
    const targets: Setter[] = [];
    function field(card: Card | null | undefined, suffix: string[]) {
      if (!card) return;
      if (suffix.length === 1) {
        const name = suffix[0];
        if (name === "identifiers") card.identifiers = kind === "object" ? {} : undefined;
        if (name === "uuid" || name === "scryfallId") {
          delete card[name];
          if (kind === "string") targets.push(value => { card[name] = value; });
        }
      } else if (suffix.length === 2 && suffix[0] === "identifiers" && suffix[1] === "scryfallId" && card.identifiers) {
        const identifiers = card.identifiers;
        delete identifiers.scryfallId;
        if (kind === "string") targets.push(value => { identifiers.scryfallId = value; });
      }
    }
    field(root.get(path[0]), path.slice(1));
    if (hasDataObject && path[0] === "data" && path.length >= 2) field(wrapped.get(path[1]), path.slice(2));
    return targets;
  }
  const consume = (token: Token) => {
    switch (token.name) {
      case "startKey": inKey = true; key = ""; break;
      case "endKey": frames.at(-1)!.key = key; inKey = false; break;
      case "stringChunk":
        if (inKey) {
          if (key.length + token.value.length > MAX_TEXT) throw new Error("Identifier feed key exceeds text limit.");
          key += token.value;
        } else if (setters.length) {
          if (text.length + token.value.length > MAX_TEXT) throw new Error("Identifier field exceeds text limit.");
          text += token.value;
        }
        break;
      case "startObject": case "startArray": {
        const path = valuePath(), kind = token.name === "startObject" ? "object" : "array";
        beginValue(path, kind);
        if (frames.length >= MAX_DEPTH) throw new Error("Identifier feed exceeds nesting limit.");
        frames.push({ kind, path, key: "", index: 0 });
        break;
      }
      case "endObject": case "endArray": frames.pop(); finishValue(); break;
      case "startString": setters = beginValue(valuePath(), "string"); text = ""; break;
      case "endString":
        if (setters.length) { charge(text.length * setters.length); const value = detached(text); for (const set of setters) set(value); }
        setters = []; text = ""; finishValue(); break;
      case "startNumber": beginValue(valuePath(), "number"); break;
      case "endNumber": finishValue(); break;
      case "nullValue": case "trueValue": case "falseValue": beginValue(valuePath(), "literal"); finishValue(); break;
    }
  };
  // No packed strings/keys/numbers: even an ignored giant scalar is never joined.
  await pipeline(source, parserStream({ packValues: false, streamValues: true }), new Writable({
    objectMode: true,
    write(token: Token, _encoding, done) {
      try { consume(token); done(); } catch (error) { done(error as Error); }
    },
  }), { signal: options.signal });
  if (!rootIsObject) return [];
  const projection = Object.fromEntries(hasDataObject ? wrapped : root);
  return extractMtgjsonIdentifierMappings(hasDataObject ? { data: projection } : projection);
}

export async function fetchMtgjsonIdentifierMappings(url: string, options: { signal?: AbortSignal } = {}) {
  const response = await fetch(url, { headers: { "user-agent": "MTG-Archives pricing-worker" }, signal: options.signal });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`MTGJSON identifier fetch failed with HTTP ${response.status} ${response.statusText}`);
  }
  if (!response.body) throw new Error("MTGJSON identifier response has no body.");
  return readMtgjsonIdentifierMappings(Readable.fromWeb(response.body as never), options);
}
