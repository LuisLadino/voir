---
name: encoding-syntax
description: >
  How to encode XML angle brackets when writing about your own tool calls
  or system tags. Required when documenting system internals.
applies_to:
  - ".claude/docs/**/*.md"
  - ".claude/specs/**/*.md"
  - ".claude/agents/**/*.md"
category: claude-code
---

# Encoding Your Own Syntax

When writing about your own XML tags (tool calls, system-reminder tags, function definitions), encode angle brackets to prevent them from being parsed.

Use the characters from the system prompt encoding convention. Apply when writing to files, explaining your own behavior, or documenting system internals.
