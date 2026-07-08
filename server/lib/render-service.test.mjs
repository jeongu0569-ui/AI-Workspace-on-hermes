import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdownBody, renderMarkdownDocument } from "./render-service.mjs";

test("renders fenced code with shiki markup", async () => {
  const html = await renderMarkdownBody("```python\nprint('hi')\n```");
  assert.match(html, /class="shiki/);
  assert.match(html, /print/);
});

test("escapes raw html in markdown", async () => {
  const html = await renderMarkdownBody("<script>alert(1)</script>");
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("drops unsafe link protocols", async () => {
  const html = await renderMarkdownBody("[bad](javascript:alert(1))");
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /bad/);
});

test("returns complete html document", async () => {
  const html = await renderMarkdownDocument("# Title");
  assert.match(html, /<!doctype html>/);
  assert.match(html, /<h1>Title<\/h1>/);
});
