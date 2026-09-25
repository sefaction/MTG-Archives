import Link from "next/link";

export function LeagueNav({
  leagueId,
  active,
}: {
  leagueId?: string;
  active?: "season" | "decks" | "stats";
}) {
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
          <Link
            className="app-nav-link"
            aria-current={active === "season" ? "page" : undefined}
            href={`/league/${leagueId}`}
          >
            Standings
          </Link>
          <Link
            className="app-nav-link"
            aria-current={active === "decks" ? "page" : undefined}
            href={`/league/${leagueId}/decks`}
          >
            Decks
          </Link>
          <Link
            className="app-nav-link"
            aria-current={active === "stats" ? "page" : undefined}
            href={`/league/${leagueId}/stats`}
          >
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
