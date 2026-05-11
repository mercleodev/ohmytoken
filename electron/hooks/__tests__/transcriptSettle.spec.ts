import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { waitForTranscriptSettle } from "../transcriptReader";

const tmpJsonlPath = () =>
  path.join(
    os.tmpdir(),
    `oht-test-settle-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
  );

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("waitForTranscriptSettle", () => {
  let p = "";
  beforeEach(() => {
    p = tmpJsonlPath();
  });
  afterEach(() => {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  });

  it("returns immediately when the file does not exist", async () => {
    const result = await waitForTranscriptSettle(p, {
      intervalMs: 20,
      maxWaitMs: 100,
    });
    expect(result.stable).toBe(true);
    expect(result.waitedMs).toBeLessThan(50);
  });

  it("returns after the stableForMs window when the file is already stable (no growth)", async () => {
    fs.writeFileSync(p, "static content\n");
    const result = await waitForTranscriptSettle(p, {
      intervalMs: 20,
      stableForMs: 60,
      maxWaitMs: 500,
    });
    expect(result.stable).toBe(true);
    expect(result.finalSize).toBe(Buffer.byteLength("static content\n"));
    expect(result.waitedMs).toBeGreaterThanOrEqual(60);
    expect(result.waitedMs).toBeLessThan(200);
  });

  it("waits for a growing file to stabilise (writer pauses between flushes do not false-trigger)", async () => {
    fs.writeFileSync(p, "line1\n");
    // Append more lines with 30ms / 60ms / 90ms gaps. With a 80ms
    // stable-for window, none of those gaps should let the settle exit
    // early — it must outlast the 90ms append before declaring stable.
    setTimeout(() => fs.appendFileSync(p, "line2\n"), 30);
    setTimeout(() => fs.appendFileSync(p, "line3\n"), 60);
    setTimeout(() => fs.appendFileSync(p, "line4\n"), 90);

    const result = await waitForTranscriptSettle(p, {
      intervalMs: 15,
      stableForMs: 80,
      maxWaitMs: 1000,
    });
    expect(result.stable).toBe(true);
    expect(result.finalSize).toBe(
      Buffer.byteLength("line1\nline2\nline3\nline4\n"),
    );
    // 90ms (last append) + 80ms (stable window) = ≥ 170ms total
    expect(result.waitedMs).toBeGreaterThanOrEqual(150);
  });

  it("gives up after maxWaitMs when the file keeps growing forever", async () => {
    fs.writeFileSync(p, "");
    const interval: NodeJS.Timeout = setInterval(
      () => fs.appendFileSync(p, "x\n"),
      10,
    );
    try {
      const result = await waitForTranscriptSettle(p, {
        intervalMs: 15,
        stableForMs: 80,
        maxWaitMs: 200,
      });
      expect(result.stable).toBe(false);
      expect(result.waitedMs).toBeGreaterThanOrEqual(180);
      expect(result.waitedMs).toBeLessThan(350);
    } finally {
      clearInterval(interval);
      await sleep(20);
    }
  });
});
