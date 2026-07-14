/**
 * The import graph and the reverse-reachability query at the heart of
 * testripple. Edges point importer → imported; impact flows the other way
 * (a change to `imported` can affect every transitive importer), so the
 * BFS below walks the reverse adjacency from the changed seeds outward.
 *
 * Two details make the analysis honest rather than merely plausible:
 *
 *  - Deleted files. A deleted module no longer exists on disk, so its
 *    importers' specifiers fail to resolve. The graph indexes every
 *    *candidate path* a failed resolution tried; seeding a deleted path
 *    finds those importers anyway.
 *
 *  - Why-chains. The BFS records parent pointers, so for any impacted
 *    test the shortest concrete chain of `import` statements back to a
 *    changed file can be reproduced, with file:line for every hop.
 */

import { extractImports } from "./scan.js";
import type {
  Diagnostic,
  FsHost,
  ImportRef,
  Resolution,
  WhyStep,
} from "./types.js";
import type { Resolver } from "./resolve.js";

/** One resolved edge in the graph. */
export interface Edge {
  importer: string;
  imported: string;
  line: number;
  specifier: string;
  typeOnly: boolean;
}

export interface ImportGraph {
  /** Every file that was scanned (absolute, sorted). */
  files: string[];
  /** importer → outgoing edges. */
  edges: Map<string, Edge[]>;
  /** imported → incoming edges (reverse adjacency). */
  reverse: Map<string, Edge[]>;
  /** failed-candidate path → edges whose resolution tried that path. */
  candidates: Map<string, Edge[]>;
  diagnostics: Diagnostic[];
  edgeCount: number;
}

/** Scans and resolves every file, producing the full graph. */
export function buildGraph(
  files: string[],
  host: FsHost,
  resolver: Resolver,
): ImportGraph {
  const edges = new Map<string, Edge[]>();
  const reverse = new Map<string, Edge[]>();
  const candidates = new Map<string, Edge[]>();
  const diagnostics: Diagnostic[] = [];
  let edgeCount = 0;

  for (const file of files) {
    let source: string;
    try {
      source = host.readFile(file);
    } catch (err) {
      diagnostics.push({
        severity: "warn",
        message: `unreadable file skipped: ${(err as Error).message}`,
        file,
      });
      continue;
    }
    let refs: ImportRef[];
    if (isScannable(file)) {
      refs = extractImports(source);
    } else {
      refs = []; // assets participate as leaves only
    }

    const out: Edge[] = [];
    for (const ref of refs) {
      const res: Resolution = resolver.resolve(file, ref.specifier);
      if (res.kind === "external") continue;

      const edge: Edge = {
        importer: file,
        imported: res.kind === "file" ? res.path : "",
        line: ref.line,
        specifier: ref.specifier,
        typeOnly: ref.typeOnly,
      };

      if (res.kind === "file") {
        out.push(edge);
        push(reverse, res.path, edge);
        edgeCount++;
      } else {
        // Unresolved: keep the candidate index so deletions still ripple,
        // and surface a warning — dangling relative imports are usually a
        // bug the user wants to know about anyway.
        for (const tried of res.tried) push(candidates, tried, edge);
        diagnostics.push({
          severity: "warn",
          message: `unresolved import "${ref.specifier}"`,
          file,
          line: ref.line,
        });
      }
    }
    if (out.length > 0) edges.set(file, out);
  }

  return { files, edges, reverse, candidates, diagnostics, edgeCount };
}

/** Extensions the scanner understands (everything else is a leaf asset). */
function isScannable(file: string): boolean {
  return /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(file);
}

function push(map: Map<string, Edge[]>, key: string, edge: Edge): void {
  const list = map.get(key);
  if (list) list.push(edge);
  else map.set(key, [edge]);
}

export interface ReachResult {
  /** Every file reachable from the seeds via reverse edges (incl. seeds
   *  that exist in the scanned set). Sorted. */
  affected: Set<string>;
  /** file → the edge that first reached it (for chain reconstruction). */
  parents: Map<string, Edge>;
}

/**
 * Reverse BFS. `seeds` may contain paths not present in the graph
 * (deleted files); those contribute impact through the candidate index.
 * When `skipTypeOnly` is set, `import type` edges do not propagate.
 */
export function reverseReach(
  graph: ImportGraph,
  seeds: Iterable<string>,
  skipTypeOnly = false,
): ReachResult {
  const affected = new Set<string>();
  const parents = new Map<string, Edge>();
  const queue: string[] = [];
  const fileSet = new Set(graph.files);

  const enqueue = (path: string, via?: Edge): void => {
    if (affected.has(path)) return;
    affected.add(path);
    if (via) parents.set(path, via);
    queue.push(path);
  };

  for (const seed of seeds) {
    if (fileSet.has(seed)) enqueue(seed);
    // A deleted/foreign seed: importers whose failed resolutions tried
    // this exact path are affected even though the seed itself is gone.
    // The parent edge is rewritten to point at the seed so that why-chains
    // name the deleted file itself, not the raw (importer-relative)
    // specifier text.
    for (const edge of graph.candidates.get(seed) ?? []) {
      if (skipTypeOnly && edge.typeOnly) continue;
      enqueue(edge.importer, { ...edge, imported: seed });
    }
  }

  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    for (const edge of graph.reverse.get(current) ?? []) {
      if (skipTypeOnly && edge.typeOnly) continue;
      enqueue(edge.importer, edge);
    }
  }
  return { affected, parents };
}

/**
 * Reconstructs the shortest import chain that pulled `target` into the
 * affected set: an ordered list of hops from (nearest) changed file to
 * `target`. Empty when `target` is itself a seed.
 */
export function chainFor(reach: ReachResult, target: string): WhyStep[] {
  const steps: WhyStep[] = [];
  let cursor = target;
  const guard = new Set<string>();
  for (;;) {
    const via = reach.parents.get(cursor);
    if (!via || guard.has(cursor)) break;
    guard.add(cursor);
    steps.push({
      importer: via.importer,
      imported: via.imported || via.specifier,
      line: via.line,
      specifier: via.specifier,
    });
    // The BFS reached `cursor` (== via.importer) from `via.imported`;
    // continue toward the seed.
    cursor = via.imported || "";
    if (cursor === "") break;
  }
  steps.reverse();
  return steps;
}
