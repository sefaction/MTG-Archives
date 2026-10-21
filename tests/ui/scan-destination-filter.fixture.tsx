import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { StorageDestinationPicker } from "../../components/StorageDestinationPicker";
import type { StorageLocation } from "../../lib/storage-sections";

const locations: StorageLocation[] = [
  { id: "partial", name: "One free space", capacity: 10, quantity: 8, pendingQuantity: 1, sections: [
    { name: "Free", capacity: 10, quantity: 8, pendingQuantity: 1 },
    { name: "Full", capacity: 2, quantity: 2 },
    { name: "Unknown", capacity: null, quantity: 0 },
  ] },
  { id: "full", name: "Full parent", capacity: 10, quantity: 9, pendingQuantity: 1,
    sections: [{ name: "Empty child", capacity: 10, quantity: 0 }] },
  { id: "over", name: "Over parent", capacity: 1, quantity: 2, sections: [] },
  { id: "unknown", name: "Unknown capacity", capacity: null, quantity: 0, sections: [] },
  { id: "vault", name: "Section configured vault", capacity: null, sections: [
    { name: "Free vault section", capacity: 85, quantity: 84 },
    { name: "Full vault section", capacity: 85, quantity: 85 },
  ] },
];

function Fixture() {
  const [values, setValues] = useState(locations);
  const [id, setId] = useState("");
  const [section, setSection] = useState("");
  const [changes, setChanges] = useState(0);
  const [scan, setScan] = useState(true);
  return <main style={{ padding: 12 }}>
    <StorageDestinationPicker key={String(scan)} locations={values} locationId={id} section={section}
      incomingQuantity={10} scanCapacityFilter={scan}
      onLocationChange={value => { setId(value); setChanges(n => n + 1); }}
      onSectionChange={value => { setSection(value); setChanges(n => n + 1); }} />
    <output aria-label="Selection">{id}/{section}</output>
    <output aria-label="Selection changes">{changes}</output>
    <button onClick={() => setValues(values.map(value => ({ ...value, pendingQuantity: 100,
      sections: value.sections.map(section => ({ ...section, pendingQuantity: 100 })) })))}>Capacity becomes full</button>
    <button onClick={() => setScan(false)}>Ordinary picker</button>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
