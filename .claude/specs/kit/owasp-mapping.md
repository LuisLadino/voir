---
name: owasp-mapping
description: >
  How kit hooks map to the OWASP Top 10 for Agentic Applications, 2026,
  using FM2 subset qualifiers. Methodology spec referenced by every per-hook
  OWASP Coverage section. Required reading before adding or editing the
  OWASP Coverage section in any kit hook spec.
applies_to: []
triggers: [owasp, governance, agent-security, runtime-security]
category: kit
related: [block-dangerous, sensitive-file-protection, voice-context, dispatch]
---

# OWASP Top 10 Mapping for Kit Hooks

Per #308 V3, kit hooks carry explicit OWASP Top 10 mapping. Mapping uses subset language per FM2 qualifier. No hook claims full coverage of any OWASP risk. Every mapping declares what is covered and what is not.

## Why Subset Qualifiers

A kit hook is a thin enforcement primitive. The OWASP Top 10 risks are broad threat categories. Claiming a hook "covers" a risk creates false confidence that the risk is handled when only a subset is. FM2 of #308's pre-mortem named that failure mode and prescribed the wording discipline that prevents it.

The kit's coverage is partial-by-design at thread 1 and Sam's pilot N=1 scale. Gaps are explicit, not glossed.

## OWASP Top 10 for Agentic Applications, 2026

The canonical risk framework released December 2025:

1. Goal Hijack
2. Tool Misuse
3. Rogue Agents
4. Identity and Authorization Gaps
5. Memory Poisoning
6. Excessive Autonomy
7. Cascading Hallucination
8. Supply Chain Attacks
9. Tool Provenance Failures
10. Insufficient Audit Trail

## Mapping Template

Every per-hook spec carries an `OWASP Coverage` section using this exact shape:

```
## OWASP Coverage

- **Risk:** OWASP Top 10 entry name and number.
- **Hook:** the kit hook file path.
- **Covers (subset):** specific patterns the hook actually blocks or detects, named one per line.
- **Does NOT cover:** specific aspects of the same OWASP risk the hook does not address, named one per line.
- **Gap routing:** where the gap is addressed: another kit hook, CMA-native primitive, external runtime, or deferred to Tier 2 / Tier 3 trigger.
```

Subset coverage statements use the form "covers X subset of OWASP risk Y" or "does NOT cover Z aspect of risk Y." Mappings never claim full coverage. The FM2 qualifier is the only discipline that prevents over-claiming.

## Kit-Level OWASP Posture, per #308 V3

| OWASP risk | Kit coverage today | Hook | Gap routing |
|---|---|---|---|
| 1. Goal Hijack | partial subset | enforce-voice, Plane 2 brand-voice deviation per #305 V1 | prompt-injection-driven goal hijack: Tier 2 trigger to Microsoft AGT |
| 2. Tool Misuse | partial subset | block-dangerous: rm -rf, force push, credential exposure | chained-tool exploitation, argument manipulation: Tier 2 trigger to Microsoft AGT or Lunar.dev MCPX |
| 3. Rogue Agents | gap | none | deferred. Single-tenant assumption holds at thread 1 / N=1 |
| 4. Identity and Authorization Gaps | covered outside kit | none. CMA-native per #300 V3 | per-agent identity + vault-backed credentials |
| 5. Memory Poisoning | partial subset outside kit | none in kit. Cognee per #298 has graph integrity | explicit poisoning detection deferred |
| 6. Excessive Autonomy | partial subset | enforce-plan + dispatch: plan-approval gate | autonomous loops within plan scope: deferred |
| 7. Cascading Hallucination | gap | none | #303 V1 review-agent pattern is the future path |
| 8. Supply Chain Attacks | partial subset | block-sensitive-bash-writes: credential exfil | MCP server compromise, e.g., CVE-2026-26118 Azure MCP, Postmark MCP: Tier 2 trigger to Lunar.dev MCPX |
| 9. Tool Provenance Failures | gap | none | deferred to MCP gateway adoption at Tier 2 |
| 10. Insufficient Audit Trail | partial in kit + covered outside kit | tracking JSONL in kit + CMA-native tracing per #300 V3 | enforce-specs spec-read enforcement covers spec-discipline subset |

The table above is a snapshot of the verdict at #308 V3. As per-hook specs are filled in, each `OWASP Coverage` section is the canonical record for that hook. This table summarizes; per-hook specs govern.

## Mapping Sequence

Per #308 V3 follow-up plan, hook mapping ships in order. block-dangerous is first because its scope is the simplest and the FM2 discipline is easy to demonstrate.

1. **block-dangerous → OWASP Tool Misuse subset, #350, this is the first integration**
2. enforce-voice → OWASP Goal Hijack subset, Plane 2 per #305 V1
3. enforce-specs → OWASP Insufficient Audit Trail subset. Spec-read enforcement is partial audit, not full
4. enforce-plan + dispatch → OWASP Excessive Autonomy subset
5. block-sensitive-bash-writes → OWASP Supply Chain subset

Issues for #2 through #5 ship after #350 proves the pattern.

## Reversal

If kit-built versions of OWASP-specific risks: Goal Hijack via prompt injection, Rogue Agent detection, Cascading Hallucination, Tool Provenance attestation, prove load-bearing at N=1, V1 reverses to Hybrid kit + Microsoft Agent Governance Toolkit per #308 V3 reversal condition. Per FM5, no kit-built precursor ships for those gaps. AGT integrates directly when the trigger fires.

If #300 V3 CMA reverses per #335 Layer 1, the Identity / Authorization Gaps and Insufficient Audit Trail rows re-evaluate in lockstep.

## Related

- `cosmo:docs/research/product-sdk/agent-governance-runtime-security-2026-04.md` — verdict V3 source (relocated to the cosmo repo 2026-06-06)
- `.claude/specs/kit/block-dangerous.md` — first per-hook mapping, this issue
- `.claude/specs/kit/sensitive-file-protection.md` — block-sensitive-bash-writes spec, OWASP Coverage section to follow
- `.claude/specs/kit/voice-context.md` — enforce-voice spec, OWASP Coverage section to follow
- `.claude/specs/kit/dispatch.md` — enforce-plan + dispatch governance, OWASP Coverage section to follow
- #335 Layer 4 OWASP Top 10 framework annual review checkpoint
