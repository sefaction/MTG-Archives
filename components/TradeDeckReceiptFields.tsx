"use client";

import { useState } from "react";

type Choice = { bundleId: string; visibility: "" | "PRIVATE" | "PUBLIC"; folderId: string; tagIds: string[] };

export function TradeDeckReceiptFields({ decks, folders, tags }: {
  decks: { bundleId: string; name: string }[];
  folders: { id: string; name: string }[];
  tags: { id: string; name: string }[];
}) {
  const [choices, setChoices] = useState<Choice[]>(() => decks.map(deck => ({
    bundleId: deck.bundleId, visibility: "", folderId: "", tagIds: [],
  })));
  const update = (bundleId: string, patch: Partial<Choice>) => setChoices(current =>
    current.map(choice => choice.bundleId === bundleId ? { ...choice, ...patch } : choice));
  return <div className="w-full min-w-0 space-y-3">
    <input type="hidden" name="deckReceiptsJson" value={JSON.stringify(choices)} />
    {decks.length ? <p className="text-sm text-zinc-400">Choose visibility and organization for each received deck. Its committed copies stay together; the sender&apos;s folders and tags do not transfer.</p> : null}
    {decks.map(deck => {
      const choice = choices.find(value => value.bundleId === deck.bundleId)!;
      return <fieldset key={deck.bundleId} className="min-w-0 space-y-2 rounded border border-zinc-700 p-3">
        <legend className="max-w-full break-words px-1 text-sm font-medium">Receive {deck.name}</legend>
        <label className="block text-sm">{deck.name} visibility
          <select required value={choice.visibility} onChange={event => update(deck.bundleId, { visibility: event.target.value as Choice["visibility"] })}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2">
            <option value="" disabled>Choose and confirm visibility</option>
            <option value="PRIVATE">Private</option><option value="PUBLIC">Public</option>
          </select>
        </label>
        <label className="block text-sm">{deck.name} folder
          <select value={choice.folderId} onChange={event => update(deck.bundleId, { folderId: event.target.value })}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2">
            <option value="">No folder</option>
            {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </label>
        {tags.length ? <div className="space-y-1"><p className="text-xs text-zinc-400">Your tags (optional)</p>
          <div className="flex flex-wrap gap-2">{tags.map(tag => <label key={tag.id} className="flex items-start gap-1 text-sm">
            <input type="checkbox" checked={choice.tagIds.includes(tag.id)} onChange={event => update(deck.bundleId, {
              tagIds: event.target.checked ? [...choice.tagIds, tag.id] : choice.tagIds.filter(id => id !== tag.id),
            })} />{tag.name}
          </label>)}</div>
        </div> : null}
      </fieldset>;
    })}
  </div>;
}
