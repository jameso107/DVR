"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type EventOption = {
  key: string;
  name: string;
  code: string;
  type: string;
  startDate: string;
};

type DvrResult = {
  teamKey: string;
  teamNumber: number;
  dvr: number;
  dvrRank: number;
};

type DvrResponse = {
  eventKey: string;
  lambda: number;
  observations: number;
  teams: number;
  results: DvrResult[];
};

const CURRENT_YEAR = new Date().getFullYear();

function formatMetric(value: number): string {
  return value.toFixed(2);
}

export default function Home() {
  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<string>("");
  const [dvrData, setDvrData] = useState<DvrResponse | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingDvr, setLoadingDvr] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedEventMeta = useMemo(
    () => events.find((event) => event.key === selectedEvent),
    [events, selectedEvent]
  );

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    setError(null);

    try {
      const response = await fetch(`/api/tba/events?year=${year}`);
      const data = (await response.json()) as {
        events?: EventOption[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load events.");
      }

      const nextEvents = data.events ?? [];
      setEvents(nextEvents);
      setSelectedEvent((current) => {
        if (current && nextEvents.some((event) => event.key === current)) {
          return current;
        }
        return nextEvents[0]?.key ?? "";
      });
    } catch (err) {
      setEvents([]);
      setSelectedEvent("");
      setDvrData(null);
      setError(err instanceof Error ? err.message : "Unknown events error.");
    } finally {
      setLoadingEvents(false);
    }
  }, [year]);

  const loadDvr = useCallback(async (eventKey: string) => {
    if (!eventKey) {
      return;
    }
    setLoadingDvr(true);
    setError(null);

    try {
      const response = await fetch(`/api/tba/event/${eventKey}/dvr`);
      const data = (await response.json()) as DvrResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load DVR.");
      }
      setDvrData(data);
    } catch (err) {
      setDvrData(null);
      setError(err instanceof Error ? err.message : "Unknown DVR error.");
    } finally {
      setLoadingDvr(false);
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (!selectedEvent) {
      return;
    }

    loadDvr(selectedEvent);
    const timer = setInterval(() => {
      loadDvr(selectedEvent);
    }, 30_000);
    return () => clearInterval(timer);
  }, [selectedEvent, loadDvr]);

  return (
    <main className="page">
      <section className="card">
        <h1>FRC DVR Live Dashboard</h1>
        <p className="subtle">
          Defensive Value Rating (DVR) uses a joint offense-defense ridge model
          on qualification match scores and updates automatically every 30
          seconds for the selected event.
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
          <button type="button" onClick={loadEvents} disabled={loadingEvents}>
            {loadingEvents ? "Loading events..." : "Load events"}
          </button>
        </div>

        <div className="controls">
          <label className="full-width">
            Event
            <select
              value={selectedEvent}
              onChange={(event) => setSelectedEvent(event.target.value)}
              disabled={loadingEvents || events.length === 0}
            >
              {events.length === 0 ? (
                <option value="">No events found</option>
              ) : (
                events.map((event) => (
                  <option key={event.key} value={event.key}>
                    {event.name} ({event.key})
                  </option>
                ))
              )}
            </select>
          </label>
          <button
            type="button"
            onClick={() => loadDvr(selectedEvent)}
            disabled={!selectedEvent || loadingDvr}
          >
            {loadingDvr ? "Refreshing..." : "Refresh now"}
          </button>
        </div>

        {selectedEventMeta ? (
          <p className="subtle">
            {selectedEventMeta.type} | starts {selectedEventMeta.startDate}
          </p>
        ) : null}

        {error ? <p className="error">{error}</p> : null}

        {dvrData ? (
          <>
            <div className="metrics">
              <span>lambda: {dvrData.lambda}</span>
              <span>observations: {dvrData.observations}</span>
              <span>teams: {dvrData.teams}</span>
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
                          href={`https://www.thebluealliance.com/team/${team.teamNumber}/2026`}
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
              ? "Calculating DVR from TBA match data..."
              : "Select an event to calculate DVR."}
          </p>
        )}
      </section>
    </main>
  );
}
