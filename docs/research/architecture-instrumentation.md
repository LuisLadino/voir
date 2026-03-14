# AI Observability: Instrumentation and Data Collection Patterns

Research on how observability tools actually capture data from AI assistants and LLM applications.

---

## 1. SDK/Library Instrumentation

### LangSmith (LangChain Native)

LangSmith provides native observability for LangChain applications using multiple instrumentation methods:

**Decorators:**
- `@traceable` decorator for general Python functions
- `@chain` decorator for LangChain-integrated functions
- Uses run-tree data structure to capture each step as a traceable run
- Works with non-LangChain code via `@traceable` decorator and RunTree API

**Callbacks System:**
- Core mechanism for observability in LangChain
- `LangChainTracer` callback handler logs traces
- Tracks execution flow, debugging, logging
- Integration done via environment variables:
  ```bash
  LANGCHAIN_TRACING_V2="true"
  LANGCHAIN_API_KEY="your-key"
  ```

**Automatic vs Manual:**
- Automatic: Environment variables enable tracing globally
- Manual: Passing `LangChainTracer` instance as callback
- Context manager: `tracing_context` for scoped tracing

**Source:** [LangSmith Tracing Deep Dive](https://medium.com/@aviadr1/langsmith-tracing-deep-dive-beyond-the-docs-75016c91f747)

### Langfuse Integration

Langfuse uses LangChain's callback system for integration:

```python
from langfuse.langchain import CallbackHandler
langfuse_handler = CallbackHandler()

# Pass to chain invocation
response = chain.invoke(
    {"topic": "cats"},
    config={"callbacks": [langfuse_handler]}
)
```

**Key Features:**
- Callback handler plugs into LangChain's event system
- Every chain run or LLM call emits events
- Handler converts events into traces and observations
- Supports custom trace IDs via `run_id` config
- Works with LangGraph for agent tracing

**Advanced Integration:**
```python
@observe()  # Langfuse decorator
def my_function():
    handler = langfuse_context.get_current_langchain_handler()
    # Handler scoped to current trace context
```

**Source:** [Langfuse LangChain Integration](https://langfuse.com/integrations/frameworks/langchain)

---

## 2. Proxy-Based Collection

### Helicone Architecture

Helicone uses a proxy architecture for LLM observability:

**How It Works:**
1. Change base URL to point to Helicone
2. Requests route through Helicone proxy
3. Proxy forwards to LLM provider
4. Response flows back through Helicone
5. Logs requests/responses for analytics

**Infrastructure:**
- Built on Cloudflare Workers
- ClickHouse for analytics storage
- Kafka for event streaming
- Minio for log object storage
- Processed 2+ billion LLM interactions

**Latency Overhead:**
- Average 50-80ms additional latency
- Sits on network edge

**Benefits:**
- Simple integration (just change base URL)
- Gateway features: caching, rate limiting, API key management
- Threat detection, moderation
- Works with any LLM provider

**Limitations:**
- Adds network hop
- Data passes through third-party infrastructure
- Not suitable for air-gapped environments

### Async Integration Alternative

Helicone also supports async logging:
- Logging not on critical path
- Zero propagation delay
- Network issues don't affect application
- Events sent asynchronously after request completes

**Source:** [Helicone Proxy vs Async](https://docs.helicone.ai/references/proxy-vs-async)

---

## 3. API Wrapping / Monkey-Patching

### OpenTelemetry Auto-Instrumentation

OpenTelemetry Python uses monkey-patching for zero-code instrumentation:

```bash
pip install opentelemetry-distro opentelemetry-exporter-otlp
opentelemetry-bootstrap -a install
```

**How It Works:**
- Python agent attaches to application
- Monkey-patches library functions at runtime
- Captures telemetry from popular libraries
- No code changes required

### OpenAI-Specific Instrumentation

**opentelemetry-instrumentation-openai:**
```python
from opentelemetry.instrumentation.openai import OpenAIInstrumentor
OpenAIInstrumentor().instrument()
```

Features:
- Traces prompts, completions, embeddings
- Logs to span attributes
- Privacy control: `TRACELOOP_TRACE_CONTENT=false`

**opentelemetry-instrumentation-openai-v2 (Official):**
- Captures message content as log events
- Tracks duration and token usage as metrics
- Environment variable: `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`

### OpenLLMetry by Traceloop

Open-source extensions built on OpenTelemetry:

**Automatic Detection:**
- Detects and instruments LLM provider SDKs
- No manual span creation required
- Captures latency, token usage, costs, prompts/responses

**Supported Providers:**
- LLMs: OpenAI, Anthropic, Gemini, Bedrock, Ollama (20+ providers)
- Vector DBs: Pinecone, Chroma, Weaviate
- Frameworks: LangChain, LlamaIndex, CrewAI

**Source:** [OpenLLMetry GitHub](https://github.com/traceloop/openllmetry)

### Datadog LLM Observability

Uses `ddtrace` for auto-instrumentation:

```bash
pip install ddtrace
DD_LLMOBS_ENABLED=1 DD_LLMOBS_ML_APP="my-app" ddtrace-run python app.py
```

**Supported Integrations:**
- OpenAI (including streaming)
- Amazon Bedrock (InvokeModel, Converse)
- Vertex AI
- Pydantic AI
- OpenAI Agents SDK

**What's Captured:**
- Latency, errors, input parameters
- Input/output messages
- Token usage (when available)

**Source:** [Datadog Auto Instrumentation](https://docs.datadoghq.com/llm_observability/instrumentation/auto_instrumentation/)

---

## 4. OpenTelemetry GenAI Semantic Conventions

Standardized schema for AI observability:

**Signal Types:**
- Events: Generative AI inputs and outputs
- Metrics: Operation-level metrics
- Model spans: Individual model operations
- Agent spans: Agent-level operations

**Key Attributes:**
- Prompts and model responses
- Token usage (input, output)
- Tool/agent calls
- Provider metadata
- Time per output token

**Provider-Specific Conventions:**
- Anthropic
- Azure AI Inference
- AWS Bedrock

**Stability:**
- Environment variable: `OTEL_SEMCONV_STABILITY_OPT_IN`
- Datadog supports v1.37+ natively

**Metrics Defined:**
- `time_per_output_token`: Model server latency per token
- Measures decode phase performance

**Source:** [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)

---

## 5. IDE/Extension Integration

### VS Code AI Agent Ecosystem

**Third-Party Agent Support (VS Code 1.109+):**
- Run Claude and Codex agents locally or in cloud
- Unified agent sessions management
- Claude uses official Claude Agent harness by Anthropic
- Same prompts, tools, architecture as other Claude implementations

**claude-copilot Extension:**
- Bridges external AI tools with VS Code Language Model API
- Dual API compatibility (OpenAI + Anthropic)
- Creates local OpenAI-compatible API endpoint at `http://localhost:59603`
- MCP integration with dynamic tool discovery

**Intercepting AI Assistant Calls:**
- VS Code extensions can wrap Language Model API calls
- Third-party agents visible through unified interface
- Hand-off between agents possible (local -> cloud)

**Limitations:**
- Direct Copilot API interception not publicly documented
- Claude Code connects directly to Anthropic API
- Extension conflicts possible (Cline, Continue, etc.)

**Source:** [VS Code Third-Party Agents](https://code.visualstudio.com/docs/copilot/agents/third-party-agents)

---

## 6. Hook-Based Systems (Claude Code)

### Claude Code Hooks Architecture

Hooks are deterministic automation points in Claude Code's lifecycle:

**Event Types (17+ events):**

| Event | When Fired | Can Block? |
|-------|------------|------------|
| SessionStart | Session begins/resumes | No |
| UserPromptSubmit | Before prompt processing | Yes |
| PreToolUse | Before tool execution | Yes |
| PostToolUse | After tool succeeds | No |
| PostToolUseFailure | After tool fails | No |
| SubagentStart | Subagent spawned | No |
| SubagentStop | Subagent finishes | Yes |
| Stop | Claude finishes responding | Yes |
| PreCompact | Before context compaction | No |
| SessionEnd | Session terminates | No |

**Handler Types:**

1. **Command Hooks:**
   ```json
   {
     "type": "command",
     "command": "path/to/script.sh"
   }
   ```
   - Input: JSON via stdin
   - Output: Exit code + stdout/stderr
   - Async support available

2. **HTTP Hooks:**
   ```json
   {
     "type": "http",
     "url": "http://localhost:8080/hooks/event"
   }
   ```
   - Input: JSON as POST body
   - Output: HTTP response

3. **Prompt Hooks:**
   - Send prompt to Claude for evaluation
   - Single-turn evaluation
   - Returns `{ok: true/false, reason: "..."}`

4. **Agent Hooks:**
   - Spawn subagent with tool access
   - For complex verification requiring tools

### Data Available at Each Hook

**Common Fields (all events):**
```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/dir",
  "permission_mode": "default|plan|acceptEdits",
  "hook_event_name": "EventName"
}
```

**Tool Events (PreToolUse/PostToolUse):**
```json
{
  "tool_name": "Edit|Write|Bash|...",
  "tool_input": { /* tool-specific params */ },
  "tool_response": { /* result data */ },
  "tool_use_id": "toolu_01ABC..."
}
```

**Tool-Specific Inputs:**
- Bash: command, description, timeout, run_in_background
- Write/Edit: file_path, content, old_string, new_string
- Read: file_path, offset, limit
- Glob/Grep: pattern, path, output_mode
- WebFetch: url, prompt
- WebSearch: query, allowed_domains, blocked_domains

### Example: Universal Tool Tracker

From claude-dev-framework's `tool-tracker.cjs`:

```javascript
function handleHook(data) {
  const { tool_name, tool_input, tool_response, session_id } = data;

  const entry = {
    timestamp: new Date().toISOString(),
    tool: tool_name,
    success: true,  // PostToolUse only fires on success
  };

  // Extract relevant info per tool type
  switch (tool_name) {
    case 'Skill':
      entry.skill = tool_input?.skill;
      entry.args = tool_input?.args;
      break;
    case 'Read':
      entry.file = tool_input?.file_path;
      break;
    case 'Bash':
      entry.command = truncate(tool_input?.command, 100);
      break;
    // ... more cases
  }

  tracking.tools.push(entry);
  saveSessionTracking(sessionId, tracking);
}
```

### Security Considerations

- Hooks captured at session startup
- Modifications during session don't take effect
- Prevents mid-session malicious changes
- Defensive error handling ensures hooks don't block Claude

**Source:** [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)

---

## 7. Privacy and Sensitive Data Handling

### The PII Challenge

LLM observability systems face unique privacy challenges:
- LLMs may memorize and regenerate sensitive PII
- Unstructured prompts contain information-rich data
- Telemetry pipelines become PII repositories
- Compliance risk under GDPR, CCPA

### Approaches

**1. Pre-Processing Redaction:**
- Intercept text before sending to LLM
- Inspect responses after receiving
- Log detection events for compliance auditing

**2. Langfuse Masking:**
```python
def my_masking_function(data):
    # Custom redaction logic
    return masked_data

langfuse_client = Langfuse(masking_function=my_masking_function)
```
- Applied to all event inputs, outputs, metadata
- Only masked data transmitted to server
- Fine-grained filtering based on requirements

**3. AI Gateway Approach:**
- Central proxy between apps and AI models
- Strategic control plane for policy enforcement
- Inspects traffic in both directions
- Catches LLM-hallucinated PII in responses

**4. OpenTelemetry PII Redaction:**
- Custom PII-Redaction Processor for OTel Collector
- Sanitizes telemetry data in-transit
- Configurable "Safe Observability" paradigm

### Tools and Libraries

**Presidio (Microsoft):**
- Open-source PII detection and anonymization
- Named entity recognition (NER)
- Regular expressions
- Checksum validation

**LLM Guard:**
- Anonymize Scanner for prompt protection
- Detects PII before LLM submission
- Prevents identity theft risk

### Best Practices

1. **Multi-point Interception:** Before sending, after receiving
2. **Entity Recognition:** Automated PII/PHI detection
3. **Anonymization vs Pseudonymization:**
   - Anonymization: Irreversible removal
   - Pseudonymization: Reversible tokens (preserves utility)
4. **Compliance Auditing:** Log all detection events
5. **Local vs Cloud Processing:**
   - Local: Full control, no data leaving premises
   - Cloud: Easier scaling, trust required

**Source:** [Langfuse Masking](https://langfuse.com/docs/observability/features/masking), [LLM Guard](https://llm-guard.com/input_scanners/anonymize/)

---

## 8. Architecture Comparison Matrix

| Approach | Latency Impact | Code Changes | Data Control | Completeness |
|----------|----------------|--------------|--------------|--------------|
| SDK Decorators | Minimal | Required | High | Per-decorated functions |
| Callbacks | Minimal | Required | High | Framework-scoped |
| Proxy | 50-80ms | Minimal (URL) | Medium | All API traffic |
| Monkey-patching | Minimal | None | High | Library-scoped |
| Hooks | ~0ms | Config only | High | Claude Code only |
| OTel Auto | Minimal | Bootstrap only | High | Supported libraries |

---

## 9. Implications for Our VS Code Extension

### Recommended Approach: Hook-Based + Local Storage

**Why Hooks:**
1. Zero latency impact (runs after tool execution)
2. Access to complete tool input/output data
3. No code changes to user's workflow
4. Works with Claude Code out of the box
5. Session-aware (session_id provided)

**What We Can Capture:**
- All tool calls (file ops, bash, web searches)
- Skill/command invocations
- MCP tool usage (context7, etc.)
- Success/failure status
- Session duration and activity

**What We Cannot Capture:**
- Raw LLM prompts/responses (not exposed in hooks)
- Token usage (not in PostToolUse data)
- Internal Claude reasoning

### Architecture Recommendation

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Extension                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │ Hook Events  │───►│ Event        │───►│ Local        │   │
│  │ (stdin JSON) │    │ Processor    │    │ SQLite DB    │   │
│  └──────────────┘    └──────────────┘    └──────────────┘   │
│         │                    │                    │          │
│         │                    ▼                    ▼          │
│         │           ┌──────────────┐    ┌──────────────┐   │
│         │           │ PII Scanner  │    │ Webview UI   │   │
│         │           │ (local)      │    │ (charts,     │   │
│         │           └──────────────┘    │  timelines)  │   │
│         │                               └──────────────┘   │
│         │                                                   │
│         ▼                                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Optional: Langfuse/Helicone export for teams        │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Privacy-First Design

1. **Local-Only by Default:**
   - All data stored in SQLite in workspace
   - No external API calls without explicit opt-in

2. **PII Handling:**
   - File paths: Already captured, can redact sensitive paths
   - Command content: Truncate long commands
   - No LLM content captured (not available in hooks)

3. **Optional Cloud Sync:**
   - Langfuse export for team visibility
   - User controls what gets exported
   - Masking function applied before export

---

## Sources

- [LangSmith Tracing Deep Dive](https://medium.com/@aviadr1/langsmith-tracing-deep-dive-beyond-the-docs-75016c91f747)
- [Langfuse LangChain Integration](https://langfuse.com/integrations/frameworks/langchain)
- [Helicone Proxy vs Async](https://docs.helicone.ai/references/proxy-vs-async)
- [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OpenLLMetry GitHub](https://github.com/traceloop/openllmetry)
- [Datadog Auto Instrumentation](https://docs.datadoghq.com/llm_observability/instrumentation/auto_instrumentation/)
- [VS Code Third-Party Agents](https://code.visualstudio.com/docs/copilot/agents/third-party-agents)
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Langfuse Masking](https://langfuse.com/docs/observability/features/masking)
- [LLM Guard Anonymize](https://llm-guard.com/input_scanners/anonymize/)
