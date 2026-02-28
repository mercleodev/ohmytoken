/**
 * Provider Plugin Registry
 *
 * Central registry for all provider plugins.
 * New providers register here; the backfill engine iterates the registry.
 */
import type { ProviderPlugin } from "./types";
import type { BackfillClient } from "../types";
import { claudePlugin } from "./claude";
import { codexPlugin } from "./codex";

const plugins: ProviderPlugin[] = [claudePlugin, codexPlugin];

export const getPlugin = (id: BackfillClient): ProviderPlugin | undefined =>
  plugins.find((p) => p.id === id);

export const getAllPlugins = (): readonly ProviderPlugin[] => plugins;
