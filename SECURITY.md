# Security Policy

## Scope

**Personal Trading Intelligence** is a **local-first, read-only** analytics tool.
Security-relevant design decisions:

- The dashboard server binds to `127.0.0.1` only — it is never exposed to the network (`npm start` and the desktop shell both enforce loopback).
- The MT5 connector is **read-only**: it opens no orders, closes no positions, and changes no account settings. Enabling "Algo Trading" in MetaTrader is NOT required.
- No telemetry, no cloud services, no external APIs. All data stays on your machine.
- The connector authenticates to the sync API with a per-launch random token (`X-PTI-Token`); mutating browser requests are same-origin enforced.
- The desktop database lives OUTSIDE the program folder (`%APPDATA%\TradingIntelligence\data`): reinstall, update and uninstall never touch it; full deletion requires explicit confirmation.
- The connector's `--login/--password` (optional manual mode) is never echoed or logged; logs carry MT5 error codes only.

## Reporting a Vulnerability

Please open a [GitHub Security Advisory](https://github.com/realmohamarezaa-netizen/personal-trading-intelligence/security/advisories/new)
or a regular issue describing the problem. Do not include real account data in reports.

## Data Handling

| Data | Location | Leaving your machine? |
|---|---|---|
| Trades, snapshots, strategies, cashflows | Desktop: `%APPDATA%\TradingIntelligence\data\custom.db` · Dev: `db/custom.db` | Never |
| MT5 sync logs | Desktop: `%APPDATA%\TradingIntelligence\logs` · Dev: `logs/` | Never |
| Sync token (per launch) | `%APPDATA%\TradingIntelligence\data\sync-token` | Never |
| Dashboard traffic | `127.0.0.1` loopback | Never |
