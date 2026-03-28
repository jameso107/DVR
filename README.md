# FRC DVR Dashboard

Simple Next.js app that pulls match data from The Blue Alliance and calculates
Defensive Value Rating (DVR) for an event in near real time.

## DVR model in this app

Per completed qualification match, the app creates two alliance-score
observations and fits:

`y = alpha + sum(O_i over scoring alliance) - sum(G_j over defending alliance) + error`

- `O_i` = offensive coefficient (OPR-like contribution)
- `G_j` = defensive coefficient (DVR basis)
- Ridge regression with 5-fold cross-validation chooses lambda from
  `[0.01, 0.1, 0.3, 1, 3, 10, 30, 100]`
- Defensive coefficients are mean-centered so event-average defense is `0`

## Local setup

1. Install deps:
   - `npm install`
2. Run:
   - `npm run dev`
3. Open [http://localhost:3000](http://localhost:3000)

## Vercel deployment

1. Push this repo to GitHub.
2. Import the repo in Vercel.
3. Deploy.
