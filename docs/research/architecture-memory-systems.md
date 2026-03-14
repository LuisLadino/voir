# AI Memory Systems: Architecture Deep Dive

Research into how production AI memory products work at a technical level.

---

## Mem0

**Overview**: Universal memory layer for AI agents. Hybrid vector + graph architecture.

### Data Model

**Entity Types**:
- **Memories**: Extracted facts from conversations (text + embedding)
- **Entities**: People, places, concepts extracted via NER
- **Relationships**: Directed labeled edges between entities
- **Sessions**: Conversation groupings
- **Users/Agents**: Scoping mechanisms

**Memory Scopes**:
- User memory (persists across all conversations with a person)
- Session memory (single conversation context)
- Agent memory (specific to an AI agent instance)

### Storage

**Vector Databases** (22+ supported):
- Qdrant, Pinecone, ChromaDB, PGVector
- Amazon ElastiCache for Valkey (microsecond latency)
- Weaviate, Milvus, Chroma

**Graph Databases** (5+ supported):
- Neo4j (primary, requires APOC plugin)
- Memgraph (Docker-based)
- Amazon Neptune Analytics/DB
- Kuzu (embedded, in-process)

**History Tracking**: Local SQLite

### Retrieval

**Dual-phase retrieval**:
1. **Vector phase**: Similarity matching, optional reranking
2. **Graph phase**: Runs in parallel, enriches results with related entities

Graph results **do not reorder** vector hits - they add contextual relationships to the `relations` array.

**Mem0g (Graph-enhanced)** uses two retrieval strategies:
- Entity-centric: Find query entities, locate corresponding graph nodes via semantic similarity
- Semantic triplet: Encode entire query, match against relationship triplet embeddings

### Expiration/Forgetting

**Manual pruning only**. No automatic TTL mechanism documented.

Recommended approach: Cypher queries targeting records older than 90 days:
```cypher
MATCH (n) WHERE n.created < datetime() - duration({days: 90}) DELETE n
```

### Privacy/Security

- No explicit encryption-at-rest documented
- Standard credential management via environment variables
- Cloud vs local depends on chosen vector/graph providers
- Namespace isolation for multi-tenancy possible

### Benchmark Performance

- +26% accuracy over OpenAI Memory (LOCOMO benchmark)
- 91% faster responses vs full-context injection
- 90% lower token usage

