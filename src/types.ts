import type { z } from "zod";

/**
 * Standard chat roles used by LLM APIs, while permitting custom string roles
 * if a specific provider requires them.
 */
export type MessageRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: MessageRole | (string & {});
  content: string;
}

/**
 * Developer-supplied async function that sends the message history to an LLM
 * and returns the model's raw string response.
 */
export type LlmCaller = (messages: ChatMessage[]) => Promise<string>;

/**
 * Categorizes why an individual LLM response failed validation.
 * Network or API errors thrown by `callLlm` are intentionally excluded here
 * because they are not retried.
 */
export type AttemptFailureKind =
  | "json_extract"
  | "json_parse"
  | "schema_validation";

export interface AttemptRecord {
  attempt: number;
  rawOutput: string;
  success: boolean;
  failureKind?: AttemptFailureKind;
  errors?: string[];
}

export interface WithRetryOptions<TSchema extends z.ZodTypeAny> {
  /** Async function that invokes the LLM with the current message history. */
  callLlm: LlmCaller;
  /** Initial message history. Never mutated by `withRetry`. */
  messages: readonly ChatMessage[];
  /** Zod schema used to validate the output and infer `result.data`. */
  schema: TSchema;
  /** Maximum number of correction retries after the initial attempt fails. Defaults to 2. */
  maxRetries?: number;
}

export interface WithRetryResult<TData> {
  data: TData;
  attempts: AttemptRecord[];
}

