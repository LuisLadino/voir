# AI Coding Tools Competitive Landscape (March 2026)

## Executive Summary

The AI coding assistant market has matured significantly, with clear differentiation emerging between approaches: standalone AI-native IDEs (Cursor), VS Code extensions (Continue.dev, Cody, Copilot), and enterprise-focused solutions (Tabnine). The key battleground has shifted from basic code completion to **agentic capabilities**, **persistent context/memory**, and **multi-file understanding**.

---

## 1. Continue.dev

**Type:** Open-source VS Code/JetBrains extension

### Architecture

- **Extension-based**: Runs inside VS Code and JetBrains IDEs
- **Model-agnostic**: Connect to any LLM (OpenAI, Anthropic, local models via Ollama/LM Studio)
- **Local-first**: Code and configuration can remain entirely on your machine
- **Air-gapped capable**: Run 100% offline with local models

### Context/Memory Handling

- **Embedding + re-ranking models**: Indexes codebase for semantic search
- **No persistent memory**: Context is per-session (unless you build external solutions)
- **`.continue/rules/` directory**: Project-specific team standards and AI behaviors
- **Context providers**: Pluggable system for supplying additional context

### Configuration Model

```
~/.continue/config.yaml (or config.json)
~/.continue/config.ts (for programmatic extension)
.continue/rules/ (project-specific rules)
```

Key config features:
- **globs**: Auto-apply rules when matching files are in context
- **regex**: Apply rules when file content matches patterns
- **alwaysApply**: Force rule inclusion regardless of context
- **Context providers**: Custom context sources

### Distribution

- VS Code Marketplace (20,000+ GitHub stars)
- JetBrains Marketplace
- Self-hosted option

### Monetization

| Tier | Price | Features |
|------|-------|----------|
| Solo | Free | Full open-source extension |
| Team | $10/dev/month | Centralized config, shared agents, secret management |
| Enterprise | Custom | Governance, SSO, on-premises data plane |
| Models Add-On | Flat fee | Access to frontier AI models |

**Funding**: $5.6M from Y Combinator and Heavybit (Seed stage, 19 employees as of Jan 2026)

