# Security Policy

## Scope

**Personal Trading Intelligence** is a **local-first, read-only** analytics tool.
Security-relevant design decisions:

- The dashboard server binds to `127.0.0.1` only — it is never exposed to the network.
- The MT5 connector is **read-only**: it opens no orders, closes no positions, and changes no account settings.
- No telemetry, no cloud services, no external APIs. All data stays in `db/custom.db` on your machine.
- The desktop shell (Electron) launches a local Next.js server and a local Python connector; it opens no remote endpoints.

## Reporting a Vulnerability

Please open a [GitHub Security Advisory](https://github.com/realmohamadarezaa-netizen/personal-trading-intelligence/security/advisories/new)
or a regular issue describing the problem. Do not include real account data in reports.

## Data Handling

| Data | Location | Leaving your machine? |
|---|---|---|
| Trades, equity snapshots, strategies | `db/custom.db` (SQLite) | Never |
| MT5 sync logs | `logs/` | Never |
| Dashboard traffic | `127.0.0.1` loopback | Never |
