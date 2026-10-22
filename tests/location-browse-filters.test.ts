import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  locationBrowseHref,
  type LocationBrowseParams,
} from "../lib/location-browser";

type Element = { type: string; props: Record<string, any> };

// Execute the real client component with only React scheduling, router and JSX
// replaced. No browser, database, application server or fixture is started.
function mount(initial: LocationBrowseParams, deck = false) {
  const slots: any[] = [];
  const effects: Array<() => void> = [];
  const timers = new Map<number, () => void>();
  const listeners = new Map<string, () => void>();
  const navigations: string[] = [];
  let cursor = 0;
  let dirty = false;
  let timerId = 0;
  let params = initial;
  let tree: Element;
  const window = {
    location: { search: new URL(locationBrowseHref(initial), "http://local").search },
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const react = {
    useState(initialValue: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initialValue;
      return [slots[index], (value: any) => {
        slots[index] = typeof value === "function" ? value(slots[index]) : value;
        dirty = true;
      }];
    },
    useRef(value: any) {
      const index = cursor++;
      return (slots[index] ??= { current: value });
    },
    useEffect(fn: () => (() => void) | undefined, deps: any[]) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        effects.push(() => {
          previous?.cleanup?.();
          slots[index] = { deps, cleanup: fn() };
        });
      }
    },
    useTransition: () => [false, (fn: () => void) => fn()],
  };
  const exports: Record<string, any> = {};
  const jsx = (type: string, props: Element["props"]) => ({ type, props });
  const source = readFileSync("components/LocationBrowseFilters.tsx", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(compiled, {
    exports, window, URLSearchParams,
    setTimeout: (fn: () => void) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
    require(name: string) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "next/navigation") return {
        useRouter: () => ({ replace: (href: string) => navigations.push(href) }),
      };
      if (name === "@/lib/location-browser") return { locationBrowseHref };
      if (name === "./filterStyles") return { cn: (...values: string[]) => values.join(" ") };
      throw new Error(`Unexpected component dependency: ${name}`);
    },
  });
  function render() {
    do {
      dirty = false;
      cursor = 0;
      tree = exports.LocationBrowseFilters({ params, deck, types: ["Box", "Binder"] });
      effects.splice(0).forEach((effect) => effect());
    } while (dirty);
  }
  function find(name: string): Element {
    function visit(node: any): Element | undefined {
      if (!node || typeof node !== "object") return;
      if (node.props?.name === name) return node;
      for (const child of [node.props?.children].flat(Infinity)) {
        const result = visit(child);
        if (result) return result;
      }
    }
    const node = visit(tree);
    assert.ok(node, `Missing control ${name}`);
    return node;
  }
  render();
  return {
    navigations,
    find,
    change(name: string, value: string) {
      find(name).props.onChange({ target: { value } });
      render();
    },
    event(name: string, handler: string, value = "") {
      find(name).props[handler]({ currentTarget: { value } });
      render();
    },
    flush() {
      for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
      render();
    },
    receive(next: LocationBrowseParams) {
      params = next;
      window.location.search = new URL(locationBrowseHref(next), "http://local").search;
      render();
    },
    beginHistory(next: LocationBrowseParams) {
      window.location.search = new URL(locationBrowseHref(next), "http://local").search;
      listeners.get("popstate")?.();
      render();
    },
    history(next: LocationBrowseParams) {
      this.beginHistory(next);
      this.receive(next);
    },
    submit() { tree.props.onSubmit({ preventDefault() {} }); this.flush(); },
  };
}

function lastParams(ui: ReturnType<typeof mount>) {
  return new URL(ui.navigations.at(-1)!, "http://local").searchParams;
}

test("search follows external navigation into and out of a storage branch", () => {
  const ui = mount({});
  ui.receive({ parent: "vault", selected: "box", page: "2" });
  ui.change("q", "sleeves");
  ui.flush();
  assert.equal(lastParams(ui).get("parent"), "vault");
  assert.equal(lastParams(ui).get("selected"), null);
  assert.equal(lastParams(ui).get("page"), null);
  ui.receive({});
  assert.equal(ui.find("q").props.value, "");
  ui.change("q", "binder");
  ui.flush();
  assert.equal(lastParams(ui).get("parent"), null);
});

test("the main Locations link clears a mounted branch and its visible filters", () => {
  const ui = mount({ parent: "vault", q: "old", type: "Binder", status: "inactive", space: "empty" });
  ui.receive({});
  for (const name of ["q", "type", "status", "space"]) {
    assert.equal(ui.find(name).props.value, "");
  }
  ui.change("q", "new");
  ui.flush();
  assert.equal(lastParams(ui).get("parent"), null);
  assert.equal(lastParams(ui).get("type"), null);
  assert.equal(lastParams(ui).get("status"), null);
  assert.equal(lastParams(ui).get("space"), null);
});

