import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJSON } from "../src/lib/extractJSON.js";

test("parses clean JSON", () => {
  assert.deepEqual(extractJSON('{"score":7,"ok":true}'), { score: 7, ok: true });
});

test("strips a ```json fenced block", () => {
  const raw = '```json\n{"score":6,"note":"fine"}\n```';
  assert.deepEqual(extractJSON(raw), { score: 6, note: "fine" });
});

test("strips a plain ``` fenced block", () => {
  const raw = '```\n{"a":1}\n```';
  assert.deepEqual(extractJSON(raw), { a: 1 });
});

test("escapes a raw newline inside a string value", () => {
  // The model often puts a real line break inside "assessment".
  const raw = '{"assessment":"line one\nline two","score":8}';
  const out = extractJSON(raw);
  assert.equal(out.score, 8);
  assert.equal(out.assessment, "line one\nline two");
});

test("repairs a truncated / unbalanced object", () => {
  // Response cut off before closing braces/brackets.
  const raw = '{"score":5,"risks":["a","b"';
  const out = extractJSON(raw);
  assert.equal(out.score, 5);
  assert.deepEqual(out.risks, ["a", "b"]);
});

test("ignores preamble before the JSON object", () => {
  const raw = 'Here is your analysis:\n{"score":9}';
  assert.deepEqual(extractJSON(raw), { score: 9 });
});

test("throws when there is no JSON at all", () => {
  assert.throws(() => extractJSON("no json here"), /No JSON found/);
});