**Sources**:
- [Mem0 GitHub](https://github.com/mem0ai/mem0)
- [Mem0 Graph Memory Docs](https://docs.mem0.ai/open-source/features/graph-memory)
- [Mem0 Research Paper (arXiv)](https://arxiv.org/pdf/2504.19413)
- [AWS Database Blog - Mem0 Integration](https://aws.amazon.com/blogs/database/build-persistent-memory-for-agentic-ai-applications-with-mem0-open-source-amazon-elasticache-for-valkey-and-amazon-neptune-analytics/)

---

## Zep (Graphiti)

**Overview**: Temporal knowledge graph architecture. Core innovation: bi-temporal model for tracking when facts are true vs when they were recorded.

### Data Model

**Three-tier hierarchical graph** G = (N, E, phi):

1. **Episodes** (raw data layer):
   - Contains messages, text, or JSON verbatim
   - Non-lossy data store
   - Reference timestamps for relative date extraction

2. **Semantic Entities & Facts** (extracted knowledge):
   - Entity nodes (1024D embeddings)
   - Semantic edges (relationships between entities)
   - Entity resolution via cosine similarity + full-text search

3. **Communities** (high-level clusters):
   - Label propagation algorithm groups connected entities
   - Summarized for global understanding

**Bi-temporal model** (key differentiator):
- **T (narrative timeline)**: When events actually occurred
- **T' (transactional timeline)**: When data was ingested into Zep
- Each fact tracks: `t_valid`, `t_invalid`, `t'_created`, `t'_expired`

### Storage

**Primary**: Neo4j graph database
- Cypher queries (not LLM-generated) ensure schema consistency
- Neo4j's Lucene implementation for full-text search

### Retrieval

**Three search functions**:
1. Cosine similarity (semantic vector matching)
2. BM25 full-text search (keyword-based)
3. Breadth-first graph traversal (n-hop context)

**Reranking layer**:
- Reciprocal Rank Fusion
- Maximal Marginal Relevance
- Episode-mention frequency analysis
- Cross-encoder LLM scoring

### Expiration/Forgetting

**Automatic contradiction-based invalidation**:

When temporally overlapping contradictions are detected, the system sets `t_invalid` on the old edge to the `t_valid` of the new (invalidating) edge.

- Complete audit trail maintained
- Facts superseded, not deleted
- Enables point-in-time queries

### Privacy/Security

No explicit privacy mechanisms documented. Data retention depends on Neo4j configuration.

### Benchmark Performance

- 94.8% vs MemGPT's 93.4% on Deep Memory Retrieval
- Up to 18.5% accuracy improvement on LongMemEval
- 90% latency reduction vs baseline

**Sources**:
- [Zep arXiv Paper](https://arxiv.org/abs/2501.13956)
- [Zep Technical Paper (Full HTML)](https://arxiv.org/html/2501.13956v1)
- [Graphiti GitHub](https://github.com/getzep/graphiti)
- [Zep Blog Post](https://blog.getzep.com/zep-a-temporal-knowledge-graph-architecture-for-agent-memory/)

---

## LangMem

**Overview**: LangChain's SDK for agent long-term memory. Two-layer architecture separating stateless core from stateful integrations.

### Data Model

**Memory Types**:

1. **Semantic Memory** (facts/knowledge):
   - Collections: Individual documents, unbounded, searchable
   - Profiles: Single documents with strict schemas, task-specific

2. **Episodic Memory** (past interactions):
   - Captures: situation, reasoning, action, result
   - Often distilled into few-shot examples

3. **Procedural Memory** (behavioral rules):
   - Encoded in system prompts
   - Evolves based on feedback

**Core Schemas** (Pydantic-based):
- `Memory`: Unstructured `content: str`
- `ExtractedMemory`: `id: str` + `content: BaseModel`
- `Episode`: `observation`, `thoughts`, `action`, `result`
- `RunningSummary`: Tracks summarization state

**Namespace Organization**:
- Hierarchical: organization -> user -> application
- Template variables populated at runtime
- Enables multi-tenancy isolation

### Storage

**Three implementations via LangGraph's BaseStore**:
1. `InMemoryStore` (dev/testing)
2. `AsyncPostgresStore` (production)
3. `LangGraph Platform Store` (cloud)

**Operations**: `get()`, `put()`, `delete()`, `asearch()` with metadata filtering

### Retrieval

- Direct key-based access
- Semantic similarity search
- Metadata filtering
- Optional query generation LLM for optimized search queries

**Memory Formation Timing**:
- Active/Conscious: During conversations (latency cost, immediate updates)
- Background/Subconscious: Between interactions (no latency, delayed recall)

### Expiration/Forgetting

- TTL support in BaseStore operations
- `enable_deletes=True` for marking outdated memories
- `RemoveDoc` objects for explicit deletion
- Background processing via ReflectionExecutor (could support temporal decay)

### Privacy/Security

- Namespace isolation for multi-tenancy
- Dynamic template variable resolution at runtime
- Storage-agnostic core (custom encryption possible)
- No explicit encryption documented

**Sources**:
- [LangMem Documentation](https://langchain-ai.github.io/langmem/)
- [LangMem Conceptual Guide](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)
- [LangMem GitHub](https://github.com/langchain-ai/langmem)
- [LangMem Blog Announcement](https://blog.langchain.com/langmem-sdk-launch/)

---

## ContextForge

**Overview**: IBM's MCP gateway/registry with memory features. Not a pure memory system - it's an API gateway that includes persistent memory capabilities.

### Data Model

Supports tools, resources, prompts, and server registrations via SQLAlchemy 2.0 ORM.

**Memory Features**:
- Semantic search
- Task tracking
- Team collaboration
- GitHub integration

### Storage

**Primary Database Options**:
- PostgreSQL (psycopg3) - production
- SQLite (file-based) - development/default
- MariaDB/MySQL (pymysql) - alternative

**Connection Pooling**: 200 default, 10 overflow, 3600s recycling

**Caching Layer** (pluggable):
- Memory-based (development)
- Redis-backed (multi-instance/federation)
- Database caching (fallback)

**Cache Settings**:
- Resource cache: 1000 items, 3600s TTL, 10MB limit
- Catalog: 100 items/page, 3600s TTL

### Retrieval

- Registry mechanisms with versioning and rollback
- URI-based resource access
- MIME detection and content negotiation
- Jinja2 template rendering

### Expiration/Security

**JWT Authentication**:
- HS256/RS256 support
- Configurable expiration
- Session management with parallel cleanup

**Security Features**:
- Argon2id password hashing (time_cost=3, memory_cost=65536 KiB)
- mTLS for plugin communication
- Input validation with JSON Schema

**Schema Management**: Alembic migrations

**Sources**:
- [ContextForge Architecture Docs](https://ibm.github.io/mcp-context-forge/architecture/)
- [ContextForge GitHub](https://github.com/IBM/mcp-context-forge)
- [ContextForge Overview](https://ibm.github.io/mcp-context-forge/)

---

## Letta (MemGPT)

**Overview**: LLM-as-Operating-System paradigm. Agent manages its own memory via function calls, mimicking how OS manages RAM + disk.

### Data Model

**Two-tier architecture** (RAM vs Disk analogy):

**Tier 1 - Main Context (In-Context, like RAM)**:
- System instructions
- Core memory blocks (persona, human info)
- Conversation history (FIFO queue with eviction)
- Fixed-size, immediately accessible

**Tier 2 - External Context (Out-of-Context, like Disk)**:
- **Recall Memory**: Full uncompressed conversation history
- **Archival Memory**: Infinite-capacity knowledge database

**Core Memory Blocks**:
- `persona`: Agent's identity/personality
- `human`: User information
- Custom blocks possible

### Storage

**Primary**: PostgreSQL with pgvector
- Docker deployment mounts `~/.letta/.persist/pgdata`
- Supports Supabase as hosted PostgreSQL option
- Vector similarity search for archival memory

**Key characteristic**: All interactions persist automatically (not ephemeral sessions)

### Self-Editing Memory (Key Innovation)

Agent manipulates memory through **six primary tools**:

```
core_memory_append     - Add facts to in-context memory
core_memory_replace    - Update existing core memories
archival_memory_insert - Write to external storage
archival_memory_search - Semantic retrieval from archival
conversation_search    - Query conversation history (text matching)
conversation_search_date - Date-based conversation queries
send_message          - Communicate with users
```

**How it works**:
1. Agent decides what information to place in context
2. When message buffer fills, older conversations move to archival
3. Agent can pull relevant data back via search tools
4. Everything happens through structured function calls

### Retrieval

**Multiple strategies**:
- Timestamp-based queries
- Text-pattern matching
- Embedding-based semantic search
- Agent-initiated retrieval (not just passive RAG)

**Memory Consolidation**: Periodically summarizes and prioritizes information

### Expiration/Forgetting

No automatic expiration documented. Agent can overwrite memories via `core_memory_replace`.

The system maintains complete history in recall memory - forgetting is agent-driven.

### Privacy/Security

- Local deployment possible (Docker)
- PostgreSQL-level security
- Transparent storage (text-based, inspectable)
- No explicit encryption documented

### Recent Developments (2026)

- **Context Repositories**: Git-based versioning for memory
- **Skill Learning**: Dynamic skill improvement from experience
- Recommended models: Opus 4.5, GPT-5.2

**Sources**:
- [Letta Documentation](https://docs.letta.com/concepts/memgpt/)
- [Letta GitHub](https://github.com/letta-ai/letta)
- [MemGPT Research Summary](https://www.leoniemonigatti.com/papers/memgpt.html)
- [Adding Memory to LLMs with Letta (Terse Systems)](https://tersesystems.com/blog/2025/02/14/adding-memory-to-llms-with-letta/)
- [Letta Memory Management Docs](https://docs.letta.com/advanced/memory-management/)

---

## Comparative Analysis

| Aspect | Mem0 | Zep | LangMem | ContextForge | Letta |
|--------|------|-----|---------|--------------|-------|
| **Core Approach** | Hybrid vector+graph | Temporal knowledge graph | Namespaced memory types | MCP gateway + memory | OS-style self-editing |
| **Primary Storage** | 22+ vector DBs, 5+ graph DBs | Neo4j | PostgreSQL/InMemory | PostgreSQL/SQLite/Redis | PostgreSQL + pgvector |
| **Unique Feature** | Graph enrichment of vector results | Bi-temporal model | Procedural memory (prompt evolution) | MCP federation | Agent-controlled memory via tools |
| **Retrieval** | Dual-phase (vector + graph parallel) | BFS + cosine + BM25 + reranking | Semantic search + metadata | Registry + caching | Agent-initiated semantic search |
| **Expiration** | Manual Cypher queries | Automatic contradiction invalidation | TTL support | JWT expiration | Agent-driven |
| **Self-Improvement** | No | No | Procedural memory evolution | No | Yes (skill learning) |
| **Open Source** | Yes | Yes (Graphiti) | Yes | Yes | Yes |

---

## Key Insights for Building

### What Works Well

1. **Hybrid retrieval** (Mem0): Vector search for relevance, graph for relationships
2. **Bi-temporal tracking** (Zep): Know when facts were true vs when recorded
3. **Namespace isolation** (LangMem): Clean multi-tenancy without complexity
4. **Agent-controlled memory** (Letta): Agent decides what to remember, not just passive storage

### Patterns to Consider

1. **Memory types matter**: Semantic (facts), episodic (examples), procedural (behavior) serve different purposes
2. **Contradiction handling**: Zep's automatic invalidation is elegant - new facts supersede old without deletion
3. **Transparency**: Letta's text-based storage means humans can inspect what agent remembers
4. **Consolidation**: Active summarization prevents unbounded growth

### What's Missing Everywhere

1. **Privacy/encryption**: No system documents encryption-at-rest
2. **Automatic forgetting**: Only Zep handles temporal invalidation; others require manual pruning
3. **Importance scoring**: No system documents how to prioritize what to remember
4. **Cross-session learning**: Letta's skill learning is unique; others are more static

### Architecture Recommendations

For our system:
- Start with **namespace-based isolation** (LangMem pattern) for clean data separation
- Implement **hybrid retrieval** (vector + relationship) when graph data is relevant
- Consider **bi-temporal model** if tracking "when things changed" matters
- **Agent-controlled memory** adds flexibility but increases complexity
- **TTL + manual review** is reasonable for expiration without over-engineering