test("history restores all filter controls and the next action's full URL scope", () => {
  const ui = mount({ q: "old", parent: "old-branch", type: "Box", space: "full", status: "active" });
  ui.history({ q: "new", parent: "new-branch", type: "Binder", space: "empty", status: "inactive" });
  for (const [name, value] of Object.entries({ q: "new", type: "Binder", space: "empty", status: "inactive" })) {
    assert.equal(ui.find(name).props.value, value);
  }
  ui.change("space", "available");
  ui.flush();
  for (const [key, value] of Object.entries({ q: "new", parent: "new-branch", type: "Binder", space: "available", status: "inactive" })) {
    assert.equal(lastParams(ui).get(key), value);
  }
});

test("an earlier own response preserves newer typing and rapidly composed filters", () => {
  const ui = mount({ parent: "vault" });
  ui.change("q", "box");
  ui.flush();
  ui.change("q", "boxes");
  ui.change("type", "Box");
  ui.receive({ parent: "vault", q: "box" });
  assert.equal(ui.find("q").props.value, "boxes");
  ui.change("status", "active");
  ui.flush();
  assert.equal(lastParams(ui).get("q"), "boxes");
  assert.equal(lastParams(ui).get("type"), "Box");
  assert.equal(lastParams(ui).get("status"), "active");
});

test("external navigation cancels a pending search instead of restoring its stale branch", () => {
  const ui = mount({ parent: "old-branch" });
  ui.change("q", "pending");
  ui.receive({ parent: "new-branch" });
  ui.flush();
  assert.equal(ui.navigations.length, 0);
  ui.submit();
  assert.equal(lastParams(ui).get("parent"), "new-branch");
  assert.equal(lastParams(ui).get("q"), null);
});

test("IME input waits for composition end and deck history retains the deck view", () => {
  const ui = mount({ view: "decks", q: "old" }, true);
  ui.history({ view: "decks", q: "deck" });
  ui.event("q", "onCompositionStart");
  ui.change("q", "新");
  ui.flush();
  assert.equal(ui.navigations.length, 0);
  ui.event("q", "onCompositionEnd", "新");
  ui.flush();
  assert.equal(lastParams(ui).get("q"), "新");
  assert.equal(lastParams(ui).get("view"), "decks");
});

test("history cancels a queued edit and can restore unfiltered storage", () => {
  const ui = mount({ parent: "vault", type: "Box" });
  ui.change("q", "pending");
  ui.history({});
  ui.flush();
  assert.equal(ui.navigations.length, 0);
  ui.change("status", "active");
  ui.flush();
  assert.equal(lastParams(ui).get("parent"), null);
  assert.equal(lastParams(ui).get("type"), null);
  assert.equal(lastParams(ui).get("q"), null);
});

test("typing and filter edits after popstate survive delayed history props", () => {
  const ui = mount({ q: "box", parent: "vault", type: "Box" });
  const restored = { parent: "shelf", type: "Binder" };
  ui.beginHistory(restored);
  assert.equal(ui.find("q").props.value, "");
  assert.equal(ui.find("type").props.value, "Binder");
  ui.change("q", "binder");
  ui.change("space", "available");
  ui.receive(restored);
  assert.equal(ui.find("q").props.value, "binder");
  assert.equal(ui.find("space").props.value, "available");
  ui.flush();
  for (const [key, value] of Object.entries({ q: "binder", parent: "shelf", type: "Binder", space: "available" })) {
    assert.equal(lastParams(ui).get(key), value);
  }
  ui.receive({ parent: "other-branch" });
  assert.equal(ui.find("q").props.value, "");
  assert.equal(ui.find("space").props.value, "");
});

test("delayed history props preserve active IME composition", () => {
  const ui = mount({ view: "decks", q: "old" }, true);
  const restored = { view: "decks", parent: "shelf" };
  ui.beginHistory(restored);
  ui.event("q", "onCompositionStart");
  ui.change("q", "新");
  ui.receive(restored);
  assert.equal(ui.find("q").props.value, "新");
  ui.change("q", "新しい");
  ui.flush();
  assert.equal(ui.navigations.length, 0);
  ui.event("q", "onCompositionEnd", "新しい");
  ui.flush();
  assert.equal(lastParams(ui).get("q"), "新しい");
  assert.equal(lastParams(ui).get("parent"), "shelf");
  assert.equal(lastParams(ui).get("view"), "decks");
});
