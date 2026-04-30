# System Prompt Editor

## Vision

A visual editor that lets users customize Claude Code's system prompt **inline within sections**, not just append to the end. Users see the structure, edit within context, and VOIR outputs a properly formatted, cohesive prompt.

## The Problem

### Current Append Approach

`--append-system-prompt` only adds content at the end:

```
[Entire base system prompt - untouched]
... (42k tokens)
[END OF BASE]

[Your appended content starts here]
Your methodology...
Your rules...
```

**Issues:**
- Your rules are far from related base rules
- Easy to contradict base instructions without realizing
- Format mismatch between base and append
- One big blob instead of organized by topic

### The Inline Vision

```
# Tone and style
  [Base rules]
  [YOUR ADDITIONS] ← editable, extends this section

# Tool usage policy
  [Base rules]
  [YOUR ADDITIONS] ← editable, extends this section

# Doing tasks
  [Base rules]
  [YOUR ADDITIONS] ← editable, extends this section

# Safety paragraphs (LOCKED 🔒)
  [Cannot edit - removing these enables jailbreaking, which violates AUP]
  [NOTE: No single "Safety" section exists — safety rules are scattered
   across the system prompt as individual paragraphs. VOIR must identify
   and lock ALL of them. See section registry below for known locations.]

# Custom Sections
  [Fully editable - your methodology, etc.]
```

**Benefits:**
- Instructions grouped by topic
- See context while editing
- Format matches automatically
- Less chance of contradictions
- Cohesive final prompt

---

## UI/UX Design

### Main Editor View

```
┌─────────────────────────────────────────────────────────┐
│ System Prompt Editor                                [×] │
├─────────────────────────────────────────────────────────┤
│ Mode: [● Inline Editing] [ ] Append Only     [?] Help   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ ▼ Tone and style                          [+2 additions]│
│   ┌───────────────────────────────────────────────────┐ │
│   │ Base (read-only):                                 │ │
│   │ - Only use emojis if user explicitly requests...  │ │
│   │ - Your output will be displayed on CLI...         │ │
│   │ [collapsed - click to expand]                     │ │
│   └───────────────────────────────────────────────────┘ │
│   ┌───────────────────────────────────────────────────┐ │
│   │ Your additions:                                   │ │
│   │ - Be direct and concise                          │ │
│   │ - Challenge my thinking when appropriate          │ │
│   │ [editable textbox]                                │ │
│   └───────────────────────────────────────────────────┘ │
│                                                         │
│ ▼ Tool usage policy                       [+1 addition] │
│   [Base: collapsed]                                     │
│   ┌───────────────────────────────────────────────────┐ │
│   │ Your additions:                                   │ │
│   │ - Always use Task tool for exploration            │ │
│   │ [editable textbox]                                │ │
│   └───────────────────────────────────────────────────┘ │
│                                                         │
│ ▶ Doing tasks                                  [expand] │
│ ▶ Code references                              [expand] │
│ 🔒 Safety & Security              [locked - AUP compliance] │
│                                                         │
│ ▼ Custom Sections                         [+3 sections] │
│   ┌───────────────────────────────────────────────────┐ │
│   │ # My Methodology                                  │ │
│   │ Design thinking as operating system...            │ │
│   │ [fully editable]                                  │ │
│   └───────────────────────────────────────────────────┘ │
│   [+ Add Custom Section]                                │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ Total: 52k tokens │ Remaining: 148k │ ✓ No conflicts    │
├─────────────────────────────────────────────────────────┤
│            [Preview]  [Save]  [Reset]  [Export]         │
└─────────────────────────────────────────────────────────┘
```

### Key UX Elements

1. **Section-by-section editing**
   - Each base section expandable (collapsed by default)
   - Your additions in editable textbox below each section
   - Visual indicator showing which sections have customizations

