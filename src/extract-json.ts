function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scans forward from `startIndex` (which must be `{` or `[`) and returns the
 * matching balanced slice, ignoring brackets inside JSON string literals.
 */
function scanBalancedSlice(text: string, startIndex: number): string | undefined {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === undefined) {
      break;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      stack.push("}");
    } else if (ch === "[") {
      stack.push("]");
    } else if (ch === "}" || ch === "]") {
      const expected = stack.pop();
      if (expected !== ch) {
        return undefined;
      }
      if (stack.length === 0) {
        return text.slice(startIndex, i + 1);
      }
    }
  }

  return undefined;
}

/**
 * Extracts a JSON candidate from an LLM response that may contain markdown
 * code fences or surrounding conversational text.
 *
 * Throws if the response is empty or contains no recognizable JSON structure.
 */
export function extractJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("LLM returned an empty response.");
  }

  // Fast path: response is already valid JSON without wrappers.
  if (isValidJson(trimmed)) {
    return trimmed;
  }

  // Prefer markdown fenced blocks (` ```json ... ``` ` or untagged ` ``` ... ``` `).
  let firstFencedCandidate: string | undefined;
  const fencePattern = /```([a-zA-Z0-9_-]*)\s*\n?([\s\S]*?)```/g;

  for (const match of trimmed.matchAll(fencePattern)) {
    const lang = (match[1] ?? "").toLowerCase();
    const content = (match[2] ?? "").trim();
    if (!content || (lang !== "" && lang !== "json")) {
      continue;
    }
    if (isValidJson(content)) {
      return content;
    }
    firstFencedCandidate ??= content;
  }

  // Scan for balanced `{...}` or `[...]` blocks within surrounding prose.
  let firstBalancedCandidate: string | undefined;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch !== "{" && ch !== "[") {
      continue;
    }

    const slice = scanBalancedSlice(trimmed, i);
    if (slice === undefined) {
      continue;
    }
    if (isValidJson(slice)) {
      return slice;
    }
    firstBalancedCandidate ??= slice;
  }

  // Return broken JSON candidates so `JSON.parse` produces a concrete SyntaxError.
  if (firstFencedCandidate !== undefined) {
    return firstFencedCandidate;
  }
  if (firstBalancedCandidate !== undefined) {
    return firstBalancedCandidate;
  }

  // Handle truncated JSON (e.g., cut off by max_tokens before the closing brace).
  const firstOpen = trimmed.search(/[{[]/);
  if (firstOpen !== -1) {
    return trimmed.slice(firstOpen);
  }

  throw new Error("No JSON object or array found in the LLM response.");
}

