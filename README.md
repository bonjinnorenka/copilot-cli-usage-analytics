# copilot-cli-usage-analytics

Analyze GitHub Copilot CLI session usage and costs.

## Features

- Parses `~/.copilot/session-state` to extract per-session model metrics
- Fetches model pricing data from [litellm](https://github.com/BerriAI/litellm) (cached for 24h)
- Calculates token costs for input, cache read/write, and output tokens
- Shows premium request counts and cost efficiency ratios
- Displays results in a responsive table with totals

## Usage

```bash
npx copilot-cli-usage-analytics
```

Or install and run:

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

## License

MIT