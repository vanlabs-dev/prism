# Prism

> See every outcome.

![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-blue)
![License MIT](https://img.shields.io/badge/license-MIT-green)
![Synth API](https://img.shields.io/badge/Synth-SN50-purple)

**Personal risk intelligence for crypto and equity traders, powered by Synth probability forecasts.**

Built for the [Synth Predictive Intelligence Hackathon](https://www.synthdata.co/) (Feb-Mar 2026) in the **Best Prediction Markets Tool** category.

---

## Features

### Probability Explorer
Ask any price question and get an instant probability answer backed by Synth's ensemble forecasts from 289 timepoints across 9 percentile levels.

- "What's the probability BTC stays between $85k-$92k in 24h?"
- "What are the chances ETH drops below $3,000?"
- Interactive 3D probability cone showing how uncertainty widens over time

### Position Risk Scanner
Map your leveraged position onto the Synth probability distribution to see your real risk.

- Liquidation probability computed from forecast percentiles
- P&L distribution across 9 outcome scenarios
- Take-profit and stop-loss probability estimates
- Composite risk score (0-100) with plain-English factors

## Architecture

```
Synth API (SN50)
    |
    v
FastAPI Server (/api/*)           <-- Probability queries, position risk
    |
    v
ProbabilityEngine                 <-- Percentile interpolation + cone generation
PositionRiskAnalyzer              <-- Liquidation, P&L, risk scoring
    |
    v
React + Three.js Dashboard       <-- 3D probability cone, Explorer, Scanner
```

**Supported assets:** BTC, ETH, SOL, XAU, SPY, NVDA, GOOGL, TSLA, AAPL

## Quick Start

### Backend

```bash
git clone https://github.com/vanlabs-dev/prism.git
cd prism

python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -e .

cp .env.example .env
# Edit .env with your SYNTH_API_KEY

# Start the API server
python -m backend.api.run
# API available at http://localhost:8000
# Docs at http://localhost:8000/docs
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# Dashboard at http://localhost:5173
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check + Synth connectivity |
| GET | `/api/assets` | Supported assets with current prices |
| POST | `/api/probability` | Probability above/below/between with cone |
| POST | `/api/position-risk` | Full position risk analysis |
| GET | `/api/cone/{asset}` | Probability cone for visualization |

## Deploy AlphaLog (VPS)

AlphaLog continuously records Synth API predictions every hour, building a historical dataset.

```bash
git clone https://github.com/vanlabs-dev/prism.git
cd prism
python -m venv .venv
source .venv/bin/activate
pip install -e .
cp .env.example .env
# Edit .env with your SYNTH_API_KEY

# Test single collection
python -m backend.collectors.runner --once

# Run continuously (use screen/tmux/systemd)
python -m backend.collectors.runner

# Custom interval (seconds)
python -m backend.collectors.runner --interval 1800
```

Data is saved to `data/snapshots/YYYY-MM-DD/` as JSON files. Logs are written to `data/logs/alphalog.log`.

## Tech Stack

- **Backend:** Python 3.11, FastAPI, httpx, NumPy, SciPy
- **Frontend:** React, TypeScript, Vite, Three.js, Recharts
- **Data:** Supabase (cloud), local JSON snapshots
- **Infrastructure:** VPS (AlphaLog), Vercel (dashboard)

## Powered By

[Synth](https://www.synthdata.co/) — Ensemble probabilistic forecasts from [Bittensor Subnet 50](https://github.com/mode-network/synth-subnet)

## License

MIT — see [LICENSE](LICENSE) for details.
