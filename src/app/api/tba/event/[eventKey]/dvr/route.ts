import { NextResponse } from "next/server";
import { calculateDvr, type SimpleMatch } from "@/lib/dvr";

const TBA_BASE_URL = "https://www.thebluealliance.com/api/v3";
const TBA_API_KEY =
  "2Ga0RatGjqIcznI0A3kP4vvuXB7wKiOrMTQekzrJi4oJym03vgGuvo6wnudkuybK";

export async function GET(
  _request: Request,
  context: { params: Promise<{ eventKey: string }> }
) {
  const { eventKey } = await context.params;
  if (!eventKey) {
    return NextResponse.json({ error: "Missing event key." }, { status: 400 });
  }

  const response = await fetch(`${TBA_BASE_URL}/event/${eventKey}/matches/simple`, {
    headers: { "X-TBA-Auth-Key": TBA_API_KEY },
    cache: "no-store",
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: `TBA request failed with status ${response.status}` },
      { status: response.status }
    );
  }

  const matches = (await response.json()) as SimpleMatch[];
  const dvr = calculateDvr(matches);

  return NextResponse.json({
    eventKey,
    ...dvr,
  });
}
