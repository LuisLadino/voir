# Market Intelligence Transfer from claude-kit Research

**Date:** 2026-03-19
**Source:** Full competitive analysis of AI coding assistant configuration ecosystem (17 parallel research agents)
**Full analysis:** ~/Repositories/Personal/claude-kit/.claude/research/competitive-analysis-2026-03.md

---

## Market Data

### Size and Adoption
- AI code assistant market: $3.0-3.5B (2025, Gartner)
- 90% of enterprise engineers will use AI code assistants by 2028
- 84% of developers use or plan to use AI tools
- 22% of merged code is AI-authored (DX Q4 2025)
- Claude Code sessions: average 23 min (up from 4), 78% involve multi-file edits

### Security
- 48% of AI-generated code contains vulnerabilities (Snyk 2026)
- 28.65M new hardcoded secrets on public GitHub in 2025 (+34% YoY)
- AI service secrets up 81% YoY to 1.275M
- Claude Code-assisted commits: 3.2% secret-leak rate vs 1.5% baseline
- Security scanning is table stakes, not a differentiator

### The Productivity Paradox
- Individual devs: 3.6 hr/week saved, 21% more tasks, 98% more PRs merged
- PR review time increases 91% with high AI adoption
- Only 16.3% report significant productivity gains
- 69% of frequent AI users experience deployment problems
- Bottleneck moved from code generation to review, testing, deployment
- Implication: tools that help with the bottleneck (review, quality) are more valuable than tools that speed up generation

### Trust Gap
- 45% say near-correct AI output is worse than wrong
- 66% spend more time fixing near-correct than starting from scratch
- Only 3% "highly trust" AI accuracy
- Any product claiming AI quality must address this head-on

---

## Key Patterns

### Nobody Has Solved Persistence
- Cursor: zero memory across sessions
- Aider: zero memory
- Copilot: static instruction files
- Cline Memory Bank: 6 mandatory files (most structured attempt)
- claude-mem: ChromaDB vectors + session compression (38K stars)
- Beads (Steve Yegge): graph-based memory on Dolt (19K stars)
- Our memory/ system is one of the most sophisticated in the ecosystem

### Spec-Driven Development is the Named Paradigm
- GitHub Spec Kit (open-source, agent-agnostic)
- AWS Kiro (IDE with requirements.md > design.md > tasks.md)
- Tessl Framework
- Industry converged on: requirements → design → tasks
- Align with this vocabulary if building workflow features

### Context Engineering > Prompt Engineering
- Martin Fowler, Anthropic, MIT Tech Review all published on this shift
- Model correctness drops around 32K tokens (Stanford/UC Berkeley)
- Designing systems that manage context is the discipline
- GSD framework (35K stars) solves "context rot" with fresh 200K contexts per executor

### MCP is the Universal Extension Standard
- 16,000+ servers, 97M+ monthly SDK downloads
- Adopted by Anthropic, OpenAI, Google, Microsoft
- Any tool that doesn't support MCP is isolated

### Config File Fragmentation
- CLAUDE.md, AGENTS.md, .cursorrules, copilot-instructions.md, .windsurfrules, GEMINI.md
- AGENTS.md becoming standard via Linux Foundation AAIF (60K+ repos)
- Ruler (2.6K stars) writes once, generates for 30+ tools
- Developers use 2-4 AI tools simultaneously (70%)

### Enterprise Controls are the Product
- GitHub Agent Control Plane (GA Feb 2026): centralized AI governance
- Enterprises pay for control, audit, governance — not just agents
- EU AI Act high-risk rules: August 2026 (fines up to 35M euros / 7% global revenue)

---

## Competitive Landscape

### Terminal AI Coding Agents
| Agent | Stars | Key Feature |
|-------|-------|-------------|
| OpenClaw | 210K | Always-on, writes own skills |
| Gemini CLI | 98K | Free tier, 1M context |
| Claude Code | 80K | Hooks, skills, agents, MCP |
| Codex CLI | 66K | AGENTS.md, open-source |
| Cline | 59K | VS Code, Memory Bank, MCP marketplace |
| Aider | 42K | Repo map, 100+ LLMs, architect mode |
| Continue.dev | 32K | CI checks, open-source |

### IDE Players
| Tool | Key Metric |
|------|-----------|
| Cursor | $2B+ revenue, $29.3B valuation, ~1M DAU, 60% enterprise |
| GitHub Copilot | 77K enterprises, 20M users, Agent Control Plane |
| Windsurf | #1 LogRocket Power Rankings, acquired by Cognition for $250M |

