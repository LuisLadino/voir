# LLM Observability Systems: Architecture Deep Dive

Research on enterprise-grade LLM observability platforms to understand architectural patterns for building comparable systems.

---

## Executive Summary

All major LLM observability platforms share common architectural patterns:

1. **Instrumentation Layer**: SDK decorators, OpenTelemetry-based tracing, or proxy interception
2. **Data Model**: Traces containing spans/observations with LLM-specific attributes (tokens, costs, latency)
3. **Storage**: ClickHouse for analytical workloads, PostgreSQL for transactional data, Redis for queuing
4. **Processing**: Async ingestion pipelines to handle traffic spikes without blocking application code
5. **Metrics**: Computed aggregations for cost, latency percentiles, success rates

---

## 1. LangSmith (LangChain)

### Instrumentation

**Primary Method**: `@traceable` decorator and `RunTree` data structure

```python
from langsmith import traceable

@traceable
def my_function(input):
    # Creates a Run (span) automatically
    return process(input)
```

**How It Works**:
- Decorator creates a `RunTree` object on function entry
- Uses Python `ContextVar` (`_PARENT_RUN_TREE`) for parent/child linking
- Child runs inherit session_name and dotted ordering (e.g., "1.1" for first child of run "1")
- Context manager alternative: `tracing_context` for specific code blocks
- LangChain integration uses callback system (`LangChainTracer`)

**Async Architecture**:
- SDK uses async callback handler sending traces to distributed collector
- Application performance never impacted by LangSmith availability
- If LangSmith has incident, agent continues running

**Framework Support**: OpenAI SDK, Anthropic SDK, Vercel AI SDK, LlamaIndex, custom implementations

**Code Changes Required**:
- Single decorator per function
- Environment variables for configuration
- For non-LangChain: wrap LLM calls or use OpenTelemetry integration

### Data Model

**Run Structure** (analogous to OpenTelemetry spans):
```
Run {
  id: uuid
  parent_run_id: uuid | null
  run_type: "llm" | "chain" | "tool" | "retriever" | "agent"
  name: string
  inputs: dict
  outputs: dict
  events: [{ name, time, metadata }]
  extra: {
    metadata: dict,
    // auto-collected info
  }
  error: string | null
  start_time: timestamp
  end_time: timestamp
  session_name: string  // project
}
```

**Token/Cost Tracking**:
```
usage_metadata: {
  prompt_tokens: int
  completion_tokens: int
  total_tokens: int
  ls_provider: string  // "openai", "anthropic"
  ls_model_name: string  // "gpt-4.1-mini"
  total_cost: float  // optional pre-calculated
}
```

Thread-level aggregation requires consistent metadata (session_id, thread_id) on all child runs.

### Computed Metrics

- Token usage aggregation (by project, time, model)
- Cost breakdowns (uses model pricing maps)
- Latency: P50, P99
- Error rates
- Feedback scores
- Custom dashboard metrics via webhooks/PagerDuty alerts

### Deployment

- Managed cloud (US/EU regions)
- Bring-your-own-cloud (BYOC)
- Self-hosted

---

## 2. Langfuse (Open Source)

### Instrumentation

**Three Methods**:

1. **OpenTelemetry-native SDK (v3)**: Thin layer over official OTEL client
2. **Python/JS SDK decorators**: `@observe` decorator
3. **Direct API**: REST endpoints for trace ingestion

```python
from langfuse.decorators import observe

@observe()
def my_function():
    # Auto-creates observation
    pass
```

**OpenTelemetry Integration**:
- All traces are valid OTLP traces
- Can send to multiple destinations (Langfuse + Datadog)
- No vendor lock-in

### Data Model

**Hierarchy**:
```
Session (optional)
  └── Trace (single request/operation)
       └── Observation (steps within trace)
            ├── Span (unit of work)
            ├── Generation (LLM call)
            └── Event (point-in-time occurrence)
```

**Trace Attributes** (propagated to all observations):
- `user_id`
- `session_id`
- `metadata` (key-value store)
- `tags` (labels)
- `environment`
- `release` / `version`

**Observation Types**:
- **Span**: Generic operation with timing
- **Generation**: LLM input/output with token usage
- **Event**: Point-in-time marker

**V3 Observation-Centric Model**:
Context attributes (user_id, session_id, etc.) propagated to every observation to eliminate expensive joins between trace and observation tables.

### Storage Architecture

