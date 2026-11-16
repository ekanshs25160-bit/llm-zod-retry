import type { AttemptRecord } from "./types.js";

/**
 * Thrown when the LLM fails to return valid structured output within the
 * configured `maxRetries` budget.
 */
export class MaxRetriesExceededError extends Error {
  readonly maxRetries: number;
  readonly lastOutput: string;
  readonly errors: string[];
  readonly attempts: AttemptRecord[];

  constructor(
    maxRetries: number,
    lastOutput: string,
    errors: string[],
    attempts: AttemptRecord[]
  ) {
    const retryLabel = maxRetries === 1 ? "retry" : "retries";
    const attemptLabel = attempts.length === 1 ? "attempt" : "attempts";
    super(
      `Structured output validation failed after ${maxRetries} ${retryLabel} (${attempts.length} total ${attemptLabel}): ${errors.join("; ")}`
    );

    this.name = "MaxRetriesExceededError";
    this.maxRetries = maxRetries;
    this.lastOutput = lastOutput;
    this.errors = [...errors];
    this.attempts = [...attempts];

    // Preserves `instanceof MaxRetriesExceededError` across transpiled targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

