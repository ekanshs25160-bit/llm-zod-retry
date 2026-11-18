# @your-username/llm-zod-retry

**Type-safe, self-healing structured outputs for any LLM using Zod.**

When an LLM returns prose around JSON, markdown fences, broken JSON syntax, or data that violates your schema, `llm-zod-retry` catches the problem, builds a targeted correction prompt containing the broken output and readable validation errors, appends it to the conversation history, and retries—while letting network/API errors fail fast without wasting retries.

Zero runtime dependencies (except `zod` as a peer dependency). Works with OpenAI, Anthropic, Gemini, Ollama, or any custom `async` function.

## Installation

```bash
npm install @your-username/llm-zod-retry zod
```

*(Note: `zod` `^3.0.0` is required as a peer dependency.)*

## Quickstart

```ts
import { z } from "zod";
import { MaxRetriesExceededError, withRetry } from "@your-username/llm-zod-retry";

const UserSchema = z.object({
  name: z.string(),
  age: z.number().int().positive(),
  role: z.enum(["admin", "user"]),
});

async function main() {
  try {
    const result = await withRetry({
      schema: UserSchema,
      maxRetries: 2, // 1 initial attempt + up to 2 correction retries
      messages: [
        {
          role: "user",
          content:
            "Extract user details as JSON: Jane is a 28-year-old admin.",
        },
      ],
      callLlm: async (messages) => {
        const response = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages,
            }),
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const json = await response.json();
        return json.choices[0].message.content;
      },
    });

    // `result.data` is automatically inferred as { name: string; age: number; role: "admin" | "user" }
    console.log(result.data.name, result.data.age);
    console.log("Attempts taken:", result.attempts.length);
  } catch (error) {
    if (error instanceof MaxRetriesExceededError) {
      console.error("Last output:", error.lastOutput);
      console.error("Validation errors:", error.errors);
      console.error("Attempt history:", error.attempts);
    } else {
      // Network, auth, or rate-limit errors thrown by `callLlm` fail fast here
      throw error;
    }
  }
}

main();
```

## API Reference

### `withRetry(options)`

Returns `Promise<{ data: z.infer<TSchema>, attempts: AttemptRecord[] }>`.

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `callLlm` | `(messages: ChatMessage[]) => Promise<string>` | Yes | Async function that sends conversation history to your LLM and returns its raw string response. |
| `messages` | `readonly ChatMessage[]` | Yes | Initial message history (`{ role, content }`). Never mutated by `withRetry`. |
| `schema` | `z.ZodTypeAny` | Yes | Zod schema used to validate the parsed JSON and infer `result.data`. |
| `maxRetries` | `number` | No | Maximum correction retries after the first failure. Defaults to `2`. |
| `onAttempt` | `(record: AttemptRecord) => void \| Promise<void>` | No | Real-time callback invoked after each attempt finishes (both failures and success), useful for progress UIs or logging. |

### `MaxRetriesExceededError`

Thrown when all `1 + maxRetries` attempts fail JSON extraction, JSON parsing, or schema validation.

| Property | Type | Description |
| --- | --- | --- |
| `maxRetries` | `number` | Configured retry budget. |
| `lastOutput` | `string` | Raw string returned on the final attempt. |
| `errors` | `string[]` | Readable error messages from the final attempt. |
| `attempts` | `AttemptRecord[]` | Full telemetry for every attempt (`attempt`, `rawOutput`, `success`, `failureKind`, `errors`). |

### `extractJson(raw)`

Utility exported for direct use or testing. Extracts JSON from raw LLM text by:
1. Checking if the trimmed text is already valid JSON.
2. Checking markdown code fences (` ```json ` or untagged ` ``` `).
3. Scanning for balanced `{...}` or `[...]` blocks in prose while respecting string literals and escaped quotes.

## Failure Separation

- **Retried:** Missing JSON, broken JSON syntax (`JSON.parse` failures), and Zod schema mismatches (`schema.safeParseAsync` failures).
- **Not Retried (Fail Fast):** Any error thrown or rejected by `callLlm` (network timeouts, HTTP 401/429/500, invalid API keys) propagates immediately without burning retries or tokens.

## Development & Publishing

```bash
npm run typecheck     # Run TypeScript compiler checks
npm run test:run      # Run Vitest suite once
npm run build         # Bundle ESM + CJS + .d.ts/.d.cts into dist/
npm pack --dry-run    # Inspect files included in the published tarball
```

Before publishing to npm under your scoped package name:
1. Replace `@your-username` in `package.json` and `readme.md` with your npm username (`npm whoami`).
2. Bump version as needed (`npm version patch | minor | major`).
3. Publish publicly:
   ```bash
   npm login
   npm publish --access public
   ```

## License

MIT
