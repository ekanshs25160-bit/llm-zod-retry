import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import {
  MaxRetriesExceededError,
  withRetry,
  type ChatMessage,
} from "../src/index.js";

const UserSchema = z.object({
  name: z.string(),
  age: z.number().int().positive(),
  role: z.enum(["admin", "user"]),
});

const baseMessages: ChatMessage[] = [
  { role: "user", content: "Extract user Alice, age 25, role admin as JSON." },
];

describe("withRetry", () => {
  it("succeeds on the first try and infers result.data type", async () => {
    const callLlm = vi
      .fn()
      .mockResolvedValueOnce('{"name": "Alice", "age": 25, "role": "admin"}');

    const result = await withRetry({
      callLlm,
      messages: baseMessages,
      schema: UserSchema,
      maxRetries: 2,
    });

    expectTypeOf(result.data).toEqualTypeOf<{
      name: string;
      age: number;
      role: "admin" | "user";
    }>();

    expect(callLlm).toHaveBeenCalledTimes(1);
    expect(result.data).toEqual({ name: "Alice", age: 25, role: "admin" });
    expect(result.attempts).toEqual([
      {
        attempt: 1,
        rawOutput: '{"name": "Alice", "age": 25, "role": "admin"}',
        success: true,
      },
    ]);
  });

  it("retries on invalid JSON and schema violations using correction prompts, without mutating input messages", async () => {
    const seenHistories: ChatMessage[][] = [];
    const responses = [
      "{ not valid json",
      '```json\n{"name": "Alice", "age": "twenty-five", "role": "guest"}\n```',
      'Sure, fixed it:\n```json\n{"name": "Alice", "age": 25, "role": "user"}\n```',
    ];

    const callLlm = vi.fn(async (messages: ChatMessage[]) => {
      seenHistories.push(messages);
      return responses.shift() ?? "";
    });

    const originalCopy = baseMessages.map((m) => ({ ...m }));

    const result = await withRetry({
      callLlm,
      messages: baseMessages,
      schema: UserSchema,
      maxRetries: 3,
    });

    expect(callLlm).toHaveBeenCalledTimes(3);
    expect(result.data).toEqual({ name: "Alice", age: 25, role: "user" });

    // Input history must remain untouched.
    expect(baseMessages).toEqual(originalCopy);

    // Check recorded attempt telemetry.
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts[0]).toMatchObject({
      attempt: 1,
      success: false,
      failureKind: "json_parse",
    });
    expect(result.attempts[1]).toMatchObject({
      attempt: 2,
      success: false,
      failureKind: "schema_validation",
    });
    expect(result.attempts[1]?.errors?.join("\n")).toContain('Field "age"');
    expect(result.attempts[1]?.errors?.join("\n")).toContain('Field "role"');
    expect(result.attempts[2]).toMatchObject({
      attempt: 3,
      success: true,
    });

    // Check correction prompt appended to history before attempt 3.
    const thirdCallHistory = seenHistories[2];
    expect(thirdCallHistory).toHaveLength(5);
    expect(thirdCallHistory?.[3]).toEqual({
      role: "assistant",
      content:
        '```json\n{"name": "Alice", "age": "twenty-five", "role": "guest"}\n```',
    });
    const correctionMsg = thirdCallHistory?.[4]?.content ?? "";
    expect(correctionMsg).toContain('"twenty-five"');
    expect(correctionMsg).toContain('Field "age"');
    expect(correctionMsg).toContain('Field "role"');
  });

  it("throws MaxRetriesExceededError with lastOutput and errors when retries run out", async () => {
    const callLlm = vi
      .fn()
      .mockResolvedValueOnce("No JSON here at all")
      .mockResolvedValueOnce('{"name": "Bob", "age": -5, "role": "admin"}')
      .mockResolvedValueOnce('{"name": "Bob", "age": 0, "role": "superuser"}');

    let caught: unknown;
    try {
      await withRetry({
        callLlm,
        messages: baseMessages,
        schema: UserSchema,
        maxRetries: 2,
      });
    } catch (error) {
      caught = error;
    }

    expect(callLlm).toHaveBeenCalledTimes(3);
    expect(caught).toBeInstanceOf(Error);
    expect(caught).toBeInstanceOf(MaxRetriesExceededError);

    const err = caught as MaxRetriesExceededError;
    expect(err.maxRetries).toBe(2);
    expect(err.lastOutput).toBe('{"name": "Bob", "age": 0, "role": "superuser"}');
    expect(err.errors).toHaveLength(2);
    expect(err.errors.join("\n")).toContain('Field "age"');
    expect(err.errors.join("\n")).toContain('Field "role"');
    expect(err.attempts).toHaveLength(3);
  });

  it("supports maxRetries: 0 (tries once without retrying)", async () => {
    const callLlm = vi.fn().mockResolvedValueOnce("{broken");

    await expect(
      withRetry({
        callLlm,
        messages: baseMessages,
        schema: UserSchema,
        maxRetries: 0,
      })
    ).rejects.toThrow(MaxRetriesExceededError);

    expect(callLlm).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry when callLlm throws a network or API error", async () => {
    const networkError = new Error("503 Service Unavailable");
    const callLlm = vi.fn().mockRejectedValueOnce(networkError);

    await expect(
      withRetry({
        callLlm,
        messages: baseMessages,
        schema: UserSchema,
        maxRetries: 3,
      })
    ).rejects.toBe(networkError);

    expect(callLlm).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry when callLlm resolves to a non-string value", async () => {
    const callLlm = vi
      .fn()
      .mockResolvedValueOnce(null as unknown as string);

    await expect(
      withRetry({
        callLlm,
        messages: baseMessages,
        schema: UserSchema,
        maxRetries: 3,
      })
    ).rejects.toThrow(TypeError);

    expect(callLlm).toHaveBeenCalledTimes(1);
  });

  it("supports Zod transforms and async refinements", async () => {
    const AsyncSchema = z.object({
      tag: z
        .string()
        .transform((s) => s.trim().toLowerCase())
        .refine(async (s) => s.length >= 2, "Tag too short"),
    });

    const callLlm = vi
      .fn()
      .mockResolvedValueOnce('{"tag": " a "}')
      .mockResolvedValueOnce('{"tag": "  TypeScript  "}');

    const result = await withRetry({
      callLlm,
      messages: baseMessages,
      schema: AsyncSchema,
      maxRetries: 1,
    });

    expect(result.data).toEqual({ tag: "typescript" });
    expect(callLlm).toHaveBeenCalledTimes(2);
  });

  it("validates options upfront", async () => {
    const callLlm = vi.fn();

    await expect(
      withRetry({
        callLlm,
        messages: baseMessages,
        schema: UserSchema,
        maxRetries: -1,
      })
    ).rejects.toThrow(RangeError);

    await expect(
      withRetry({
        callLlm,
        messages: baseMessages,
        schema: UserSchema,
        maxRetries: 1.5,
      })
    ).rejects.toThrow(RangeError);

    expect(callLlm).not.toHaveBeenCalled();
  });
});
