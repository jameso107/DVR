import { NextResponse } from "next/server";

type TbaEvent = {
  key: string;
  name: string;
  event_code: string;
  event_type_string: string;
  start_date: string;
};

const TBA_BASE_URL = "https://www.thebluealliance.com/api/v3";
const TBA_API_KEY =
  "2Ga0RatGjqIcznI0A3kP4vvuXB7wKiOrMTQekzrJi4oJym03vgGuvo6wnudkuybK";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get("year");
  const year = Number.parseInt(yearParam ?? "", 10);

  if (!Number.isFinite(year) || year < 1992) {
    return NextResponse.json(
      { error: "Provide a valid FRC year query parameter." },
      { status: 400 }
    );
  }

  const response = await fetch(`${TBA_BASE_URL}/events/${year}/simple`, {
    headers: { "X-TBA-Auth-Key": TBA_API_KEY },
    next: { revalidate: 60 * 10 },
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: `TBA request failed with status ${response.status}` },
      { status: response.status }
    );
  }

  const events = (await response.json()) as TbaEvent[];
  const normalized = events
    .map((event) => ({
      key: event.key,
      name: event.name,
      code: event.event_code,
      type: event.event_type_string,
      startDate: event.start_date,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ events: normalized });
}