### AI Code Review / Quality
| Tool | Key Metric |
|------|-----------|
| CodeRabbit | 2M+ repos, $12-30/user/mo |
| Greptile | YC-backed, 82% bug catch rate |
| Graphite | Shopify: 33% more PRs/dev |
| Qodo | Ford, Monday.com, Intuit. Gartner Visionary. |
| Snyk AI Security Fabric | End-to-end SDLC security |

### Enterprise AI Coding Platforms
| Platform | Price | Differentiator |
|----------|-------|---------------|
| GitHub Copilot | $19-39/user/mo | Distribution (90% Fortune 100) |
| Sourcegraph Cody | Custom | Pre-indexed repos, enterprise-only |
| Tabnine | $39/user/mo | Air-gapped, zero data retention |
| Amazon Q | $19/user/mo | AWS integration |
| Gemini Code Assist | $45/user/mo | Code customization, team rules |
| Augment Code | Custom | $270M funding, ISO/IEC 42001, 400K+ file indexing |

### Claude Code Framework Ecosystem (top 10 by stars)
| Project | Stars | Focus |
|---------|-------|-------|
| Superpowers | 97K | Auto-activating skills, TDD |
| Everything Claude Code | 86K | 108+ skills, cross-agent |
| awesome-claude-skills (Composio) | 46K | Curated skills + Tool Router |
| BMAD Method | 41K | 12 expert agents, agile lifecycle |
| claude-mem | 38K | Biomimetic memory, ChromaDB |
| GSD | 35K | Spec-driven, context rot solution |
| agents (wshobson) | 32K | 112 agents, 72 plugins |
| awesome-claude-code | 29K | Definitive directory |
| claude-code-templates | 23K | CLI + web UI, analytics |
| SuperClaude | 22K | 30 commands, 16 agents, 7 modes |

---

## Architectural Patterns Worth Studying

### Aider's Repo Map
Graph-ranked codebase structure via tree-sitter. Sends only relevant code signatures (~1K tokens). Smart context injection without dumping entire files.

### GSD's Wave Execution
Fresh 200K token contexts per executor. Discrete markdown documents (PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md) loaded selectively. Atomic git commits per task.

### Progressive Loading
Name+description first (~100 tokens), full instructions on demand (~5K tokens). Cline, Superpowers, and claude-kit skills all use this. Universal pattern for any system loading instructions into an LLM.

### Roo Code's Mode System
Custom modes with tool restrictions (Architect: read-only, Code: full access, Debug: terminal only). fileRegex scopes what the AI can edit. Proven pattern for role-based access.

### Cline's Memory Bank
6 required files: projectbrief.md, productContext.md, systemPatterns.md, techContext.md, activeContext.md, progress.md. Every task reads ALL files. Date-based versioning in Roo Code variant.

### knowhub for Distribution
Central source of truth synced to multiple repos. If voir becomes distributable, this is the model.

---

## Pricing Signals
- Copilot: $19-39/user/month
- Cursor: $20-40/user/month
- CodeRabbit: $12-30/user/month
- Tabnine Enterprise: $39/user/month
- Gemini Code Assist: $45/user/month
- Devin: $20/month (down from $500 — race to bottom on autonomous agents)
- Claude Enterprise: $50K/year for 70 users

---

## Community Demand Signals

### What Users Want
1. Persistent memory that works across sessions
2. Real-time cost/token visibility
3. Smart context management (not just truncation)
4. Cross-tool rule interoperability
5. Better autonomy controls (spectrum between approve-all and full-auto)

### Framework Fatigue
- Backlash targets "prompt collections disguised as products"
- Does NOT target genuine workflow infrastructure (hooks, enforcement, context injection)
- Boris Cherny (Claude Code creator) runs vanilla — says shared CLAUDE.md updated during code review is what works
- Sweet spot: minimal, team-shared, iteratively improved rules

### Industry Shifts
- "Context engineering" replacing "prompt engineering" as key discipline
- Spec-driven development as named paradigm
- Multi-agent orchestration as emerging frontier
- Cross-tool compatibility becoming expected

---

## Sources

Full source list with URLs in: ~/Repositories/Personal/claude-kit/.claude/research/competitive-analysis-2026-03.md
