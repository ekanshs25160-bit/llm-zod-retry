import type { z } from "zod";
import { buildCorrectionPrompt, formatZodErrors } from "./correction.js";
import { MaxRetriesExceededError } from "./errors.js";
import { extractJson } from "./extract-json.js";
import type {
  AttemptFailureKind,
  AttemptRecord,
  ChatMessage,
  WithRetryOptions,
  WithRetryResult,
} from "./types.js";

const DEFAULT_MAX_RETRIES = 2;

type ValidationOutcome<TData> =
  | { ok: true; data: TData }
  | { ok: false; failureKind: AttemptFailureKind; errors: string[] };

function validateOptions<TSchema extends z.ZodTypeAny>(
  options: WithRetryOptions<TSchema>
): number {
  if (!options || typeof options !== "object") {
    throw new TypeError("options must be an object.");
  }
  if (typeof options.callLlm !== "function") {
    throw new TypeError("options.callLlm must be a function.");
  }
  if (!Array.isArray(options.messages)) {
    throw new TypeError("options.messages must be an array.");
  }
  if (!options.schema || typeof options.schema.safeParseAsync !== "function") {
    throw new TypeError("options.schema must be a valid Zod schema.");
  }

  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError("options.maxRetries must be a non-negative integer.");
  }

  return maxRetries;
}

async function parseAndValidate<TSchema extends z.ZodTypeAny>(
  rawOutput: string,
  schema: TSchema
): Promise<ValidationOutcome<z.infer<TSchema>>> {
  let jsonText: string;
  try {
    jsonText = extractJson(rawOutput);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, failureKind: "json_extract", errors: [message] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, failureKind: "json_parse", errors: [message] };
  }

  const validation = await schema.safeParseAsync(parsed);
  if (!validation.success) {
    return {
      ok: false,
      failureKind: "schema_validation",
      errors: formatZodErrors(validation.error),
    };
  }

  return { ok: true, data: validation.data };
}

/**
 * Calls an LLM with a message history and retries with targeted correction
 * prompts if JSON extraction, JSON parsing, or Zod schema validation fails.
 *
 * Errors thrown directly by `callLlm` (such as network, auth, or rate-limit
 * errors) are NOT retried and propagate immediately.
 */
export async function withRetry<TSchema extends z.ZodTypeAny>(
  options: WithRetryOptions<TSchema>
): Promise<WithRetryResult<z.infer<TSchema>>> {
  const maxRetries = validateOptions(options);
  const totalAttempts = 1 + maxRetries;

  // Clone messages so neither our loop nor the caller's `callLlm` mutates input.
  const conversation: ChatMessage[] = options.messages.map((msg) => ({ ...msg }));
  const attempts: AttemptRecord[] = [];

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    // Deliberately outside any try/catch: network/API failures must fail fast.
    const rawOutput = await options.callLlm(
      conversation.map((msg) => ({ ...msg }))
    );

    if (typeof rawOutput !== "string") {
      throw new TypeError(
        `callLlm must resolve to a string, received ${typeof rawOutput}.`
      );
    }

    const outcome = await parseAndValidate(rawOutput, options.schema);

    if (outcome.ok) {
      attempts.push({ attempt, rawOutput, success: true });
      return { data: outcome.data, attempts };
    }

    attempts.push({
      attempt,
      rawOutput,
      success: false,
      failureKind: outcome.failureKind,
      errors: outcome.errors,
    });

    if (attempt < totalAttempts) {
      const correctionPrompt = buildCorrectionPrompt(
        rawOutput,
        outcome.failureKind,
        outcome.errors
      );
      conversation.push(
        { role: "assistant", content: rawOutput },
        { role: "user", content: correctionPrompt }
      );
      continue;
    }

    throw new MaxRetriesExceededError(
      maxRetries,
      rawOutput,
      outcome.errors,
      attempts
    );
  }

  // Unreachable because totalAttempts >= 1, but satisfies strict TS control flow.
  throw new MaxRetriesExceededError(maxRetries, "", [], attempts);
}

