# @bonjinnorenka/copilot-usage

Analyze GitHub Copilot CLI session usage and costs.

## Maintenance Status

> [!IMPORTANT]
> **This project is no longer maintained as of November 17, 2026.**
> No further feature updates, bug fixes, compatibility fixes, or security patches are planned.

GitHub replaced premium request-based billing with token-based usage billing on June 1, 2026. Some existing annual Copilot Pro / Pro+ subscriptions remained on the legacy premium request model, but the premium request efficiency metric calculated by this tool does **not** represent costs under the current usage-based billing model. See [GitHub's billing documentation](https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/what-changed-with-billing) for details.

For GitHub Copilot CLI token usage and estimated cost analysis, use [ccusage](https://github.com/ccusage/ccusage), which now supports Copilot CLI:

```bash
npx ccusage@latest copilot daily
npx ccusage@latest copilot session
```

This repository remains publicly available under the MIT license for historical reference and forking. The documentation below describes the original functionality and is not current billing guidance.

---

## Historical Documentation

## Features

- Parses `~/.copilot/session-state` to extract per-session model metrics
- Fetches model pricing data from [litellm](https://github.com/BerriAI/litellm) (cached for 24h)
- Calculates token costs for input, cache read/write, and output tokens
- Shows premium request counts and cost efficiency ratios
- Displays results in a responsive table with totals

## Usage

```bash
npx @bonjinnorenka/copilot-usage
```

Or install globally and run:

```bash
npm install -g @bonjinnorenka/copilot-usage
copilot-usage
```

Local development:

```bash
npm install
npm start
```

### Options

| Option       | Description                            |
| ------------ | -------------------------------------- |
| `--full-id`  | Show full session IDs (default: 8 chars) |
| `--path DIR` | Specify custom session-state directory |

## Example Output

```
┌──────────┬───────────┬──────────┬─────────────┬─────────────┬────────────┬─────────────┬──────────────┬────────────────┬───────┐
│Session ID│   Model   │Timestamp │ Input Token  │ CacheWrite  │ CacheRead  │Output Token │ Total Token   │ Total Pricing   │Cost   │
├──────────┼───────────┼──────────┼─────────────┼─────────────┼────────────┼─────────────┼──────────────┼────────────────┼───────┤
│a1b2c3d…  │gpt-4o     │04/18 10:30│      1,234  │         0   │       567  │       890   │      2,691   │        $0.0123 │    5  │
└──────────┴───────────┴──────────┴─────────────┴─────────────┴────────────┴─────────────┴──────────────┴────────────────┴───────┘
```

## How It Works

1. Reads session directories under `~/.copilot/session-state`
2. Parses `events.jsonl` from each session to extract `session.start` and `session.shutdown` events
3. Computes per-model token usage and estimates cost using litellm pricing data
4. Calculates **Efficiency** = `Total Pricing / (Cost × $0.04)` — higher means more value per premium request

## Acknowledgments

Inspired by [ccusage](https://github.com/ryoppippi/ccusage).

## License

MIT
