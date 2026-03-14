# Data Evaluation and Analysis Methods in AI Tooling

Research on how observability and analytics tools help users evaluate and analyze AI/LLM data - from raw traces to actionable insights.

---

## 1. Dashboards and Metrics

### LangSmith

**Pre-built Views:**
- Dashboard with overview of recent runs, summaries, and high-level statistics with customizable widgets
- Runs view with detailed individual executions (inputs, outputs, metadata, execution time, token usage)
- Traces view with step-by-step inspection and hierarchical visualization
- Projects for organizing runs
- Datasets for test dataset management and benchmarking

**Default Metrics:**
- Token usage and cost breakdowns
- Latency (P50, P99)
- Error rates
- Success rates
- Feedback scores
- Latency distribution over time

**Customization:**
- Custom dashboards tracking specific metrics
- Configurable widgets
- Alert configuration via webhooks or PagerDuty

### Langfuse

**Pre-built Views:**
- Latency Dashboard: Monitor response times across models and user segments
- Cost Dashboard: Track token usage and costs over time
- Usage Dashboard: Platform utilization metrics

**Custom Dashboards:**
- Self-service analytics built on powerful query engine
- Multi-level aggregations across tracing data
- Personalized views for different teams (latency optimization, cost monitoring, quality, user behavior)

**Data Model:**
- Observation-centric model where context attributes (user_id, session_id, metadata, tags) propagate to every observation
- Eliminates expensive joins, enabling single-table queries at scale

### Weights & Biases (Weave)

**Automatic Tracking (via @weave.op decorator):**
- Token usage and cost calculations
- Response times and latency monitoring
- Accuracy metrics (predictions vs expected results)
- Error tracking with failure reasons
- Automatic versioning of configurations

**LLM-Specific Metrics:**
- Perplexity
- BLEU score
- Custom evaluation dashboards

**Response Metrics:**
- Answer Correctness (vs reference)
- Answer Factfulness (context consistency)
- Answer Similarity (semantic resemblance)

**Context Metrics (for RAG):**
- Context Precision (ranking of relevant items)
- Context Recall (alignment with annotated answers)

**System Monitoring:**
- GPU utilization
- Memory consumption
- Temperature monitoring

### Arize Phoenix

**Tracing & Observability:**
- Trace-level monitoring with prompt inputs, model parameters, completions, latency per span
- Structured traces composed of spans (retrieval, inference, post-processing)
- Full execution path reconstruction

**Evaluation Hub (New in 2026):**
- Centralized system for creating, versioning, reusing evaluators
- Commit-level version control
- Integrations with Phoenix evals, Ragas, Deepeval, Cleanlab

**Prompt Management:**
- Version control for prompts
- Test variants across datasets
- Span Replay for debugging

---

## 2. Querying and Filtering

### Langfuse Query Capabilities

**SDK/API Querying:**
```python
traces = langfuse.api.trace.list(
    limit=100,
    user_id="user_123",
    tags=["production"]
)
```

**Metrics API (v2):**
- Specify dimensions, metrics, filters, time granularity
- Optimized data architecture on events table schema
- Significant performance improvements

**Filter Dimensions:**
- **Metadata Filters:** Custom metadata on traces/observations
- **Time-Based:** Specific periods, compare ranges
- **User Properties:** Segment by characteristics and behavior
- **Model Parameters:** Filter by model configurations/versions
- **Tags and Labels:** Categorical filtering

**Full-Text Search:**
- Search inputs/outputs of traces and observations (requires v3+)
- Full-text search on dataset items
- Search for specific content within traces

### LangSmith Query Capabilities

**UI Filtering:**
- Run history filtering
- Latency, token usage, cost per run views
- "Threads" feature clusters similar conversations

**Exploration:**
- Identify systemic issues vs one-off failures
- Pattern detection across user conversations

### Sessions/Conversations

**Langfuse:**
- Traces (single request/operation)
- Observations (individual steps inside trace)
- Sessions (group related traces, e.g., user conversation)

**LangSmith:**
- Threads for clustering similar conversations
- Multi-step workflow tracking

---

## 3. Comparison and Benchmarking

### A/B Testing

**Langfuse:**
- Open Source Prompt Management with A/B testing
- Systematically test and improve prompts
- Performance benchmarks for prompt retrieval latency (cached client-side)

**LangSmith:**
- A/B-style prompt experiments
- Compare prompt versions with performance percentages
- Playground for visual testing without code
- LangSmith reported to reduce deployment times by up to 30%

