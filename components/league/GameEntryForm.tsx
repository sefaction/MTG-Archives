"use client";

import { useMemo, useState } from "react";

type MemberOption = {
  id: string;
  name: string;
  decks: { id: string; name: string; roundId: string }[];
};

type RoundOption = { id: string; name: string; monthNumber: number };

type Participant = {
  key: number;
  memberId: string;
  deckId: string;
  result: "WIN" | "LOSS" | "DRAW";
  finishPosition: string;
};

export function GameEntryForm({
  leagueId,
  members,
  rounds,
  action,
}: {
  leagueId: string;
  members: MemberOption[];
  rounds: RoundOption[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  const today = new Date();
  const currentRound = rounds.find(
    (round) => round.monthNumber === today.getMonth() + 1,
  );
  const initialRoundId = currentRound?.id || rounds[0]?.id || "";
  const [roundId, setRoundId] = useState(initialRoundId);
  const initialCount = Math.min(4, Math.max(2, members.length));
  const [nextKey, setNextKey] = useState(initialCount);
  const [participants, setParticipants] = useState<Participant[]>(() =>
    Array.from({ length: initialCount }, (_, index) => ({
      key: index,
      memberId: members[index]?.id || "",
      deckId:
        members[index]?.decks.find((deck) => deck.roundId === initialRoundId)
          ?.id || "",
      result: index === 0 ? "WIN" : "LOSS",
      finishPosition: String(index + 1),
    })),
  );
  const dateValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const memberMap = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );

  function update(key: number, patch: Partial<Participant>) {
    setParticipants((current) =>
      current.map((participant) =>
        participant.key === key ? { ...participant, ...patch } : participant,
      ),
    );
  }

  function setDraw() {
    setParticipants((current) =>
      current.map((participant) => ({
        ...participant,
        result: "DRAW",
        finishPosition: "",
      })),
    );
  }

  function resetPlacements() {
    setParticipants((current) =>
      current.map((participant, index) => ({
        ...participant,
        result: index === 0 ? "WIN" : "LOSS",
        finishPosition: String(index + 1),
      })),
    );
  }

  if (members.length < 2) {
    return (
      <p className="app-muted text-sm">
        Add at least two league players before recording a game.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="leagueId" value={leagueId} />
      <input
        type="hidden"
        name="participantCount"
        value={participants.length}
      />
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block app-muted">Monthly round</span>
          <select
            name="roundId"
            value={roundId}
            onChange={(event) => {
              const nextRoundId = event.target.value;
              setRoundId(nextRoundId);
              setParticipants((current) =>
                current.map((participant) => {
                  const member = memberMap.get(participant.memberId);
                  return {
                    ...participant,
                    deckId:
                      member?.decks.find((deck) => deck.roundId === nextRoundId)
                        ?.id || "",
                  };
                }),
              );
            }}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
          >
            {rounds.map((round) => (
              <option key={round.id} value={round.id}>
                {round.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block app-muted">Played on</span>
          <input
            name="playedAt"
            type="date"
            defaultValue={dateValue}
            required
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block app-muted">Notes</span>
          <input
            name="notes"
            maxLength={500}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
          />
        </label>
      </div>

      <div className="overflow-x-auto rounded border border-zinc-800">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr>
              <th className="p-2 text-left">Player</th>
              <th className="p-2 text-left">Submitted deck</th>
              <th className="p-2 text-left">Result</th>
              <th className="p-2 text-left">Finish</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {participants.map((participant, index) => {
              const member = memberMap.get(participant.memberId);
              return (
                <tr key={participant.key}>
                  <td className="p-2">
                    <select
                      name={`memberId_${index}`}
                      value={participant.memberId}
                      required
                      onChange={(event) => {
                        const nextMember = memberMap.get(event.target.value);
                        update(participant.key, {
                          memberId: event.target.value,
                          deckId:
                            nextMember?.decks.find(
                              (deck) => deck.roundId === roundId,
                            )?.id || "",
                        });
                      }}
                      className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2"
                    >
                      <option value="">Select player</option>
                      {members.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2">
                    <select
                      name={`deckId_${index}`}
                      value={participant.deckId}
                      required
                      onChange={(event) =>
                        update(participant.key, { deckId: event.target.value })
                      }
                      className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2"
                    >
                      <option value="">Select deck</option>
                      {(member?.decks || [])
                        .filter((deck) => deck.roundId === roundId)
                        .map((deck) => (
                        <option key={deck.id} value={deck.id}>
                          {deck.name}
                        </option>
                        ))}
                    </select>
                  </td>
                  <td className="p-2">
                    <select
                      name={`result_${index}`}
                      value={participant.result}
                      onChange={(event) =>
                        update(participant.key, {
                          result: event.target.value as Participant["result"],
                        })
                      }
                      className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2"
                    >
                      <option value="WIN">Win</option>
                      <option value="LOSS">Loss</option>
                      <option value="DRAW">Draw</option>
                    </select>
                  </td>
                  <td className="p-2">
                    <input
                      name={`finishPosition_${index}`}
                      value={participant.finishPosition}
                      onChange={(event) =>
                        update(participant.key, {
                          finishPosition: event.target.value,
                        })
                      }
                      type="number"
                      min={1}
                      max={participants.length}
                      className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-2"
                    />
                  </td>
                  <td className="p-2 text-right">
                    {participants.length > 2 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setParticipants((current) =>
                            current.filter(
                              (item) => item.key !== participant.key,
                            ),
                          )
                        }
                        className="text-sm text-red-300"
                      >
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        {participants.length < Math.min(8, members.length) ? (
          <button
            type="button"
            onClick={() => {
              const member = members.find(
                (item) => !participants.some((p) => p.memberId === item.id),
              );
              setParticipants((current) => [
                ...current,
                {
                  key: nextKey,
                  memberId: member?.id || "",
                  deckId:
                    member?.decks.find((deck) => deck.roundId === roundId)?.id ||
                    "",
                  result: "LOSS",
                  finishPosition: String(current.length + 1),
                },
              ]);
              setNextKey((value) => value + 1);
            }}
            className="rounded border border-zinc-700 px-3 py-2 text-sm"
          >
            Add player
          </button>
        ) : null}
        <button
          type="button"
          onClick={setDraw}
          className="rounded border border-zinc-700 px-3 py-2 text-sm"
        >
          Mark game drawn
        </button>
        <button
          type="button"
          onClick={resetPlacements}
          className="rounded border border-zinc-700 px-3 py-2 text-sm"
        >
          Reset elimination order
        </button>
        <button
          type="submit"
          className="rounded bg-cyan-700 px-4 py-2 font-semibold text-white hover:bg-cyan-600"
        >
          Record game and freeze decks
        </button>
      </div>
    </form>
  );
}
