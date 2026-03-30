"use client";

import { useCallback, useEffect, useState } from "react";

type DvrResult = {
  teamKey: string;
  teamNumber: number;
  dvr: number;
  dvrRank: number;
};

type DvrResponse = {
  year: number;
  events: number;
  matches: number;
  lambda: number;
  observations: number;
  teams: number;
  results: DvrResult[];
  cached?: boolean;
};

const CURRENT_YEAR = new Date().getFullYear();

function formatMetric(value: number): string {
  return value.toFixed(2);
}

export default function Home() {
  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [dvrData, setDvrData] = useState<DvrResponse | null>(null);
  const [loadingDvr, setLoadingDvr] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDvr = useCallback(async (forceRefresh = false) => {
    setLoadingDvr(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (forceRefresh) {
        params.set("refresh", "1");
      }
      const query = params.toString();
      const response = await fetch(`/api/tba/year/${year}/dvr${query ? `?${query}` : ""}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as DvrResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load worldwide DVR.");
      }
      setDvrData(data);
    } catch (err) {
      setDvrData(null);
      setError(err instanceof Error ? err.message : "Unknown worldwide DVR error.");
    } finally {
      setLoadingDvr(false);
    }
  }, [year]);

  useEffect(() => {
    loadDvr(false);
  }, [loadDvr]);

  return (
    <main className="page">
      <section className="card">
        <h1>FRC Worldwide DVR Leaderboard</h1>
        <p className="subtle">
          Defensive Value Rating (DVR) uses a joint offense-defense ridge model
          on all completed matches in the selected year, aggregated across all
          events.
        </p>

        <div className="controls">
          <label>
            Year
            <input
              type="number"
              min={1992}
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
            />
          </label>
          <button
            type="button"
            onClick={() => loadDvr(true)}
            disabled={loadingDvr}
          >
            {loadingDvr ? "Refreshing..." : "Manual refresh"}
          </button>
        </div>

        {error ? <p className="error">{error}</p> : null}

        {dvrData ? (
          <>
            <div className="metrics">
              <span>year: {dvrData.year}</span>
              <span>events: {dvrData.events}</span>
              <span>matches: {dvrData.matches}</span>
              <span>lambda: {dvrData.lambda}</span>
              <span>observations: {dvrData.observations}</span>
              <span>teams: {dvrData.teams}</span>
              <span>cache: {dvrData.cached ? "hit" : "recomputed"}</span>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Team</th>
                    <th>DVR</th>
                  </tr>
                </thead>
                <tbody>
                  {dvrData.results.map((team) => (
                    <tr key={team.teamKey}>
                      <td>{team.dvrRank}</td>
                      <td>
                        <a
                          href={`https://www.thebluealliance.com/team/${team.teamNumber}/${year}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {team.teamNumber}
                        </a>
                      </td>
                      <td>{formatMetric(team.dvr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="subtle">
            {loadingDvr
              ? "Calculating worldwide DVR from all TBA match data..."
              : "Click Manual refresh to calculate the worldwide leaderboard."}
          </p>
        )}
      </section>
    </main>
  );
}
