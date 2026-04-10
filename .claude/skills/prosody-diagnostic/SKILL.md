---
name: prosody-diagnostic
description: Run the prosody pipeline diagnostic and summarize regressions against baseline archetypes. Use after changing src/lib/comprosody.ts, src/lib/prompts.ts, or scripts/prosody-pipeline-diagnostic.ts.
disable-model-invocation: true
---

# prosody-diagnostic

This skill runs `npm run diagnostic` and interprets its output as a regression report. The underlying script exits 0 even on regressions — you must parse output, not rely on the exit code.

## Steps

1. Run:

   ```bash
   npm run diagnostic
   ```

2. Capture stdout. The script prints structured sections covering:
   - **Lexical density precision** — content-word ratio across synthetic archetypes
   - **Energy scaling** — RMS + ×3 scaling, clamped to [0, 1]
   - **Prompt token budgets** — composed system prompt length
   - **Signal discrimination** — whether distinct archetypes produce distinct labels
   - **Boundary sensitivity** — how close each metric sits to the next interpretation threshold

3. Report the following regressions, if present:
   - **Label flips** — any archetype whose interpreted label changed (e.g., "slow, deliberate" → "measured"). Reference the threshold tables in `src/lib/comprosody.ts` (`interpretPace`, `interpretEnergy`, `interpretFluency`, `interpretDensity`) to explain *why* the label flipped.
   - **Lexical density drift** — any archetype whose density moved by more than ±0.02 from the previously reported baseline.
   - **Prompt token budget changes** — growth or shrinkage greater than 5% in the composed system prompt. Spot-check which dimension (genre, scale, prosody, voice config) drove the change.
   - **`FINDING:` lines** — any line the script itself flags as a finding. Quote them verbatim.

4. If none of the above trip, report "no regressions" and list the per-section headlines so the user can confirm the diagnostic ran to completion.

## What NOT to do

- Do not modify `src/lib/comprosody.ts` or `scripts/prosody-pipeline-diagnostic.ts` as part of this skill. Reporting only.
- Do not infer thresholds from output alone — always cross-reference the actual `interpret*()` functions when explaining a label flip.
- Do not run this inside tight loops — it spawns the full diagnostic and is deliberately interactive.
