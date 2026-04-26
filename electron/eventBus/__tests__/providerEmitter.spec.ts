import { beforeEach, describe, expect, it } from "vitest";

import type { Provider } from "../events";
import {
  getProviderEmitter,
  getRegisteredProviders,
  type ProviderEmitter,
  registerProviderEmitter,
  resetProviderEmitterRegistry,
  startAllProviderEmitters,
  stopAllProviderEmitters,
} from "../providerEmitter";

interface SpyEmitter extends ProviderEmitter {
  started: number;
  stopped: number;
}

const makeSpyEmitter = (id: Provider): SpyEmitter => {
  const spy: SpyEmitter = {
    id,
    started: 0,
    stopped: 0,
    start() {
      spy.started += 1;
    },
    stop() {
      spy.stopped += 1;
    },
  };
  return spy;
};

describe("ProviderEmitter registry", () => {
  beforeEach(() => {
    resetProviderEmitterRegistry();
  });

  it("returns undefined for an unregistered provider id", () => {
    expect(getProviderEmitter("claude")).toBeUndefined();
  });

  it("returns an empty list when nothing is registered", () => {
    expect(getRegisteredProviders()).toEqual([]);
  });

  it("registers and retrieves an emitter by provider id", () => {
    const claude = makeSpyEmitter("claude");
    registerProviderEmitter(claude);
    expect(getProviderEmitter("claude")).toBe(claude);
    expect(getRegisteredProviders()).toEqual(["claude"]);
  });

  it("rejects duplicate registration for the same provider id", () => {
    registerProviderEmitter(makeSpyEmitter("claude"));
    expect(() =>
      registerProviderEmitter(makeSpyEmitter("claude")),
    ).toThrowError(/already registered/);
  });

  it("supports independent registration of claude/codex/gemini", () => {
    registerProviderEmitter(makeSpyEmitter("claude"));
    registerProviderEmitter(makeSpyEmitter("codex"));
    registerProviderEmitter(makeSpyEmitter("gemini"));
    expect([...getRegisteredProviders()].sort()).toEqual([
      "claude",
      "codex",
      "gemini",
    ]);
  });

  it("startAllProviderEmitters calls start() on every registered emitter", async () => {
    const claude = makeSpyEmitter("claude");
    const codex = makeSpyEmitter("codex");
    registerProviderEmitter(claude);
    registerProviderEmitter(codex);

    await startAllProviderEmitters();

    expect(claude.started).toBe(1);
    expect(codex.started).toBe(1);
  });

  it("stopAllProviderEmitters calls stop() on every registered emitter", async () => {
    const claude = makeSpyEmitter("claude");
    const codex = makeSpyEmitter("codex");
    registerProviderEmitter(claude);
    registerProviderEmitter(codex);

    await stopAllProviderEmitters();

    expect(claude.stopped).toBe(1);
    expect(codex.stopped).toBe(1);
  });

  it("awaits async start/stop lifecycles before returning", async () => {
    let started = false;
    let stopped = false;
    const lazy: ProviderEmitter = {
      id: "claude",
      async start() {
        await Promise.resolve();
        started = true;
      },
      async stop() {
        await Promise.resolve();
        stopped = true;
      },
    };
    registerProviderEmitter(lazy);

    await startAllProviderEmitters();
    expect(started).toBe(true);

    await stopAllProviderEmitters();
    expect(stopped).toBe(true);
  });

  it("resetProviderEmitterRegistry clears every registration", () => {
    registerProviderEmitter(makeSpyEmitter("claude"));
    registerProviderEmitter(makeSpyEmitter("codex"));

    resetProviderEmitterRegistry();

    expect(getRegisteredProviders()).toEqual([]);
    expect(getProviderEmitter("claude")).toBeUndefined();
    expect(getProviderEmitter("codex")).toBeUndefined();
  });

  it("does not surface the same emitter under a different provider id", () => {
    const claude = makeSpyEmitter("claude");
    registerProviderEmitter(claude);
    expect(getProviderEmitter("codex")).toBeUndefined();
    expect(getProviderEmitter("gemini")).toBeUndefined();
  });
});
