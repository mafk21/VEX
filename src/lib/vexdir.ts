import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * VEX stores ALL data (keys, SQLite db, caches) in a single local directory.
 * Default: ~/.vex — override with VEX_DATA_DIR (used by the dev sandbox).
 * The directory is created with owner-only permissions.
 */
export function vexDir(): string {
  const dir = process.env.VEX_DATA_DIR ?? path.join(os.homedir(), ".vex");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* best effort on non-POSIX filesystems */
  }
  return dir;
}
