import fs from "node:fs";
import path from "node:path";
import { vexDir } from "./vexdir";
import { encryptSecret, decryptSecret } from "./crypto";

/**
 * Local config store: .vex/config.json (mode 0600).
 * Holds the user's GitHub PAT and Gemini API key, both encrypted at rest.
 * Key material is NEVER sent to the browser — only safe metadata via getStatus().
 */

export interface GitHubUserInfo {
  login: string;
  avatarUrl: string;
  name: string | null;
}

interface StoredConfig {
  githubToken?: string; // encrypted
  githubUser?: GitHubUserInfo;
  githubConnectedAt?: string;
  geminiKey?: string; // encrypted
  geminiModels?: string[];
  geminiConnectedAt?: string;
}

function configPath(): string {
  return path.join(vexDir(), "config.json");
}

export function readConfig(): StoredConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8")) as StoredConfig;
  } catch {
    return {};
  }
}

function writeConfig(cfg: StoredConfig): void {
  const p = configPath();
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    /* best effort */
  }
}

export function saveGitHub(token: string, user: GitHubUserInfo): void {
  const cfg = readConfig();
  cfg.githubToken = encryptSecret(token);
  cfg.githubUser = user;
  cfg.githubConnectedAt = new Date().toISOString();
  writeConfig(cfg);
}

export function saveGemini(key: string, models: string[]): void {
  const cfg = readConfig();
  cfg.geminiKey = encryptSecret(key);
  cfg.geminiModels = models;
  cfg.geminiConnectedAt = new Date().toISOString();
  writeConfig(cfg);
}

export function clearKey(kind: "github" | "gemini"): void {
  const cfg = readConfig();
  if (kind === "github") {
    delete cfg.githubToken;
    delete cfg.githubUser;
    delete cfg.githubConnectedAt;
  } else {
    delete cfg.geminiKey;
    delete cfg.geminiModels;
    delete cfg.geminiConnectedAt;
  }
  writeConfig(cfg);
}

function safeDecrypt(payload: string | undefined): string | null {
  if (!payload) return null;
  try {
    return decryptSecret(payload);
  } catch {
    return null; // machine identity changed or corrupt file — treat as not configured
  }
}

export function getGitHubToken(): string | null {
  return safeDecrypt(readConfig().githubToken);
}

export function getGeminiKey(): string | null {
  return safeDecrypt(readConfig().geminiKey);
}

export interface VexStatus {
  github: { connected: boolean; user: GitHubUserInfo | null; connectedAt: string | null };
  gemini: { connected: boolean; models: string[]; connectedAt: string | null };
}

/** Safe, key-free status for the UI. */
export function getStatus(): VexStatus {
  const cfg = readConfig();
  const githubOk = !!safeDecrypt(cfg.githubToken);
  const geminiOk = !!safeDecrypt(cfg.geminiKey);
  return {
    github: {
      connected: githubOk,
      user: githubOk ? (cfg.githubUser ?? null) : null,
      connectedAt: githubOk ? (cfg.githubConnectedAt ?? null) : null,
    },
    gemini: {
      connected: geminiOk,
      models: geminiOk ? (cfg.geminiModels ?? []) : [],
      connectedAt: geminiOk ? (cfg.geminiConnectedAt ?? null) : null,
    },
  };
}

export function isReady(): boolean {
  const s = getStatus();
  return s.github.connected && s.gemini.connected;
}