2. **Safety locks**
   - Safety-related paragraphs locked with 🔒 icon
   - Cannot edit — removing safety instructions enables jailbreaking, which violates Anthropic's Acceptable Use Policy
   - Tooltip explains why
   - **Implementation note:** There is no single "Safety" section in Claude's system prompt. Safety rules are spread across the prompt as individual paragraphs (e.g., the `IMPORTANT: Assist with authorized security testing...` paragraph, the OWASP/vulnerability paragraph in "Doing tasks", the `Executing actions with care` section). VOIR must locate and lock all of them.

3. **Live validation**
   - Token count per section and total
   - Remaining context budget
   - Conflict detection (your rules vs base rules)
   - Format validation

4. **Preview mode**
   - See final merged prompt
   - Syntax highlighting
   - Search within preview

5. **Mode toggle**
   - Inline Editing (full features, requires patching)
   - Append Only (safe mode, uses `--append-system-prompt`)

### Version Update Flow

```
┌─────────────────────────────────────────────────────────┐
│ ⚠️ Claude Code Updated                                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Claude Code updated from v2.1.76 to v2.1.77.            │
│                                                         │
│ Your inline customizations have been temporarily        │
│ moved to Append mode to prevent conflicts.              │
│                                                         │
│ Your customizations are preserved:                      │
│ • Tone and style: 2 additions                           │
│ • Tool usage: 1 addition                                │
│ • Custom sections: 3 sections                           │
│                                                         │
│ Options:                                                │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ [Continue in Append Mode]                           │ │
│ │ Safe, all customizations work, just at end          │ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ [Check for Inline Support]                          │ │
│ │ See if patching is available for new version        │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Technical Architecture

### Option A: Integrate with tweakcc

Use tweakcc as the patching engine, VOIR as the UI layer.

```
┌─────────────────────────────────────────┐
│                 VOIR                     │
│         (UI + Version Management)        │
├─────────────────────────────────────────┤
│               tweakcc                    │
│          (Patching Engine)               │
├─────────────────────────────────────────┤
│             Claude Code                  │
└─────────────────────────────────────────┘
```

**How it works:**
1. User edits sections in VOIR UI
2. VOIR calls tweakcc npm API to apply patches
3. Claude Code runs with inline customizations

**On Claude Code update:**
1. VOIR detects version change
2. Automatically reverts tweakcc patches
3. Moves all customizations → append file (graceful degradation)
4. User sees safe mode message

**When tweakcc updates for new version:**
1. VOIR detects support available
2. Prompts user to re-enable inline editing
3. User clicks yes → patches reapplied

**Pros:**
- tweakcc handles patching complexity
- Already supports 126+ Claude Code versions
- Has npm API (v4.0.0+)

**Cons:**
- External dependency
- Includes UI customization features we don't need

### Option B: Replicate System Prompt Patching (PREFERRED)

Extract and replicate ONLY the system prompt modification aspect of tweakcc. We don't need/want all the UI customization features.

**What we need from tweakcc's approach:**
- Binary unpacking (node-lief for native installs)
- System prompt location/parsing
- String replacement in prompt sections
- Binary repacking

**What we DON'T need:**
- Theme customization
- Spinner animations
- Input highlighters
- UI styling
- Session naming
- All the cosmetic stuff

**Implementation approach:**
1. Study tweakcc source for system prompt patching only
2. Implement minimal version in VOIR:
   - `unpack()` - extract JS from binary
   - `findPromptSections()` - locate sections in source
   - `patchSection()` - insert user content
   - `repack()` - bundle back into binary
3. Maintain version compatibility database

**Pros:**
- No external dependency
- Only the features we need
- Full control over behavior
- Lighter weight

**Cons:**
- More initial development work
- Need to maintain version compatibility ourselves
- node-lief complexity for native binaries

### Graceful Degradation (Both Options)

| State | Mode | User Experience |
|-------|------|-----------------|
| Normal | Patch (inline) | Full section editing |
| Claude updated, patching unavailable | Append (safe) | Customizations preserved, just at end |
| Patching available for new version | Patch (inline) | Full editing restored |

**Critical:** User never loses customizations. They just temporarily move to append until inline is safe again.

---

## Data Model

### User Customizations Storage

```typescript
interface SystemPromptCustomizations {
  version: string;  // VOIR schema version
  claudeCodeVersion: string;  // Version these were created for
  mode: 'inline' | 'append';

