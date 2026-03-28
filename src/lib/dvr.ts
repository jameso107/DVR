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
  opr: number;
  dvr: number;
  dpr: number;
  dvrRank: number;
};

type Observation = {
  score: number;
  scoringAlliance: string[];
  defendingAlliance: string[];
};

type RidgeFit = {
  coefficients: number[];
  predictions: number[];
};

const LAMBDA_GRID = [0.01, 0.1, 0.3, 1, 3, 10, 30, 100];

function teamNumberFromKey(teamKey: string): number {
  const numericPart = teamKey.replace("frc", "");
  const parsed = Number.parseInt(numericPart, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dot(a: number[], b: number[]): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    total += a[i] * b[i];
  }
  return total;
}

function buildObservations(matches: SimpleMatch[]): Observation[] {
  const observations: Observation[] = [];

  for (const match of matches) {
    if (match.comp_level !== "qm") {
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

function buildFeatureRows(
  observations: Observation[],
  teams: string[],
  teamIndex: Map<string, number>
): { x: number[][]; y: number[] } {
  const featureCount = 1 + 2 * teams.length;
  const x: number[][] = [];
  const y: number[] = [];

  for (const obs of observations) {
    const row = new Array<number>(featureCount).fill(0);
    row[0] = 1; // Intercept

    for (const team of obs.scoringAlliance) {
      const idx = teamIndex.get(team);
      if (idx !== undefined) {
        row[1 + idx] += 1;
      }
    }

    for (const team of obs.defendingAlliance) {
      const idx = teamIndex.get(team);
      if (idx !== undefined) {
        row[1 + teams.length + idx] -= 1;
      }
    }

    x.push(row);
    y.push(obs.score);
  }

  return { x, y };
}

function solveLinearSystem(a: number[][], b: number[]): number[] {
  const n = a.length;
  const aug = a.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[pivot][col])) {
        pivot = row;
      }
    }

    if (Math.abs(aug[pivot][col]) < 1e-9) {
      continue;
    }

    if (pivot !== col) {
      [aug[col], aug[pivot]] = [aug[pivot], aug[col]];
    }

    const pivotValue = aug[col][col];
    for (let j = col; j <= n; j += 1) {
      aug[col][j] /= pivotValue;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) {
        continue;
      }
      const factor = aug[row][col];
      if (factor === 0) {
        continue;
      }
      for (let j = col; j <= n; j += 1) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  return aug.map((row) => row[n]);
}

function fitRidge(x: number[][], y: number[], lambda: number): RidgeFit {
  const featureCount = x[0]?.length ?? 0;
  const xtx = Array.from({ length: featureCount }, () =>
    new Array<number>(featureCount).fill(0)
  );
  const xty = new Array<number>(featureCount).fill(0);

  for (let rowIndex = 0; rowIndex < x.length; rowIndex += 1) {
    const row = x[rowIndex];
    const target = y[rowIndex];

    for (let i = 0; i < featureCount; i += 1) {
      xty[i] += row[i] * target;
      for (let j = 0; j < featureCount; j += 1) {
        xtx[i][j] += row[i] * row[j];
      }
    }
  }

  for (let i = 1; i < featureCount; i += 1) {
    xtx[i][i] += lambda;
  }

  const coefficients = solveLinearSystem(xtx, xty);
  const predictions = x.map((row) => dot(row, coefficients));
  return { coefficients, predictions };
}

function seededShuffle<T>(values: T[]): T[] {
  const shuffled = [...values];
  let seed = 123456789;

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    seed = (1103515245 * seed + 12345) % 2147483648;
    const j = seed % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

function mse(actual: number[], predicted: number[]): number {
  if (actual.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  let total = 0;
  for (let i = 0; i < actual.length; i += 1) {
    const error = actual[i] - predicted[i];
    total += error * error;
  }
  return total / actual.length;
}

function pickBestLambda(x: number[][], y: number[]): number {
  if (x.length < 10) {
    return 1;
  }

  const indices = seededShuffle(Array.from({ length: x.length }, (_, i) => i));
  const folds = Math.min(5, x.length);
  const foldBuckets: number[][] = Array.from({ length: folds }, () => []);
  for (let i = 0; i < indices.length; i += 1) {
    foldBuckets[i % folds].push(indices[i]);
  }

  let bestLambda = LAMBDA_GRID[0];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const lambda of LAMBDA_GRID) {
    let foldError = 0;

    for (const validationIdx of foldBuckets) {
      const trainMask = new Set(validationIdx);
      const trainX: number[][] = [];
      const trainY: number[] = [];
      const valX: number[][] = [];
      const valY: number[] = [];

      for (let i = 0; i < x.length; i += 1) {
        if (trainMask.has(i)) {
          valX.push(x[i]);
          valY.push(y[i]);
        } else {
          trainX.push(x[i]);
          trainY.push(y[i]);
        }
      }

      if (trainX.length === 0 || valX.length === 0) {
        continue;
      }

      const fit = fitRidge(trainX, trainY, lambda);
      const predicted = valX.map((row) => dot(row, fit.coefficients));
      foldError += mse(valY, predicted);
    }

    const avgError = foldError / folds;
    if (avgError < bestScore) {
      bestScore = avgError;
      bestLambda = lambda;
    }
  }

  return bestLambda;
}

export function calculateDvr(matches: SimpleMatch[]): {
  lambda: number;
  observations: number;
  teams: number;
  results: TeamDvrResult[];
} {
  const observations = buildObservations(matches);
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

  const { x, y } = buildFeatureRows(observations, teams, teamIndex);
  const lambda = pickBestLambda(x, y);
  const fit = fitRidge(x, y, lambda);

  const offensiveOffset = 1;
  const defensiveOffset = 1 + teams.length;
  const rawDefense = teams.map(
    (_, idx) => fit.coefficients[defensiveOffset + idx] ?? 0
  );
  const defenseMean =
    rawDefense.reduce((sum, value) => sum + value, 0) / rawDefense.length;

  const results = teams.map((team, idx) => {
    const opr = fit.coefficients[offensiveOffset + idx] ?? 0;
    const dvr = rawDefense[idx] - defenseMean;
    return {
      teamKey: team,
      teamNumber: teamNumberFromKey(team),
      opr,
      dvr,
      dpr: -dvr,
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