### Benchmarking Features

**LangSmith:**
- Run evaluations on curated datasets during development
- Compare experiments for benchmarking, unit tests, regression tests, backtesting
- Version comparison with performance metrics

**Langfuse:**
- Advanced analytics: precision, recall, latency, error rates
- Prompt management performance benchmarking

### Evaluation Scoring

**Both platforms offer:**
- LLM-as-a-judge scoring
- Prompt comparison metrics
- Labeled dataset benchmarks
- Before/after analysis capabilities

---

## 4. Alerting and Anomaly Detection

### Threshold-Based Alerting

**Budget/Cost:**
- Alert at 50%, 80%, 100% of budget thresholds
- Prevent runaway prompts burning resources

**Quality Scores:**
- Alert when hallucination evals score below threshold (e.g., <3 on >5% of traces/hour)
- Score-based triggers requiring investigation

**Latency/Errors:**
- 2-second latency threshold examples
- Error rate spike detection

### Quality-Aware Alerting (Evaluation-Based)

Triggers based on drops in:
- Faithfulness (via LLM-as-a-judge)
- Relevance scores
- Safety metrics
- Heuristics (latency, cost, error spikes)

Key insight: Without quality-based alerting, degradation can be invisible since infrastructure metrics may show no anomalies.

### LLM-Powered Anomaly Detection (2026)

**Advanced Approaches:**
- LLMs ingesting logs, metrics, traces in real-time
- Learn patterns of healthy behavior
- Flag anomalies before cascading into failures
- Parse unstructured log text and correlate with structured metrics
- Context understanding like a seasoned engineer

**vs Traditional:**
- Rule-based thresholds = obvious spikes only
- LLM-based = nuanced drift detection

### Monitoring Categories

**Platforms track:**
- Bias, toxicity, hallucination using statistical models/rules
- Moderation policy violations
- Safety threshold breaches
- Embedding drift (semantic behavior shifts over time)

### Leading Platforms (2026)

Braintrust, Langfuse, LangSmith, Confident AI, Arize AI, Helicone, Maxim AI, Datadog

---

## 5. Export and Integration

### Langfuse

**Export Options:**
- UI export for analysis and fine-tuning
- Comprehensive API (frequently used for bespoke LLMOps workflows)
- API-first design - treat observability data as your own

**BI Tools:**
- Power BI integration via Metrics API endpoint
- Consume high-level tracing metrics

**Self-Hosting:**
- MIT-licensed, full self-host (Postgres + ClickHouse + web app)
- Full data sovereignty

**Standards:**
- OpenTelemetry support
- Framework-agnostic (LangChain, LlamaIndex, LiteLLM, DSPy, any Python/TypeScript)

### LangSmith

**Characteristics:**
- SaaS-only workflow
- Fixed schema, strong LangChain ties
- Deep native integration for LangChain/LangGraph agents
- Hub extension

### Helicone

**Export:**
- Export to PostHog in one line for custom dashboards
- Proxy-based logging (change base URL, no SDK)
- Logs requests, responses, tokens, costs

**Architecture:**
- Cloudflare Workers + ClickHouse + Kafka
- 2 billion+ LLM interactions processed
- 50-80ms average latency overhead

### Arize Phoenix

**Deployment:**
- Local machine, Jupyter notebook, containerized, cloud
- Docker Hub images
- Cloud at app.phoenix.arize.com
- AWS Marketplace, Azure Marketplace
- Amazon Bedrock Agents, Azure AI Studio integration

**Standards:**
- Built on OpenTelemetry
- Fully open source, self-hostable, no feature gates

---

## 6. Evaluation Frameworks

### Braintrust

**Philosophy:**
- Only platform connecting all stages: dataset management → scoring → production monitoring → CI-based release enforcement
- Combines code-based metrics (fast, cheap, deterministic) with LLM-as-judge (subjective criteria)

**LLM-as-Judge Implementation:**
- Frontier models (GPT-5, Claude) produce most reliable judgments
- Judge model should be at least as capable as evaluated model
- Clear rubrics with specific success/failure conditions
- Chain-of-thought in scorer prompts for reasoning transparency

**Scorers Available:**
- LLM-as-judge
- Factuality
- Coherence
- Toxicity
- AutoEvals library

**AI-Assisted (Loop):**
- Generates eval components from production data
- Non-technical teammates draft scorers by describing failure modes in plain language

