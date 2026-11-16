import type { z } from "zod";
import type { AttemptFailureKind } from "./types.js";

function formatIssuePath(path: (string | number)[]): string {
  let formatted = "";

  for (const segment of path) {
    if (typeof segment === "number") {
      formatted += `[${segment}]`;
    } else {
      formatted += formatted.length > 0 ? `.${segment}` : segment;
    }
  }

  return formatted;
}

/**
 * Converts a `ZodError` into flat, human- and LLM-readable error lines.
 */
export function formatZodErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = formatIssuePath(issue.path);
    return path
      ? `Field "${path}": ${issue.message}`
      : `Root value: ${issue.message}`;
  });
}

const FAILURE_DESCRIPTIONS: Record<AttemptFailureKind, string> = {
  json_extract: "Your previous response did not contain extractable JSON.",
  json_parse: "Your previous response contained invalid JSON syntax.",
  schema_validation:
    "Your previous JSON response failed schema validation.",
};

/**
 * Builds a follow-up user prompt containing the broken output and readable
 * errors so the LLM can self-correct on the next retry.
 */
export function buildCorrectionPrompt(
  rawOutput: string,
  failureKind: AttemptFailureKind,
  errors: string[]
): string {
  const errorList = errors.map((err) => `- ${err}`).join("\n");

  return [
    FAILURE_DESCRIPTIONS[failureKind],
    "",
    "Previous output:",
    rawOutput,
    "",
    "Errors:",
    errorList,
    "",
    "Please return ONLY valid JSON that fixes all of the errors above, with no extra commentary.",
  ].join("\n");
}

