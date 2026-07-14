/**
 * Loads the slice of tsconfig.json that matters for module resolution:
 * `compilerOptions.baseUrl` and `compilerOptions.paths`, following local
 * `extends` chains. Only the fields testripple needs are read — this is
 * not a general tsconfig implementation, and it never invokes tsc.
 */

import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseJsonc } from "./jsonc.js";
import type { Diagnostic, FsHost, PathsConfig } from "./types.js";

interface RawConfig {
  extends?: string | string[];
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
}

export interface TsconfigLoad {
  config: PathsConfig;
  diagnostics: Diagnostic[];
  /** Absolute path of the config actually loaded, if any. */
  configPath?: string;
}

/**
 * Loads `explicitPath` if given, else `<root>/tsconfig.json` if present.
 * Missing config is not an error — resolution simply has no aliases.
 */
export function loadTsconfig(
  root: string,
  host: FsHost,
  explicitPath?: string,
): TsconfigLoad {
  const diagnostics: Diagnostic[] = [];
  const path = explicitPath
    ? resolve(root, explicitPath)
    : join(root, "tsconfig.json");

  if (!host.isFile(path)) {
    if (explicitPath) {
      diagnostics.push({
        severity: "warn",
        message: `tsconfig not found: ${path}; path aliases disabled`,
      });
    }
    return { config: { paths: {} }, diagnostics };
  }

  const merged = loadChain(path, host, diagnostics, new Set());
  return { config: merged, diagnostics, configPath: path };
}

/**
 * Resolves one config plus its `extends` ancestry. Children win over
 * parents (same rule tsc applies for compilerOptions). `baseUrl` and each
 * `paths` substitution are made absolute against the directory of the
 * config file that declared them.
 */
function loadChain(
  path: string,
  host: FsHost,
  diagnostics: Diagnostic[],
  seen: Set<string>,
): PathsConfig {
  if (seen.has(path)) {
    diagnostics.push({
      severity: "warn",
      message: `circular tsconfig extends chain at ${path}`,
    });
    return { paths: {} };
  }
  seen.add(path);

  let raw: RawConfig;
  try {
    raw = parseJsonc(host.readFile(path)) as RawConfig;
  } catch (err) {
    diagnostics.push({
      severity: "warn",
      message: `failed to parse ${path}: ${(err as Error).message}`,
      file: path,
    });
    return { paths: {} };
  }
  if (raw === null || typeof raw !== "object") return { paths: {} };

  let base: PathsConfig = { paths: {} };
  const parents =
    typeof raw.extends === "string" ? [raw.extends] : (raw.extends ?? []);
  for (const parent of parents) {
    if (!parent.startsWith(".") && !isAbsolute(parent)) {
      // `extends` pointing at an npm package: out of scope for a
      // zero-install analyzer. Note it and continue.
      diagnostics.push({
        severity: "info",
        message: `tsconfig extends package "${parent}" ignored (only relative extends are followed)`,
        file: path,
      });
      continue;
    }
    let parentPath = resolve(dirname(path), parent);
    if (!host.isFile(parentPath) && host.isFile(parentPath + ".json")) {
      parentPath += ".json";
    }
    if (!host.isFile(parentPath)) {
      diagnostics.push({
        severity: "warn",
        message: `tsconfig extends target not found: ${parentPath}`,
        file: path,
      });
      continue;
    }
    const parentConfig = loadChain(parentPath, host, diagnostics, seen);
    base = mergeConfigs(base, parentConfig);
  }

  const dir = dirname(path);
  const own: PathsConfig = { paths: {} };
  const co = raw.compilerOptions;
  if (co && typeof co === "object") {
    if (typeof co.baseUrl === "string") {
      own.baseUrl = resolve(dir, co.baseUrl);
    }
    if (co.paths && typeof co.paths === "object") {
      // `paths` substitutions are relative to baseUrl when set, else to
      // the declaring config's directory (tsc ≥4.1 behavior).
      const anchor = own.baseUrl ?? resolve(dir, ".");
      for (const [pattern, targets] of Object.entries(co.paths)) {
        if (!Array.isArray(targets)) continue;
        own.paths[pattern] = targets
          .filter((t): t is string => typeof t === "string")
          .map((t) => resolve(anchor, t));
      }
    }
  }
  return mergeConfigs(base, own);
}

/** Later (child) config wins per-key; `paths` replaces wholesale per tsc. */
function mergeConfigs(parent: PathsConfig, child: PathsConfig): PathsConfig {
  return {
    baseUrl: child.baseUrl ?? parent.baseUrl,
    paths:
      Object.keys(child.paths).length > 0 ? child.paths : parent.paths,
  };
}
