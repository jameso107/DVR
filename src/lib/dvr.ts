export type SimpleMatch = {
  comp_level: string;
  alliances: {
    red: { team_keys: string[]; score: number };
    blue: { team_keys: string[]; score: number };
  };
};

export type TeamDvrResult = {
  teamKey: string;
  teamNumber: number;
  dvr: number;
  dvrRank: number;
};

type Observation = {
  score: number;
  scoringAlliance: string[];
  defendingAlliance: string[];
};

type IndexedObservation = {
  score: number;
  scoring: number[];
  defending: number[];
};

const DEFAULT_LAMBDA = 1;

function teamNumberFromKey(teamKey: string): number {
  const numericPart = teamKey.replace("frc", "");
  const parsed = Number.parseInt(numericPart, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildObservations(
  matches: SimpleMatch[],
  includeOnlyQualification: boolean
): Observation[] {
  const observations: Observation[] = [];

  for (const match of matches) {
    if (includeOnlyQualification && match.comp_level !== "qm") {
      continue;
    }

    const red = match.alliances.red;
    const blue = match.alliances.blue;
    if (!red || !blue) {
      continue;
    }

    if (red.score < 0 || blue.score < 0) {
      continue;
    }

    observations.push({
      score: red.score,
      scoringAlliance: red.team_keys,
      defendingAlliance: blue.team_keys,
    });
    observations.push({
      score: blue.score,
      scoringAlliance: blue.team_keys,
      defendingAlliance: red.team_keys,
    });
  }

  return observations;
}

function buildIndexedObservations(
  observations: Observation[],
  teamIndex: Map<string, number>
): IndexedObservation[] {
  return observations.map((obs) => ({
    score: obs.score,
    scoring: obs.scoringAlliance
      .map((team) => teamIndex.get(team))
      .filter((idx): idx is number => idx !== undefined),
    defending: obs.defendingAlliance
      .map((team) => teamIndex.get(team))
      .filter((idx): idx is number => idx !== undefined),
  }));
}

function predictObservation(
  obs: IndexedObservation,
  intercept: number,
  offense: Float64Array,
  defense: Float64Array
): number {
  let value = intercept;
  for (const idx of obs.scoring) {
    value += offense[idx];
  }
  for (const idx of obs.defending) {
    value -= defense[idx];
  }
  return value;
}

function fitRidgeSparse(
  observations: IndexedObservation[],
  teamCount: number,
  lambda: number
): { intercept: number; offense: Float64Array; defense: Float64Array } {
  const offense = new Float64Array(teamCount);
  const defense = new Float64Array(teamCount);
  const gradientsOffense = new Float64Array(teamCount);
  const gradientsDefense = new Float64Array(teamCount);

  const rowCount = observations.length;
  const rowScale = 2 / Math.max(rowCount, 1);

  let intercept = 0;
  let learningRate = rowCount > 100_000 ? 0.03 : 0.06;
  const epochs = rowCount > 100_000 ? 12 : rowCount > 30_000 ? 16 : 24;

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    gradientsOffense.fill(0);
    gradientsDefense.fill(0);
    let gradIntercept = 0;

    for (const obs of observations) {
      const prediction = predictObservation(obs, intercept, offense, defense);
      const error = prediction - obs.score;
      gradIntercept += error;
      for (const idx of obs.scoring) {
        gradientsOffense[idx] += error;
      }
      for (const idx of obs.defending) {
        gradientsDefense[idx] -= error;
      }
    }

    intercept -= learningRate * rowScale * gradIntercept;

    for (let teamIdx = 0; teamIdx < teamCount; teamIdx += 1) {
      const offGrad =
        rowScale * gradientsOffense[teamIdx] + (2 * lambda * offense[teamIdx]) / rowCount;
      const defGrad =
        rowScale * gradientsDefense[teamIdx] + (2 * lambda * defense[teamIdx]) / rowCount;
      offense[teamIdx] -= learningRate * offGrad;
      defense[teamIdx] -= learningRate * defGrad;
    }

    learningRate *= 0.9;
  }

  return { intercept, offense, defense };
}

export function calculateDvr(
  matches: SimpleMatch[],
  options?: { includeOnlyQualification?: boolean }
): {
  lambda: number;
  observations: number;
  teams: number;
  results: TeamDvrResult[];
} {
  const includeOnlyQualification = options?.includeOnlyQualification ?? true;
  const observations = buildObservations(matches, includeOnlyQualification);
  const teamSet = new Set<string>();

  for (const obs of observations) {
    for (const team of obs.scoringAlliance) {
      teamSet.add(team);
    }
    for (const team of obs.defendingAlliance) {
      teamSet.add(team);
    }
  }

  const teams = Array.from(teamSet).sort(
    (a, b) => teamNumberFromKey(a) - teamNumberFromKey(b)
  );

  if (teams.length === 0 || observations.length === 0) {
    return {
      lambda: 1,
      observations: observations.length,
      teams: teams.length,
      results: [],
    };
  }

  const teamIndex = new Map<string, number>();
  teams.forEach((team, idx) => {
    teamIndex.set(team, idx);
  });

  const indexedObservations = buildIndexedObservations(observations, teamIndex);
  const lambda = DEFAULT_LAMBDA;
  const fit = fitRidgeSparse(indexedObservations, teams.length, lambda);

  const rawDefense = teams.map((_, idx) => fit.defense[idx] ?? 0);
  const defenseMean =
    rawDefense.reduce((sum, value) => sum + value, 0) / rawDefense.length;

  const results = teams.map((team, idx) => {
    const dvr = rawDefense[idx] - defenseMean;
    return {
      teamKey: team,
      teamNumber: teamNumberFromKey(team),
      dvr,
      dvrRank: 0,
    };
  });

  results.sort((a, b) => b.dvr - a.dvr);
  results.forEach((result, idx) => {
    result.dvrRank = idx + 1;
  });

  return {
    lambda,
    observations: observations.length,
    teams: teams.length,
    results,
  };
}
