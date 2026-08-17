import Link from "next/link";

export function LeagueNav({ leagueId }: { leagueId?: string }) {
  return (
    <nav
      className="app-nav mb-6 flex flex-wrap items-center gap-3"
      aria-label="Commander League"
    >
      <Link className="app-nav-brand" href="/league">
        Commander League
      </Link>
      {leagueId ? (
        <>
          <Link className="app-nav-link" href={`/league/${leagueId}`}>
            League dashboard
          </Link>
          <Link className="app-nav-link" href={`/league/${leagueId}/decks`}>
            Decks
          </Link>
          <Link className="app-nav-link" href={`/league/${leagueId}/stats`}>
            Stats
          </Link>
        </>
      ) : null}
      <Link className="app-nav-link" href="/dashboard">
        Return to MTG Archives
      </Link>
    </nav>
  );
}
