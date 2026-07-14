/**
 * Minimal ambient declarations for the handful of Node.js built-ins this
 * project uses. Declaring them in-repo keeps `typescript` the only
 * devDependency (no `@types/node`); the surface below is intentionally
 * restricted to exactly what `src/` calls, so a typo against a real Node
 * API still fails to compile.
 */

declare module "node:fs" {
  export interface StatsLike {
    isFile(): boolean;
    isDirectory(): boolean;
  }
  export interface DirentLike {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  }
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): DirentLike[];
  export function statSync(
    path: string,
    options: { throwIfNoEntry: false },
  ): StatsLike | undefined;
}

declare module "node:path" {
  export const sep: string;
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function dirname(p: string): string;
  export function basename(p: string): string;
  export function relative(from: string, to: string): string;
  export function isAbsolute(p: string): boolean;
  export function normalize(p: string): string;
}

declare module "node:child_process" {
  export interface SpawnSyncResult {
    status: number | null;
    error?: Error;
    stdout: string;
    stderr: string;
  }
  export function spawnSync(
    command: string,
    args: string[],
    options: {
      cwd?: string;
      encoding: "utf8";
      maxBuffer?: number;
    },
  ): SpawnSyncResult;
}

declare var process: {
  argv: string[];
  cwd(): string;
  exitCode: number | undefined;
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
};
