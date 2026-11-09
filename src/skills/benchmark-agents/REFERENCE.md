# Benchmark agents — principles & templates

## Source notes (Kun Chen, agentic engineering workflow)

Video: https://www.youtube.com/watch?v=iQyg-KypKAA  
Captions via `yt-captions-mini-ai` (`iQyg-KypKAA.en`).

### Claims to encode as methodology (not brand loyalty)

1. **Popular ≠ good.** A high-star skills pack can use **more tokens** and produce **worse** end-to-end build results when measured on a real bench (“Program Bench” style: build programs end-to-end).
2. **No proof, no install.** Do not trust skills that claim magic gains without published rigorous evaluation.
3. **Same tasks only.** Tool comparisons (e.g. GitHub MCP vs CLI vs agent-optimized “axi”) must use **identical tasks**; report **token cost**, **latency**, and **success rate**.
4. **Turns matter.** Browser/tool stacks that finish equal work in **fewer turns** and **fewer tokens** win for agent mileage.
5. **Agent ergonomics is a design variable.** Token-efficient tool output formats (vs chatty JSON) can save large fractions of tokens—treat format as a condition.
6. **Long loops need metrics.** Overnight/agent loops fit **verifiable** objectives (coverage, load time, e2e failures) or trusted judgment tasks with **caps** (tokens/iterations/stop condition)—not unbounded quota burn.
7. **Isolation.** Parallel agents need separate worktrees so trials do not corrupt each other (same isolation rule for bench trials).

Timestamp orientation in that talk: tools/skills evaluation ~19:00–24:30; long-loop metrics ~34:00–36:30; parallel worktrees later. The link `t=2438s` is near the “first mate” multi-agent orchestration section—use for orchestration design, not as the bench methodology core.

## Metric catalog

| Metric | Definition | Notes |
|--------|------------|--------|
| `success` | 0/1 against a machine-checkable predicate | Prefer tests/CLI exit over LLM-as-judge alone |
| `tokens_in` / `tokens_out` | Provider usage | Sum tool-call payloads if available |
| `turns` | Model steps / tool rounds | Lower is better for equal success |
| `wall_ms` | End-to-end wall clock | Include setup if condition-specific |
| `cost_usd` | From token price table | Pin prices in plan file |
| `human_rating` | Optional 1–5 | Label as subjective |

## Minimal plan schema (JSON)

```json
{
  "suite_id": "github-access-2026-08",
  "n_trials": 3,
  "budget_caps": { "max_tokens_per_trial": 200000, "max_wall_ms": 600000, "max_cost_usd": 5 },
  "isolation": "temp-worktree",
  "tasks": [
    {
      "id": "list-open-prs",
      "prompt": "List open PRs for this repo with number and title only.",
      "success_predicate": "exit0_and_contains_pr_numbers",
      "timeout_ms": 120000
    }
  ],
  "conditions": [
    { "id": "gh-cli", "env": { "GITHUB_TOOL": "cli" } },
    { "id": "gh-mcp", "env": { "GITHUB_TOOL": "mcp" } }
  ],
  "metrics": ["success", "tokens_in", "tokens_out", "turns", "wall_ms", "cost_usd"]
}
```

## Trial row (JSONL)

```json
{"suite_id":"…","task_id":"…","condition_id":"…","trial":1,"success":1,"tokens_in":1200,"tokens_out":400,"turns":4,"wall_ms":15000,"cost_usd":0.02,"error":null,"artifact":"artifacts/…"}
```

## Report skeleton

1. Question & decision  
2. Methodology (tasks, conditions, n, isolation, versions)  
3. Results table  
4. Interpretation (paired wins/losses)  
5. Limitations  
6. Next experiment  

## Anti-patterns

- Different prompts per condition  
- n=1 “vibes win”  
- Measuring only demos that always succeed  
- No cost cap  
- Dirty shared working tree across conditions  
- Declaring a skill better because of stars or anecdotes alone  
