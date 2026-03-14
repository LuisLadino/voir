# AI Memory/Context Products: Comprehensive Market Map (March 2026)

## Executive Summary

The AI memory market has exploded in 2026. What started as experimental features in 2024-2025 is now "essential infrastructure" for AI agents. The market divides into: commercial memory-as-a-service platforms, MCP-based open-source tools, native IDE/assistant features, and research prototypes.

**Key finding:** While many products solve "remembering facts," few address the structural problems of siloed memory, shared knowledge across users, setup complexity, and cost transparency.

---

## 1. Commercial Memory-as-a-Service

### Mem0 (OpenMemory)
- **Website:** [mem0.ai](https://mem0.ai/)
- **What they offer:** Universal memory layer for AI apps. Memory compression, graph memory (paid), automatic learning. Claims +26% accuracy over OpenAI Memory on LOCOMO benchmark.
- **Target user:** Developers building AI apps, enterprise teams needing persistent context
- **UX:** Single line of code integration. Works with OpenAI, LangGraph, CrewAI, Python/JS. SOC 2 & HIPAA compliant.
- **Pricing:** Free tier (10K memories), $19/mo (50K memories), $249/mo Pro (graph memory unlocked)
- **What they DON'T do:** Graph memory paywalled. The jump from $19 to $249 is steep for solo devs. No cross-user knowledge sharing.

### Zep
- **Website:** [getzep.com](https://www.getzep.com/)
- **What they offer:** Temporal knowledge graphs via Graphiti engine. Tracks how facts change over time. Enterprise-focused with conversation synthesis.
- **Target user:** Enterprise teams building agents that need temporal reasoning and multi-system data integration
- **UX:** End-to-end context engineering platform. Sub-200ms latency. Integrates with LangChain.
- **Performance:** 94.8% on DMR benchmark, 18.5% improvement on LongMemEval, 90% latency reduction.
- **What they DON'T do:** Enterprise-focused means complexity and cost may be overkill for individual developers.

### Supermemory
- **Website:** [supermemory.ai](https://supermemory.ai/)
- **What they offer:** Personal knowledge assistant + enterprise memory API. Automatic forgetting (temporal facts expire). Memory graph that tracks preferences over time.
- **Target user:** Individual productivity users + enterprise AI teams
- **UX:** Chrome, Notion, Obsidian integrations. Self-hostable. Open-source core.
- **Performance:** State-of-the-art on LongMemEval. Both RAG and personalized memory together.
- **What they DON'T do:** Less coding-agent focused than competitors like Mem0.

### Graphlit
- **Website:** [graphlit.com](https://www.graphlit.com/)
- **What they offer:** Semantic infrastructure. Native multimodal support, 30+ connectors, knowledge graphs spanning documents/audio/video/web. Not just chat history but full content understanding.
- **Target user:** Enterprise teams needing unified memory across diverse content types
- **UX:** One API for ingestion, extraction, enrichment, storage, retrieval. Real-time sync with Slack, GitHub, Jira.
- **Philosophy:** "Memory as a web of entities, facts, and timelines" not "a list of documents and chunks"
- **What they DON'T do:** Heavy infrastructure approach may be overkill for simpler use cases.

### Cognee
- **Website:** [cognee.ai](https://www.cognee.ai/)
- **What they offer:** Knowledge engine with self-evolving memory. cognify (build graph), memify (refine graph based on usage), 14 retrieval modes. Unifies relational/vector/graph storage.
- **Target user:** Developers building AI agents needing persistent semantic memory
- **UX:** "Memory for AI agents in 6 lines of code." Integrates with Claude SDK, OpenAI, LangGraph, Google ADK.
- **Funding:** $7.5M seed (2025), backed by OpenAI and Facebook AI Research founders. Running in 70+ companies.
- **What they DON'T do:** Still maturing compared to more established players.

### MemoClaw
- **Website:** [memoclaw.com](https://memoclaw.com/)
- **What they offer:** Dead-simple API (store/recall). Crypto wallet = identity. Pay-per-use ($0.001 per memory). No signup required.
- **Target user:** Developers wanting zero-friction memory without subscriptions
- **UX:** `memoclaw init` - 30 seconds to get started. Uses x402 protocol for microtransactions.
- **What they DON'T do:** Vector-based only (no knowledge graph). For entity extraction/relationships, need Zep or Mem0 Pro.

---

## 2. MCP-Based Tools

### OpenMemory (Mem0's MCP variant)
- **What they offer:** Unified memory system across all MCP-compatible clients. Works with Cursor, VS Code, Claude, etc.
- **Target user:** Developers using multiple AI coding tools wanting shared context
- **UX:** Install once, works everywhere MCP is supported. Like a "memory chip" for all your AI tools.

### MCP Backpack
- **Source:** [Medium article](https://medium.com/codex/introducing-mcp-backpack-persistent-portable-memory-for-ai-coding-agents-87eea16eaa54)
- **What they offer:** Persistent, portable memory for AI coding agents. 7 tools: 5 for day-to-day memory, 2 for portability.
- **Target user:** Claude Code users needing cross-session, cross-machine memory
- **UX:** "Backpack" metaphor makes tools intuitive for LLMs.
- **What they DON'T do:** Designed specifically for coding context, not general-purpose.

### Hindsight
- **Website:** [hindsight.vectorize.io](https://hindsight.vectorize.io/blog/2026/03/04/mcp-agent-memory)
- **What they offer:** Open-source structured memory via MCP. Three operations: retain, recall, reflect. Knowledge graph with cross-encoder reranking.
- **Target user:** Developers wanting open-source memory infrastructure
- **UX:** One Docker command to run locally. Not a vector database - extracts structured facts.
- **What they DON'T do:** Requires self-hosting. Less polished than commercial options.

### MCP Memory Keeper
- **Source:** [GitHub](https://github.com/mkreyman/mcp-memory-keeper)
- **What they offer:** SQLite + knowledge graph + semantic search + session branching. Multi-agent system with analyzer/synthesizer agents.
- **Target user:** Claude users wanting local persistent context
- **UX:** Never lose context during compaction. Journal entries, visualization, multi-agent.

### MCP AI Memory (scanadi)
- **Source:** [GitHub](https://github.com/scanadi/mcp-ai-memory)
- **What they offer:** Graph relationships (references, contradicts, supports, extends, causes, precedes). Memory decay with lifecycle management. Memory states (active, dormant, archived, expired).
- **Target user:** Developers needing sophisticated memory state management
- **What they DON'T do:** Production-readiness may vary.

### Memory Forge
- **Source:** [GitHub](https://github.com/cpretzinger/memory-forge)
- **What they offer:** PostgreSQL + Redis + Qdrant stack. Auto-save every 30 seconds. Multi-user isolated contexts.
- **Target user:** Teams needing infrastructure-grade memory
- **UX:** Complete Docker stack.

### Memvid
- **Website:** [memvid.com](https://memvid.com/)
- **What they offer:** Memory encoded in video format (MP4). Single-file memory layer. Sub-ms semantic search without database.
- **Target user:** Developers wanting zero-infrastructure memory
- **UX:** `git commit` your memory. Native Rust core. Python/Node/CLI bindings.
- **Performance:** +35% on LoCoMo, +76% multi-hop reasoning.
- **Philosophy:** "SQLite for AI memory" - portable, versioned, no DB needed.

---

## 3. Native IDE/Assistant Features

### GitHub Copilot Memory
- **Status:** Public preview (March 2026), on by default for Pro/Pro+
- **What they offer:** Agentic memory that discovers repository-specific knowledge (conventions, patterns, dependencies). Memories shared across Copilot features (coding agent, code review).
- **Target user:** GitHub Copilot subscribers
- **UX:** Automatic. Repository-level memories expire after 28 days.
- **What they DON'T do:** Repository-scoped only. No cross-repo knowledge. Enterprise must opt-in.

### Windsurf Memories
- **What they offer:** Persistent context across conversations. User-generated rules + auto-generated memories from interactions.
- **Target user:** Windsurf IDE users
- **UX:** Rules define behavior, Cascade auto-saves context. Stored in `.windsurfrules`.
- **Pricing:** $15/month (cheaper than Cursor)
- **What they DON'T do:** Stability issues in long sessions. Restrictive free tier (25 credits).

### Cursor Rules + Third-party Memory
- **Native:** Rules in `.cursor/rules/` - project-level instructions persisting across sessions
- **Third-party options:** Basic Memory, Recallium, ContextForge, Cursor Memory Bank
- **Status:** Cursor itself does NOT persist memory across conversations. Community has built memory layers.
- **What they DON'T do:** Native solution is rules-only, not true memory. Third-party tools required for context persistence.

### ChatGPT Memory
- **Status:** Available to all users (free tier is "lightweight")
- **What they offer:** Saved memories (explicit) + chat history references (implicit). Memory import tool to switch from competitors.
- **Target user:** ChatGPT users
- **UX:** Automatic or manual saves. Project-only memory for enterprise.
- **Limitations:** Free tier is limited. User-level only (no shared team memory).

### Claude Memory
- **Status:** Free for all users (March 2026). Auto-memory available.
- **What they offer:** Memory that learns from conversations. Import tool for switching from ChatGPT/Gemini/Copilot.
- **Target user:** Claude users
- **Claude Code specific:** MEMORY.md auto-generated for project context.
- **What they DON'T do:** Still per-user. No team knowledge sharing.

### Microsoft Recall
- **Status:** Windows 11/12, Recall 2.0 in January 2026
- **What they offer:** Screen capture every few seconds. Natural language search across everything you've seen/done.
- **Target user:** Windows users with Copilot+ PCs (40 TOPS NPU required)
- **Privacy:** All local, encrypted. Opt-in only after backlash.
- **What they DON'T do:** Visual-only (screen capture). Not designed for AI agent memory. Privacy concerns persist.

---

## 4. Developer Frameworks

### LangMem (LangChain)
- **What they offer:** Memory primitives for LangGraph. Episodic, semantic, and procedural memory types. Background memory manager for extraction/consolidation.
- **Target user:** Developers using LangChain/LangGraph
- **2026 update:** Agents can now trigger context compression autonomously (March 2026)
- **What they DON'T do:** You wire the plumbing. No hosted service - need your own embedding pipeline and vector index.

### Letta (formerly MemGPT)
- **Website:** [letta.com](https://www.letta.com/)
- **What they offer:** Stateful agents with self-editing memory. LLM-as-an-Operating-System paradigm. Memory hierarchy (core, conversational, archival, files).
- **Target user:** Developers building agents that learn and self-improve
- **Recent:** Letta Code (#1 on Terminal-Bench for model-agnostic agents), Remote Environments (March 2026)
- **Model recommendations:** Opus 4.5 and GPT-5.2
- **What they DON'T do:** Platform approach requires buy-in to their architecture.

---

## 5. Open Source Projects

### MemOS (MemTensor)
- **Source:** [GitHub](https://github.com/MemTensor/MemOS)
- **What they offer:** Memory OS for AI agents. Skill memory for cross-task reuse. Cloud plugin (72% lower tokens) + local plugin.

### memU (NevaMind-AI)
- **Source:** [GitHub](https://github.com/NevaMind-AI/memU)
- **What they offer:** Memory for 24/7 proactive agents. 92% accuracy on LoCoMo. Understands user intent without commands.

### OpenMemory (CaviraOSS)
- **Source:** [GitHub](https://github.com/CaviraOSS/OpenMemory)
- **What they offer:** Cognitive memory engine. Hierarchical Memory Decomposition with temporal graph. Connectors for GitHub, Notion, Google Drive, etc.

### Screenpipe (Rewind alternative)
- **What they offer:** Open-source screen recording with AI search. 24/7 local recording, semantic search.
- **Philosophy:** Local-first Rewind alternative that works on macOS, Windows, Linux.

### Graphiti (Zep's open-source engine)
- **Source:** [GitHub](https://github.com/getzep/graphiti)
- **What they offer:** Temporal context graphs. Tracks how facts change over time. MCP server available.

---

## 6. Desktop/Consumer Products

### Rewind AI / Limitless
- **What they offer:** Records everything on screen + audio. Natural language search. Pivoted to Limitless (cloud + wearable pendant).
- **Target user:** Knowledge workers wanting perfect recall
- **Privacy:** Local-first (Rewind). Cloud (Limitless).
- **What they DON'T do:** Not designed for AI agents. Visual/audio focused.

### Pieces for Developers
- **Website:** [pieces.app](https://pieces.app/)
- **What they offer:** Local-first AI assistant. Captures snippets, commands, browser research. 9 months of context. OS-level capture.
- **Target user:** Developers wanting "invisible second brain"
- **UX:** Plugins for Chrome, VS Code. Works offline.
- **Philosophy:** "Developers lose time re-finding context" - Pieces resurfaces it automatically.

---

## 7. Enterprise/Platform Solutions

### ContextForge (IBM)
- **Website:** [GitHub](https://github.com/IBM/mcp-context-forge)
- **What they offer:** AI Gateway for MCP/A2A/REST/gRPC. Centralized governance, discovery, observability. Wraps legacy APIs as MCP tools.
- **Target user:** Enterprise teams needing unified agent infrastructure
- **Status:** 1.0.0 Beta (December 2025)

### Basic Memory
- **Source:** [basicmemory.com](https://docs.basicmemory.com/)
- **What they offer:** Full knowledge base for Cursor/Claude. Semantic connections, searchable notes.
- **Positioning:** "Cursor's built-in memories store short preference strings. Basic Memory gives it a full knowledge base."

### Recallium
- **What they offer:** Persistent memory across all AI tools via MCP. Shared brain that learns.
- **Target user:** Developers using multiple AI tools wanting unified context

---

## Market Gaps: What's NOT Being Served

### 1. Shared/Team Memory
Almost every product is per-user. When a team works on the same project, they each teach the AI the same things independently. No compounding, no collective intelligence, no network effects.

**Gap:** Team knowledge graphs that multiple users contribute to and benefit from.

### 2. Cross-Product Memory Portability
Your Cursor context doesn't transfer to Claude Code. Your ChatGPT memories don't help in VS Code. Import tools exist but are one-time migrations.

**Gap:** True interoperability where memory travels with you across tools.

### 3. Setup Complexity
MCP tools require Docker, databases, configuration. Commercial services require accounts, API keys, billing setup.

**Gap:** Zero-config memory that "just works" for individual developers.

### 4. Cost Transparency
Mem0's $19 to $249 jump. Token costs hidden in usage. Hard to predict monthly spend.

**Gap:** Simple, predictable pricing (MemoClaw's per-memory model is an attempt).

### 5. Privacy + Power Together
Local-first tools sacrifice features. Cloud services require trusting third parties with context.

**Gap:** Full-featured memory that remains entirely local.

### 6. Observability and Governance
Teams can't see what agents remember, when they forget, or how memory affects decisions.

**Gap:** Memory debugging, audit trails, compliance tools.

### 7. Temporal Reasoning at Scale
Most tools store facts but don't track how they change over time. Zep and Graphiti do this but are enterprise-focused.

**Gap:** Accessible temporal memory for individuals/small teams.

### 8. Automatic Context Prioritization
Tools store everything, but LLMs have limited context windows. Who decides what's relevant?

**Gap:** Intelligent memory that surfaces the right context for the right moment without manual curation.

### 9. Cross-Session Skill Transfer
An agent learns to solve a problem in one session. That skill should transfer to future sessions and similar problems.

**Gap:** Skill memory (MemOS attempts this) that enables agents to reuse learned procedures.

### 10. Memory for Non-Developers
Most products target developers. Knowledge workers, researchers, executives have different needs.

**Gap:** Business-user-friendly memory products.

---

## Market Trends (2026)

1. **MCP as standard** - Memory is becoming a first-class MCP primitive. Most new tools are MCP-native.

2. **Graph > Vector** - Knowledge graphs gaining over pure vector search. Temporal awareness matters.

3. **Local-first resurgence** - Privacy concerns driving demand for on-device memory (Pieces, Screenpipe, Memvid).

4. **Agent memory ≠ chat memory** - Products splitting between "remembering conversations" and "memory for autonomous agents."

5. **Self-improving memory** - Cognee's memify, Letta's self-editing, LangMem's autonomous compression. Memory that evolves.

6. **Enterprise hardening** - SOC 2, HIPAA, BYOK becoming table stakes for commercial offerings.

---

## Product Categories Summary

| Category | Examples | Strength | Gap |
|----------|----------|----------|-----|
| Commercial SaaS | Mem0, Zep, Supermemory, Graphlit | Polish, support, compliance | Cost, vendor lock-in |
| MCP Tools | Hindsight, MCP Backpack, Memvid | Open, portable | Setup complexity |
| IDE Native | Copilot Memory, Windsurf, Cursor Rules | Seamless UX | Siloed per-product |
| Chatbot Native | ChatGPT, Claude Memory | Zero setup | Per-user, no agent features |
| Frameworks | LangMem, Letta | Developer control | You build everything |
| Desktop | Rewind/Limitless, Pieces | Captures everything | Not agent-focused |
| Enterprise | ContextForge, Graphlit | Governance, scale | Complexity, cost |

---

## Sources

- [Mem0 Pricing](https://mem0.ai/pricing)
- [Zep Platform](https://www.getzep.com/)
- [GitHub Copilot Memory Docs](https://docs.github.com/en/copilot/concepts/agents/copilot-memory)
- [Windsurf Context Guide](https://markaicode.com/windsurf-flow-context-engine/)
- [Supermemory](https://supermemory.ai/)
- [Cognee](https://www.cognee.ai)
- [Letta/MemGPT](https://www.letta.com/)
- [LangMem](https://langchain-ai.github.io/langmem/)
- [Hindsight MCP Memory](https://hindsight.vectorize.io/blog/2026/03/04/mcp-agent-memory)
- [MemoClaw](https://memoclaw.com/)
- [Memvid](https://memvid.com/)
- [Graphlit](https://www.graphlit.com/)
- [Claude Memory Announcement](https://www.macrumors.com/2026/03/02/anthropic-memory-import-tool/)
- [Microsoft Recall](https://learn.microsoft.com/en-us/windows/ai/apis/recall)
- [AI Agent Memory Gaps (DEV Community)](https://dev.to/deiu/the-three-things-wrong-with-ai-agents-in-2026-492m)
- [Mem0 vs Zep vs LangMem vs MemoClaw Comparison](https://dev.to/anajuliabit/mem0-vs-zep-vs-langmem-vs-memoclaw-ai-agent-memory-comparison-2026-1l1k)
- [Top 10 AI Memory Products 2026](https://medium.com/@bumurzaqov2/top-10-ai-memory-products-2026-09d7900b5ab1)

---

*Research compiled: March 14, 2026*