**Polyglot Persistence**:
- **PostgreSQL**: Users, orgs, projects, API keys, prompts, datasets, LLM-as-judge settings
- **ClickHouse**: Traces, observations, scores (OLAP workloads)
- **Redis**: Event queue (BullMQ), caching (API keys, prompts)
- **S3**: Raw ingestion events, multimodal attachments (images, audio)

**Why ClickHouse**:
- PostgreSQL bottlenecked at millions of rows for dashboards
- Aggregation queries timing out (30+ seconds)
- Column-oriented storage better for analytical queries
- Fast for single-row lookups with large binary columns

**Schema Design**:
- `ReplacingMergeTree` engine for eventual deduplication
- Updates converted to new inserts (expensive in ClickHouse)
- ProjectId + date as leading ordering key columns
- Skip indexes on frequently-filtered columns

### Ingestion Pipeline

**V3 Architecture**:
```
API Request → Authentication/Validation → Redis Queue → Async Worker → ClickHouse
                                              ↓
                                         S3 (raw events)
```

**Key Decisions**:
- API returns immediately after validation
- Redis buffers traffic spikes
- Workers handle CPU-intensive tasks (tokenization, DB writes)
- S3 stores complete event history for replay on errors
- Don't read from ClickHouse during ingestion (too expensive)

**Performance**:
- Prompts API latency: 7s → 100ms (via Redis caching + SDK prefetch)

### Cost Tracking

**Two-Tier Approach**:
1. Use explicit usage/cost from API response if provided
2. Fall back to tokenizers + pricing models

**Tokenizer Support**: OpenAI (tiktoken), Anthropic, others

**Pricing Tiers**: Context-dependent pricing (e.g., Claude Sonnet, Gemini 2.5 Pro) with regex patterns and threshold comparisons

**Usage Types**: Arbitrary strings ("input", "output", "cached_tokens", "audio_tokens", "image_tokens")

---

## 3. Helicone

### Instrumentation

**Primary Method**: Proxy-based (gateway architecture)

```javascript
// Change base URL from:
api.openai.com
// To:
oai.helicone.ai
```

**Two Integration Modes**:

| Feature | Proxy | Async |
|---------|-------|-------|
| Setup | One-line URL change | SDK integration |
| Critical Path | Yes | No |
| Latency Impact | 50-80ms | Zero propagation delay |
| Gateway Features | Full (caching, rate limiting, retries) | Limited |
| Resilience | Depends on Helicone | Helicone outage doesn't affect app |

**Gateway Features** (proxy only):
- Caching (semantic caching, bucket caching)
- Rate limiting
- API key management
- Threat detection
- Moderations
- Automatic fallbacks

### Storage Architecture

**Distributed System**:
- **Cloudflare Workers**: Edge compute for proxy
- **Kafka**: Event streaming backbone
- **ClickHouse**: Analytical storage (3M+ requests/day)
- **Redis**: Caching
- **S3**: Object storage

**Migration from Postgres**:
- Dashboard queries: 100+ seconds → 0.5 seconds
- Dual-insertion: Write to both Postgres and ClickHouse
- `pgv2cht`: Open-source tool for syncing Postgres views to ClickHouse

**Scale**: 2+ billion LLM interactions processed

### Self-Hosting

**Simplified Architecture** (4 containers):
1. Main Application Container
2. ClickHouse Database
3. Authorization Container
4. (Optional) S3-compatible storage

**Enterprise**: Helm charts for Aurora + dedicated ClickHouse cluster

---

## 4. Weights & Biases Weave

### Instrumentation

**Primary Method**: `@weave.op` decorator

```python
import weave

weave.init("my-project")

@weave.op
def my_function(input):
    # Auto-traced
    return output
```

**Auto-Patching**: `weave.init()` automatically patches supported LLM libraries (OpenAI, etc.)

**OpenTelemetry Support**: Send OTEL data directly to Weave (any backend language)

### Data Model

**Trace Structure**:
- Organizes logs into trace tree
- Parent/child relationships
- Metrics aggregated at every level

**Captured Data**:
- Inputs/outputs
- Token usage
- Cost
- Latency
- Code/metadata
- Images, audio, datasets (video coming)

### Storage Architecture

**Backend**: ClickHouse

**Self-Hosted Components**:
- Altinity ClickHouse Operator (Kubernetes)
- ClickHouse Keeper (coordination, replaces ZooKeeper)
- ClickHouse Cluster (high-availability)
- S3-compatible storage (data persistence)

