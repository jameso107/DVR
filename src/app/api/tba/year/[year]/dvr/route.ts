import { NextResponse } from "next/server";
import { calculateDvr, type SimpleMatch } from "@/lib/dvr";

const TBA_BASE_URL = "https://www.thebluealliance.com/api/v3";
const TBA_API_KEY =
  "2Ga0RatGjqIcznI0A3kP4vvuXB7wKiOrMTQekzrJi4oJym03vgGuvo6wnudkuybK";
const MAX_PARALLEL_REQUESTS = 20;
const EVENT_MATCH_CACHE_TTL_MS = 1000 * 60 * 30;
const YEAR_RESULT_CACHE_TTL_MS = 1000 * 60 * 10;

type YearDvrResponse = {
  year: number;
  events: number;
  matches: number;
  observations: number;
  teams: number;
  lambda: number;
  results: ReturnType<typeof calculateDvr>["results"];
};

type CacheValue<T> = {
  value: T;
  expiresAt: number;
};

declare global {
  var __dvrYearCache: Map<number, CacheValue<YearDvrResponse>> | undefined;
  var __dvrEventMatchesCache: Map<string, CacheValue<SimpleMatch[]>> | undefined;
  var __dvrYearInFlight: Map<number, Promise<YearDvrResponse>> | undefined;
}

const yearCache = globalThis.__dvrYearCache ?? new Map<number, CacheValue<YearDvrResponse>>();
const eventMatchesCache =
  globalThis.__dvrEventMatchesCache ?? new Map<string, CacheValue<SimpleMatch[]>>();
const inFlightByYear = globalThis.__dvrYearInFlight ?? new Map<number, Promise<YearDvrResponse>>();

globalThis.__dvrYearCache = yearCache;
globalThis.__dvrEventMatchesCache = eventMatchesCache;
globalThis.__dvrYearInFlight = inFlightByYear;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { "X-TBA-Auth-Key": TBA_API_KEY },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`TBA request failed (${response.status}) for ${url}`);
  }

  return (await response.json()) as T;
}

async function fetchEventMatches(eventKey: string): Promise<SimpleMatch[]> {
  const cached = eventMatchesCache.get(eventKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const matches = await fetchJson<SimpleMatch[]>(
    `${TBA_BASE_URL}/event/${eventKey}/matches/simple`
  );
  eventMatchesCache.set(eventKey, {
    value: matches,
    expiresAt: Date.now() + EVENT_MATCH_CACHE_TTL_MS,
  });
  return matches;
}

async function fetchAllEventMatches(eventKeys: string[]): Promise<SimpleMatch[]> {
  const allMatches: SimpleMatch[] = [];

  for (let i = 0; i < eventKeys.length; i += MAX_PARALLEL_REQUESTS) {
    const batch = eventKeys.slice(i, i + MAX_PARALLEL_REQUESTS);
    const settled = await Promise.allSettled(batch.map((eventKey) => fetchEventMatches(eventKey)));

    for (const result of settled) {
      if (result.status === "fulfilled") {
        allMatches.push(...result.value);
      }
    }
  }

  return allMatches;
}

async function computeYearLeaderboard(year: number): Promise<YearDvrResponse> {
  const eventKeys = await fetchJson<string[]>(`${TBA_BASE_URL}/events/${year}/keys`);
  const matches = await fetchAllEventMatches(eventKeys);
  const dvr = calculateDvr(matches, { includeOnlyQualification: false });

  return {
    year,
    events: eventKeys.length,
    matches: matches.length,
    ...dvr,
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ year: string }> }
) {
  const { year: yearParam } = await context.params;
  const year = Number.parseInt(yearParam, 10);

  if (!Number.isFinite(year) || year < 1992) {
    return NextResponse.json(
      { error: "Provide a valid FRC year in the URL." },
      { status: 400 }
    );
  }

  try {
    const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
    const cached = yearCache.get(year);

    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({ ...cached.value, cached: true });
    }

    const existingInFlight = inFlightByYear.get(year);
    const resultPromise = existingInFlight ?? computeYearLeaderboard(year);

    if (!existingInFlight) {
      inFlightByYear.set(year, resultPromise);
    }

    const result = await resultPromise;
    yearCache.set(year, {
      value: result,
      expiresAt: Date.now() + YEAR_RESULT_CACHE_TTL_MS,
    });
    inFlightByYear.delete(year);

    return NextResponse.json({ ...result, cached: false });
  } catch (error) {
    inFlightByYear.delete(year);
    const message =
      error instanceof Error ? error.message : "Failed to build worldwide DVR leaderboard.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
