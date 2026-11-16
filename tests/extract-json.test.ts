import { describe, expect, it } from "vitest";
import { extractJson } from "../src/index.js";

describe("extractJson", () => {
  it("returns trimmed JSON directly when input is already valid JSON", () => {
    const raw = '  \n {"name": "Alice", "age": 22} \n ';
    expect(JSON.parse(extractJson(raw))).toEqual({ name: "Alice", age: 22 });
  });

  it("extracts JSON from ```json markdown fences with surrounding prose", () => {
    const raw = [
      "Sure! Here is the structured response you asked for:",
      "```json",
      '{"status": "ok", "items": [1, 2, 3]}',
      "```",
      "Let me know if you need anything else.",
    ].join("\n");

    expect(JSON.parse(extractJson(raw))).toEqual({
      status: "ok",
      items: [1, 2, 3],
    });
  });

  it("extracts JSON from untagged ``` markdown fences", () => {
    const raw = '```\n["a", "b", "c"]\n```';
    expect(JSON.parse(extractJson(raw))).toEqual(["a", "b", "c"]);
  });

  it("extracts a balanced JSON object from prose without fences", () => {
    const raw =
      'Result: {"note": "use {braces} safely", "count": 2} Hope that helps!';
    expect(JSON.parse(extractJson(raw))).toEqual({
      note: "use {braces} safely",
      count: 2,
    });
  });

  it("handles triple backticks inside a JSON string enclosed in markdown fences", () => {
    const raw =
      'Here you go:\n```json\n{"code": "```js\\nhello\\n```"}\n```\nDone.';
    expect(JSON.parse(extractJson(raw))).toEqual({
      code: "```js\nhello\n```",
    });
  });

  it("skips stray prose braces to find valid JSON later in the string", () => {
    const raw = 'Note {1}: the final payload is {"ok": true}';
    expect(JSON.parse(extractJson(raw))).toEqual({ ok: true });
  });

  it("returns broken JSON from inside a fence so JSON.parse reports a real SyntaxError", () => {
    const raw = '```json\n{"broken": }\n```';
    expect(extractJson(raw)).toBe('{"broken": }');
  });

  it("throws when the response is empty or has no JSON structure", () => {
    expect(() => extractJson("   ")).toThrow(/empty/i);
    expect(() => extractJson("Sorry, I cannot help with that.")).toThrow(
      /no json/i
    );
  });
});