**Compliance:**
- SOC 2 Type II, HIPAA, GDPR
- Used by Notion, Dropbox, Zapier, Coursera

### Promptfoo

**Core Features:**
- CLI and library for evaluating and red-teaming LLM apps
- 10.3k GitHub stars, 300k+ developers, 127 Fortune 500 companies

**Assertion Types:**
- Exact match
- Substring checks
- JSON schema compliance
- Semantic similarity
- Regex patterns
- LLM-graded rubrics

**Red Teaming:**
- 50+ vulnerability types
- Direct/indirect prompt injection, jailbreaks, PII leaks, tool misuse, toxic content
- Context-aware adversarial input generation

**Provider Support:**
- OpenAI, Anthropic, Azure, Google, Bedrock, Ollama, Hugging Face, custom endpoints
- Write once, run everywhere

**CI/CD Integration:**
- Catch regressions early
- Automated red teaming and vulnerability detection
- Quality gates with minimum thresholds
- OWASP and NIST compliance reports
- Cost control tracking

**Licensing:**
- MIT (open-source core)
- Commercial tier for enterprise (SOC2, ISO 27001)

### DeepEval

**Core:**
- "Pytest for LLMs" - unit testing LLM outputs
- 50+ LLM-evaluated metrics (research-backed, multi-modal)
- RAG, agents, chatbots, any use case
- End-to-end and component-level evaluation

**Metrics Techniques:**
- QAG (question-answer-generation)
- DAG (deep acyclic graphs)
- G-Eval (LLM-as-judge with CoT)
- All metrics output 0-1 score + reasoning

**Agent Metrics (2026):**
- Tool correctness
- Argument correctness
- Step efficiency
- Plan adherence
- Plan quality

**G-Eval Custom:**
- Most versatile metric
- ANY custom criteria
- Human-like accuracy
- Chain-of-thought evaluation

**Integration:**
- Native Pytest integration
- CI workflows
- OpenAI Agents, LangChain, CrewAI support
- Free and open source (pay only for LLM API costs)

**Platform (Confident AI):**
- Enterprise AI quality platform
- Evaluate, observe, improve from prototyping through production

---

## 7. Human Feedback Integration

### Annotation Tools Landscape (2026)

**Key Platforms:**
- Label Studio: Open-source, custom RLHF datasets, preference ranking
- OpenRLHF: Production-ready RLHF framework (PPO, DPO, GRPO, REINFORCE++)
- Encord: AI-assisted labeling, RLHF, red-teaming, workflow management, compliance
- Labelbox: "Evaluation Studio" for real-time feedback with rubric tools

### Integration Approaches

**Active Learning & HITL:**
- Human reviews feed directly into retraining cycles
- RLHF-style evaluation using human ratings
- Reduce model drift over time

**Arize Phoenix:**
- Human annotations attach ground truth labels directly in UI
- Human-in-the-loop evaluation alongside LLM-as-a-judge
- Custom domain-specific metrics

**W&B Weave:**
- Integrate human evaluation results alongside quantitative metrics
- Holistic view of model performance

### Challenges

**Annotation Bias:**
- Presenting LLM suggestions to annotators changes label distribution
- Annotators strongly take LLM suggestions
- Impacts both LLM performance evaluation and downstream analysis
- LLM use didn't make annotators faster but increased self-reported confidence

### Best Practices

- No single benchmark is enough - tailor to use case
- Combine quantitative metrics (BLEU, groundedness) with human judgments
- Fine-tuned/RLHF models need deeper, customized pipelines
- Continuous real-world monitoring - static benchmarks won't catch drift

---

## 8. Architecture Patterns: Raw Data to Insights

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  LLM Application                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  CAPTURE                                                         │
│  • Proxy (Helicone) or SDK (Langfuse, LangSmith)                │
│  • OpenTelemetry instrumentation (Phoenix)                       │
│  • Inputs, outputs, latency, tokens, costs, metadata            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STORE                                                           │
│  • ClickHouse (Langfuse, Helicone) - analytics optimized        │
│  • Postgres (metadata, relationships)                            │
│  • Kafka (async processing, Helicone)                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  EVALUATE                                                        │
│  • Code-based metrics (fast, deterministic)                     │
│  • LLM-as-a-judge (subjective, nuanced)                         │
│  • Human annotation (ground truth)                               │
│  • Frameworks: Braintrust, DeepEval, Promptfoo                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  ANALYZE                                                         │
│  • Pre-built dashboards (latency, cost, usage)                  │
│  • Custom dashboards (team-specific metrics)                    │
│  • Full-text search across traces                               │
│  • Filtering by user, model, time, tags, metadata               │
│  • Session/conversation grouping                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  ACT                                                             │
│  • Quality-aware alerting                                        │
│  • Anomaly detection (threshold or ML-based)                    │
│  • A/B testing for prompt optimization                          │
│  • Export to BI tools                                           │
│  • CI/CD integration for regression prevention                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Insights