**Sources:**
- [Continue.dev Official Site](https://www.continue.dev/)
- [Continue Docs - Configuration](https://docs.continue.dev/customize/deep-dives/configuration)
- [Continue Pricing](https://www.continue.dev/pricing)

---

## 2. Cursor

**Type:** AI-native IDE (VS Code fork)

### Architecture

- **Standalone IDE**: Fork of VS Code with AI built into the editor
- **Deep integration**: Access to context extensions cannot reach (open tabs, recent edits, cursor position, file history, full codebase structure)
- **Embedding-based codebase indexing**: Semantic understanding of entire repository
- **Extended context window**: Up to 272k tokens (vs Copilot's 64k-128k)

The critical distinction: "Because Cursor IS the editor rather than an extension running inside it, it has access to context that plugins simply cannot reach."

### Context/Memory Handling

- **Repository-wide indexing**: Background semantic indexing of codebase
- **Module dependency understanding**: Knows file relationships, imports, architecture patterns
- **No explicit cross-session memory**: Each session requires re-establishing context (though indexed codebase persists)

### Configuration Model

**Rule Locations:**
1. **Global**: `Cursor Settings > General > Rules for AI`
2. **Project**: `.cursor/rules/*.mdc` files (replaces deprecated `.cursorrules`)

**MDC Format:**
```yaml
---
description: Brief summary
globs: ["*.py", "src/**/*.js"]
alwaysApply: false
---
# Rule Content
- Do this.
- Avoid that.
```

Key insight: "Rules that conflict or are written as vague preferences get ignored. Be specific and use negative instructions."

### Distribution

- Direct download from cursor.com
- macOS, Windows, Linux

### Monetization (Credit-based since June 2025)

| Tier | Price | Features |
|------|-------|----------|
| Hobby | Free | 2,000 completions, 50 slow premium requests |
| Pro | $20/month | Unlimited Tab completions, monthly credit pool |
| Pro+ | $60/month | 3x usage credits |
| Ultra | $200/month | 20x usage, priority access |
| Teams | $40/user/month | Centralized billing, SSO, admin controls |
| Enterprise | Custom | Pooled usage, audit logs, SCIM 2.0 |

**Performance**: Nearing $1B annualized run-rate from millions of users.

**Sources:**
- [VS Code vs Cursor 2026 Comparison](https://dev.to/glen_kiptoo_25bf70b816136/vs-code-vs-cursor-traditional-vs-ai-code-editor-which-one-should-developers-use-in-2026-5dg3)
- [Cursor Pricing](https://cursor.com/pricing)
- [Cursor Rules Documentation](https://cursor.com/docs/context/rules)

---

## 3. Cody (Sourcegraph)

**Type:** VS Code extension (Enterprise-focused)

### Architecture

- **Extension-based**: VS Code, Visual Studio, JetBrains
- **Powered by Sourcegraph**: Leverages Sourcegraph's code search infrastructure
- **Remote codebase context**: Can pull context from remote repositories (Enterprise)

### Context/Memory Handling

- **Semantic search**: Retrieves relevant files from codebase
- **@-mention system**: `@file`, `@#symbol`, `@filepath:1-10` (line ranges)
- **Context tracking**: Shows which files Cody used below each message
- **Enterprise context filters**: Admins can include/exclude repositories from context

Key limitation: "Cody can only recognize files that are directly in the repository. Files outside the repository won't be fetched as context."

### Configuration Model

- Enterprise admin controls for repository access
- Context filters via site configuration (include/exclude rules)
- No public `.cody/rules` equivalent documented

### Distribution

- VS Code Marketplace
- JetBrains Marketplace
- Visual Studio Marketplace

### Monetization

**Major change**: Cody Free and Pro discontinued July 2025. Enterprise-only focus now.

| Tier | Price | Status |
|------|-------|--------|
| Free | $0 | **Discontinued** |
| Pro | $? | **Discontinued** |
| Enterprise Starter | $19/user/month | Up to 50 devs |
| Enterprise | $59/user/month | 25+ devs, full features |

**Strategic shift**: Sourcegraph introduced **Amp** as new agentic AI product. Cody Enterprise remains supported.

**Sources:**
- [Sourcegraph Pricing](https://sourcegraph.com/pricing)
- [Changes to Cody Plans](https://sourcegraph.com/blog/changes-to-cody-free-pro-and-enterprise-starter-plans)
- [Cody VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=sourcegraph.cody-ai)

---

## 4. GitHub Copilot

**Type:** VS Code extension (Microsoft ecosystem)

### Architecture

Three components:
1. **Local extension**: Captures prompt, identifies relevant code, formats data
2. **Proxy layer**: Rate-limiting, authentication, security checks
3. **LLM backend**: Processes prompt + context, returns suggestions

**2026 Update**: Copilot code review now runs on agentic tool-calling architecture, gathering broader repository context (directory structure, references, dependencies).

### Context/Memory Handling

- **Context window**: 64k-128k tokens (smaller than Cursor's 272k)
- **No persistent cross-session memory**: Each session is independent
- **Enterprise knowledge bases**: Custom models trained on your codebase (Enterprise tier)

### User Data Handling

Data types collected:
- **User Engagement Data**: Pseudonymous identifiers, accepted/dismissed completions, logs
- **Prompts**: Inputs sent to generate suggestions
- **Suggestions**: AI-generated responses
- **Feedback**: Thumbs up/down, comments

**Privacy**: "GitHub does not use Copilot Business or Enterprise data to train its models." Data protected by TLS v1.2 with forward secrecy.

### Configuration Model

- Repository-level `.github/copilot-instructions.md` for project context
- Organization policies for Business/Enterprise
- No `.cursorrules`-style rule system

### Distribution

- VS Code Marketplace
- Visual Studio Marketplace
- JetBrains Marketplace
- Vim/Neovim plugins
- GitHub CLI (`gh copilot`)

### Monetization

| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | 2,000 completions, 50 premium requests, GPT-4o + Claude 3.5 Sonnet |
| Pro | $10/month | 300 premium requests, unlimited completions, coding agent |
| Pro+ | $39/month | 1,500 premium requests, all models (Claude Opus 4, o3) |
| Business | $19/user/month | Team management, audit logs, IP indemnity |
| Enterprise | $39/user/month | 1,000 premium requests, knowledge bases, custom models |

Additional requests: $0.04/request beyond plan limits.

**Sources:**
- [GitHub Copilot Plans](https://github.com/features/copilot/plans)
- [GitHub Copilot Data Handling](https://resources.github.com/learn/pathways/copilot/essentials/how-github-copilot-handles-data/)
- [Copilot Agentic Architecture Update](https://github.blog/changelog/2026-03-05-copilot-code-review-now-runs-on-an-agentic-architecture/)

---

## 5. Other Tools

### Codeium / Windsurf

**Type:** VS Code extension + standalone IDE

**Key Features:**
- 70+ programming languages
- Free core tier (unlimited completions)
- Self-hosting option for privacy
- Rebranded to Windsurf

**Pricing:** Free core, $10/month for teams

**Best for:** Budget-conscious developers, beginners evaluating AI tools

**Limitation:** Cloud-dependent (requires internet), lacks deep agentic capabilities

### Tabnine

**Type:** VS Code/JetBrains extension (Enterprise security-focused)

**Key Features:**
- 100% on-premise deployment option
- Zero data transmission to external servers
- Custom-trained models on your codebase
- SOC 2, GDPR, HIPAA compliance

**Pricing:** Free (limited), paid for enterprise features

**Best for:** Regulated industries (finance, healthcare, defense) where cloud AI is not permitted

**2026 Update:** "Whole-Line Completion" evolved to multi-line generation powered by fine-tuned GPT variants

**Sources:**
- [Codeium vs Tabnine Comparison](https://www.f22labs.com/blogs/codeium-vs-tabnine-the-ultimate-2025-comparison-guide/)
- [AI Coding Tools Comparison](https://seedium.io/blog/comparison-of-best-ai-coding-assistants/)

---

## Comparison Matrix

| Feature | Continue.dev | Cursor | Cody | Copilot | Codeium | Tabnine |
|---------|-------------|--------|------|---------|---------|---------|
| **Type** | Extension | IDE | Extension | Extension | Extension/IDE | Extension |
| **Open Source** | Yes (Apache 2.0) | No | No | No | No | No |
| **Context Window** | Model-dependent | 272k tokens | Model-dependent | 64k-128k | Model-dependent | Model-dependent |
| **Codebase Indexing** | Embedding + rerank | Semantic indexing | Sourcegraph search | Limited | Yes | Yes |
| **Persistent Memory** | No | No | No | No | No | No |
| **Air-gapped Deployment** | Yes | No | Enterprise only | No | Yes (self-host) | Yes |
| **Project Rules** | `.continue/rules/` | `.cursor/rules/*.mdc` | Admin filters | `.github/copilot-instructions.md` | N/A | N/A |
| **Free Tier** | Yes | Yes (limited) | No (discontinued) | Yes (limited) | Yes | Yes (limited) |
| **Starting Paid** | $10/dev/mo | $20/mo | $59/user/mo | $10/mo | $10/mo teams | Paid enterprise |

---

## Persistent Memory: The Next Frontier

All major tools lack built-in persistent memory across sessions. This is being addressed by third-party solutions:

### Emerging Memory Solutions (2026)

1. **ContextStream** - MCP server for persistent memory, works with Cursor, Claude Code, VS Code
2. **MCP Backpack** - Lightweight memory layer, session summaries that persist indefinitely
3. **ContextForge** - Supports Claude Desktop, Claude Code, and now Cursor
4. **OneContext** - Self-managed persistent context layer for AI agents

### Research Direction

A February 2026 paper describes a three-component "codified context infrastructure":
1. Hot-memory constitution (conventions, retrieval hooks, protocols)
2. Specialized domain-expert agents (19 in their case)
3. Cold-memory knowledge base (on-demand specifications)

The prediction: "2026 is when 'agent memory' becomes a first-class MCP primitive, not a hack."

**Sources:**
- [ContextStream](https://contextstream.io/)
- [MCP Backpack Article](https://medium.com/codex/introducing-mcp-backpack-persistent-portable-memory-for-ai-coding-agents-87eea16eaa54)
- [Persistent Memory Research Paper](https://arxiv.org/abs/2602.20478)

---

## Key Takeaways for Framework Development

1. **Rules/Configuration**: Continue.dev and Cursor both use directory-based rules (`rules/`, `.mdc` files) that can be project-specific or global. This pattern is validated.

2. **Context Injection**: All tools inject context but none persist it across sessions natively. This is a differentiator opportunity.

3. **Extension vs IDE**: Extensions have limitations (no access to cursor position, recent edits, etc.). Cursor's fork approach gives deeper access.

4. **Monetization Models**:
   - Free tier + usage-based (Cursor credits, Copilot premium requests)
   - Seat-based enterprise (Cody, Copilot Business)
   - Open-source core + paid enterprise features (Continue.dev)

5. **The Memory Gap**: Every tool resets each session. Third-party MCP solutions are filling this gap. The framework's session-context.js and pre-compact.js hooks address exactly this unmet need.

---

*Research compiled: March 14, 2026*
