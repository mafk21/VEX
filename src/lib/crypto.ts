import crypto from "node:crypto";
import os from "node:os";

/**
 * At-rest encryption for API keys, AES-256-GCM with a key derived from
 * machine identity (hostname + user + homedir). This protects the config
 * file against casual copying; it is not a substitute for an OS keychain.
 */

function machineIdentity(): string {
  let username = "unknown";
  try {
    username = os.userInfo().username;
  } catch {
    username = process.env.USER ?? process.env.USERNAME ?? "unknown";
  }
  return [os.hostname(), username, os.homedir(), os.platform(), os.arch()].join("|");
}

function machineKey(): Buffer {
  return crypto.scryptSync(machineIdentity(), "vex-local-secret-v1", 32);
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", machineKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(".");
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) throw new Error("Unknown secret format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", machineKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