1. **Evaluation is continuous, not final** - Woven into development, deployment, compliance

2. **Code + LLM + Human** - Best results combine all three evaluation approaches

3. **Quality-aware > Threshold-based** - Traditional alerting misses semantic degradation

4. **OpenTelemetry adoption** - Standardizing instrumentation across tools

5. **Self-hosting demand** - HIPAA, SOC 2, data sovereignty driving Langfuse/Phoenix adoption

6. **Agent-specific metrics emerging** - Tool correctness, plan adherence, step efficiency

---

## 9. Tool Comparison Matrix

| Feature | LangSmith | Langfuse | W&B Weave | Arize Phoenix | Helicone |
|---------|-----------|----------|-----------|---------------|----------|
| **Hosting** | SaaS only | Self-host + cloud | Cloud | Self-host + cloud | Cloud |
| **License** | Proprietary | MIT | Proprietary | Apache 2.0 | Proprietary |
| **LangChain Native** | Yes | Compatible | Compatible | Compatible | Compatible |
| **Full-text Search** | Limited | Yes (v3+) | - | Yes | - |
| **Custom Dashboards** | Yes | Yes | Yes | Yes | Via PostHog |
| **A/B Testing** | Yes | Yes | - | Yes | - |
| **LLM-as-Judge** | Yes | Yes | Yes | Yes | - |
| **Human Annotation** | Yes | Yes | Yes | Yes | - |
| **OpenTelemetry** | Yes | Yes | - | Yes (native) | Via OpenLLMetry |
| **BI Integration** | Limited | Power BI API | - | - | PostHog export |
| **Alerting** | Webhooks, PagerDuty | Yes | - | Yes | Yes |

---

## 10. Decision Framework

### When to Use Each Tool

**LangSmith:** LangChain-native projects, rapid prototyping, managed SaaS preference

**Langfuse:** Self-hosting required, framework-agnostic needs, data sovereignty

**W&B Weave:** ML teams already using W&B, need unified ML+LLM observability

**Arize Phoenix:** OpenTelemetry-first, open-source preference, multi-framework

**Helicone:** Proxy-based simplicity, one-line integration, gateway features needed

**Braintrust:** Evaluation-first workflow, CI/CD enforcement, enterprise compliance

**DeepEval/Promptfoo:** Developer-centric testing, red-teaming, CI integration

---

## Sources

- [LangSmith Observability Platform](https://www.langchain.com/langsmith/observability)
- [Langfuse Custom Dashboards](https://langfuse.com/docs/metrics/features/custom-dashboards)
- [Langfuse A/B Testing](https://langfuse.com/docs/prompt-management/features/a-b-testing)
- [Langfuse Full Text Search](https://langfuse.com/changelog/2025-05-19-full-text-search)
- [W&B Weave Documentation](https://wandb.ai/site/traces/)
- [Arize Phoenix Documentation](https://arize.com/docs/phoenix)
- [Arize Phoenix GitHub](https://github.com/Arize-ai/phoenix)
- [Braintrust LLM Evaluation](https://www.braintrust.dev/articles/llm-evaluation-metrics-guide)
- [Braintrust LLM-as-Judge](https://www.braintrust.dev/articles/what-is-llm-as-a-judge)
- [Promptfoo Documentation](https://www.promptfoo.dev/docs/intro/)
- [Promptfoo GitHub](https://github.com/promptfoo/promptfoo)
- [DeepEval Documentation](https://deepeval.com/docs/getting-started)
- [DeepEval GitHub](https://github.com/confident-ai/deepeval)
- [Helicone GitHub](https://github.com/Helicone/helicone)
- [LLM Observability Tools Comparison 2026](https://lakefs.io/blog/llm-observability-tools/)
- [Best AI Evaluation Tools 2026](https://www.braintrust.dev/articles/best-ai-evaluation-tools-2026)
- [Top LLM Observability Platforms 2026](https://www.getmaxim.ai/articles/top-5-llm-observability-platforms-in-2026-2/)