  sections: {
    [sectionId: string]: {
      enabled: boolean;
      additions: string;  // User's additions to this section
      position: 'before' | 'after';  // Insert before or after base content
    }
  };

  customSections: {
    id: string;
    title: string;
    content: string;
    order: number;
  }[];

  metadata: {
    lastModified: string;
    lastApplied: string;
    conflicts: string[];
  };
}
```

### Section Registry

```typescript
const SYSTEM_PROMPT_SECTIONS = {
  'tone-and-style': {
    name: 'Tone and style',
    locked: false,
    description: 'How the AI communicates',
    markers: {
      start: '# Tone and style',
      end: '# Professional objectivity'
    }
  },
  'tool-usage': {
    name: 'Tool usage policy',
    locked: false,
    description: 'When and how to use tools',
    markers: {
      start: '# Tool usage policy',
      end: '# Code References'
    }
  },
  // Safety is NOT a single section — it's multiple paragraphs scattered
  // across the system prompt. Each must be identified and locked individually.
  'safety-security-testing': {
    name: 'Security testing policy',
    locked: true,
    description: 'Authorized security testing rules — locked to prevent jailbreak enablement',
    markers: {
      start: 'IMPORTANT: Assist with authorized security',
      end: 'IMPORTANT: You must NEVER generate or guess URLs'
    }
  },
  'safety-secure-code': {
    name: 'Secure code requirements',
    locked: true,
    description: 'OWASP/vulnerability prevention — locked to prevent jailbreak enablement',
    markers: {
      start: 'Be careful not to introduce security vulnerabilities',
      end: null  // single paragraph
    }
  },
  'safety-careful-actions': {
    name: 'Executing actions with care',
    locked: true,
    description: 'Destructive action safeguards — locked to prevent jailbreak enablement',
    markers: {
      start: '# Executing actions with care',
      end: '# Using your tools'
    }
  },
  // TODO: Audit decoded system prompt for additional safety paragraphs
  // and add them here. The markers above are based on the 4.6 decoded dump.
  // ... other sections
};
```

---

## File Locations

```
~/.voir/
├── system-prompt/
│   ├── customizations.json    # User's section customizations
│   ├── append-fallback.md     # Generated append file (safe mode)
│   └── versions/
│       ├── 2.1.76.json        # Section markers for this version
│       └── 2.1.77.json        # Section markers for this version
```

---

## Open Questions

1. **Licensing:** Can we use tweakcc's approach/code? (MIT licensed, so yes for code patterns)

2. **Section detection:** How stable are section markers across versions? Need to analyze tweakcc's version changelog.

3. **npm vs native:** Native binary patching (node-lief) is more complex. Do we support both or just npm installs initially?

4. **Conflict detection:** How do we detect when user additions conflict with base instructions? Simple keyword matching or LLM-based analysis?

5. **Export/Import:** Should customizations be shareable between users? (Team settings)

---

## Success Criteria

1. User can edit system prompt sections through visual UI
2. Edits integrate inline with base prompt (not just appended)
3. Safety paragraphs remain locked (scattered across prompt, not one section)
4. Graceful degradation to append mode on updates
5. Zero data loss on version changes
6. Token budget visible and respected
7. Conflict detection warns before save

---

## Related

- [Input Transparency](../project-brief.md#input-transparency) - See what AI receives
- [tweakcc](https://github.com/Piebald-AI/tweakcc) - Patching reference implementation
- [claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts) - Version-by-version prompt documentation