**Cloud Deployment Options**:
- **SaaS**: Shared ClickHouse Cloud cluster, cloud-native encryption
- **Dedicated Cloud**: Unique ClickHouse Cloud cluster in chosen region, IP allowlisting

**Scalability**: Handles billions of records, columnar storage for low-latency queries

---

## 5. Arize Phoenix (Open Source)

### Instrumentation

**Foundation**: OpenTelemetry + OpenInference specification

```python
from openinference.instrumentation import instrument

instrument()  # Auto-patches supported frameworks
```

**Framework Support**: OpenAI Agents SDK, Claude Agent SDK, LangGraph, Vercel AI SDK, Mastra, CrewAI, LlamaIndex, DSPy

**Collector Endpoints**:
- HTTP OTLP
- gRPC OTLP (port 4317)

### Data Model

**OpenInference Semantic Conventions**:

| Category | Attributes |
|----------|------------|
| Messages | `llm.input_messages.<i>.message.role/content` |
| Tokens | `llm.token_count.prompt/completion/total` |
| Cache | `llm.token_count.prompt_details.cache_read/write` |
| Model | `llm.system`, `llm.provider`, `llm.model_name` |
| Parameters | `llm.invocation_parameters` (JSON) |
| Prompt | `llm.prompt_template.template/variables` |
| Tools | `llm.tools.<i>.tool.json_schema/name` |
| Tool Calls | `message.tool_calls.<i>.tool_call.function.name/arguments` |
| Cost | `llm.cost.prompt/completion/total` |
| Embeddings | `embedding.model_name/vector/text` |
| Retrieval | `retrieval.documents` |

**Span Kinds**: LLM, CHAIN, TOOL, RETRIEVER, EMBEDDING, RERANKER, GUARDRAIL

### Storage Architecture

**Database Options**:
- **SQLite**: Default, file-based (~/.phoenix/)
- **PostgreSQL**: Production deployments (v14+)

**Arize AX (Enterprise)** uses proprietary `adb` database:
- Parquet/Iceberg-backed storage
- Arrow-native query layer
- Apache Flight for direct file access
- Battle-tested on petabytes, trillions of events

**Processing**:
- Queue-based bulk insertion pipeline
- Processes spans before database storage

---

## Computed Metrics Comparison

| Metric | LangSmith | Langfuse | Helicone | Weave | Phoenix |
|--------|-----------|----------|----------|-------|---------|
| Token Usage | Yes | Yes | Yes | Yes | Yes |
| Cost (auto) | Yes | Yes | Yes | Yes | Yes |
| Latency P50/P99 | Yes | Yes | Yes | Yes | Yes |
| Error Rates | Yes | Yes | Yes | Yes | Yes |
| Custom Metrics | Dashboard | API | Dashboard | Yes | Evaluations |
| Feedback Scores | Yes | Yes (Scores) | Yes | Yes | Yes |
| Caching Stats | No | No | Yes | No | No |

---

## Real-Time vs Batch Processing

| Platform | Ingestion | Processing | Dashboard Updates |
|----------|-----------|------------|-------------------|
| LangSmith | Async callbacks | Background | Near real-time |
| Langfuse | Async via Redis queue | Workers | Near real-time |
| Helicone | Proxy (sync) or Async | Kafka streaming | Real-time |
| Weave | Auto-patch (sync) or OTEL | Background | Near real-time |
| Phoenix | OTLP streaming | Queue-based bulk | Near real-time |

**Common Pattern**: All platforms decouple trace capture from storage/processing to avoid impacting application performance.

---

## Architecture Patterns for Building Comparable Systems

### 1. Instrumentation Layer

**Options**:
- Python decorators using `functools.wraps` + context vars
- Monkey-patching popular SDKs (OpenAI, Anthropic)
- OpenTelemetry integration (standard, portable)
- Proxy/gateway (zero code changes)

**Key Considerations**:
- Async callbacks to avoid blocking
- Context propagation for parent/child relationships
- Minimal overhead in critical path

### 2. Data Model

**Essential Schema**:
```
Trace {
  trace_id: uuid
  project_id: string
  user_id: string?
  session_id: string?
  metadata: json
  tags: string[]
  created_at: timestamp
}

Span {
  span_id: uuid
  trace_id: uuid
  parent_span_id: uuid?
  span_type: "llm" | "chain" | "tool" | "retriever" | "embedding"
  name: string
  input: json
  output: json
  start_time: timestamp
  end_time: timestamp

  // LLM-specific
  model_name: string?
  model_provider: string?
  prompt_tokens: int?
  completion_tokens: int?
  total_tokens: int?
  cost: decimal?

  // Metadata
  metadata: json
  error: string?
}
```

### 3. Storage

**Recommended Stack**:
- **ClickHouse**: Traces, spans, scores (analytical queries)
- **PostgreSQL**: Users, projects, API keys, prompts (transactional)
- **Redis**: Queue buffer, caching
- **S3**: Raw events, multimodal content

**ClickHouse Tips**:
- Use `ReplacingMergeTree` for mutable data
- Partition by date + project
- Skip indexes on filtered columns
- Avoid reads during ingestion

### 4. Ingestion Pipeline

```
SDK/Proxy → API Gateway → Validation → Redis Queue → Worker Pool → ClickHouse
                                            ↓
                                       S3 (backup)
```

**Design Principles**:
- Return fast from API (validation only)
- Buffer with queue for traffic spikes
- Process heavy work (tokenization, cost calc) async
- Store raw events for replay

### 5. Metrics Computation

**Pre-computed** (on ingestion):
- Token counts
- Cost (using pricing tables)
- Duration

**Aggregated** (on query):
- Latency percentiles (P50, P95, P99)
- Success/error rates
- Cost by model/user/time

**ClickHouse Aggregations**:
```sql
SELECT
  model_name,
  quantile(0.50)(duration_ms) as p50,
  quantile(0.99)(duration_ms) as p99,
  sum(cost) as total_cost,
  countIf(error IS NOT NULL) / count() as error_rate
FROM spans
WHERE created_at > now() - INTERVAL 1 DAY
GROUP BY model_name
```

---

## Key Takeaways

1. **ClickHouse is the industry standard** for LLM observability storage (Langfuse, Helicone, Weave all use it)

2. **Async ingestion is critical** - never block application code for observability

3. **OpenTelemetry compatibility** enables integration with existing infrastructure

4. **OpenInference semantic conventions** provide standardized LLM-specific attributes

5. **Polyglot persistence** - use the right database for each workload type

6. **Gateway/proxy pattern** offers simplest integration (URL change) but adds latency

7. **Cost tracking** requires maintained pricing tables for all model providers

---

## Sources

### LangSmith
- [LangSmith Tracing Deep Dive](https://medium.com/@aviadr1/langsmith-tracing-deep-dive-beyond-the-docs-75016c91f747)
- [LangSmith Documentation](https://docs.smith.langchain.com/)
- [LangSmith SDK GitHub](https://github.com/langchain-ai/langsmith-sdk)
- [Cost Tracking Docs](https://docs.langchain.com/langsmith/cost-tracking)

### Langfuse
- [Langfuse Data Model](https://langfuse.com/docs/observability/data-model)
- [Langfuse V3 Infrastructure Evolution](https://langfuse.com/blog/2024-12-langfuse-v3-infrastructure-evolution)
- [Langfuse GitHub](https://github.com/langfuse/langfuse)
- [ClickHouse Integration Blog](https://clickhouse.com/blog/langfuse-and-clickhouse-a-new-data-stack-for-modern-llm-applications)
- [Token and Cost Tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking)

### Helicone
- [Helicone GitHub](https://github.com/Helicone/helicone)
- [Proxy vs Async Docs](https://docs.helicone.ai/references/proxy-vs-async)
- [Self-Hosting Journey](https://www.helicone.ai/blog/self-hosting-journey)
- [ClickHouse Migration Story](https://clickhouse.com/blog/helicones-migration-from-postgres-to-clickhouse-for-advanced-llm-monitoring)

### Weights & Biases Weave
- [Weave GitHub](https://github.com/wandb/weave)
- [Weave Documentation](https://docs.wandb.ai/weave)
- [W&B + ClickHouse](https://clickhouse.com/blog/weights-and-biases-scale-ai-development)

### Arize Phoenix
- [Phoenix GitHub](https://github.com/Arize-ai/phoenix)
- [Phoenix Documentation](https://arize.com/docs/phoenix)
- [OpenInference Semantic Conventions](https://arize-ai.github.io/openinference/spec/semantic_conventions.html)
- [OpenInference GitHub](https://github.com/Arize-ai/openinference/)

### General
- [OpenTelemetry LLM Observability](https://opentelemetry.io/blog/2024/llm-observability/)
- [LLM Observability with OpenTelemetry Metrics](https://oneuptime.com/blog/post/2026-02-06-llm-observability-dashboard-opentelemetry-metrics/view)
