/**
 * Runs one Cypher statement for the Query explorer and shapes the result for the
 * browser: a table (columns + rows) and a graph (every node and relationship that
 * appears anywhere in the result, de-duplicated).
 *
 * Safety: the transaction runs in Neo4j's READ access mode, so the server itself
 * refuses any write; it times out after 5 s; procedure calls, LOAD CSV and USE are
 * refused before reaching the server (they can read server config or fetch URLs).
 */
import neo4j, { isDate, isDateTime, isDuration, isLocalDateTime, isLocalTime, isNode, isPath, isPoint, isRelationship, isTime } from 'neo4j-driver';
import type { Node, Path, Relationship } from 'neo4j-driver';
import { ApiError } from '../http/errors.js';
import { graphDriver } from './neo4j.js';

export const MAX_ROWS = 1000;
const TIMEOUT_MS = 5000;

export interface GraphNode {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
}
export interface GraphRelationship {
  id: string;
  type: string;
  start: string;
  end: string;
  properties: Record<string, unknown>;
}
export interface ExplorerResult {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  graph: { nodes: GraphNode[]; relationships: GraphRelationship[] };
  ms: number;
}

const FORBIDDEN: [RegExp, string][] = [
  [/\bLOAD\s+CSV\b/i, 'LOAD CSV is not allowed here'],
  [/\bCALL\s+(?!\{)/i, 'Procedure calls are not allowed here (CALL { … } subqueries are fine)'],
  [/^\s*(SHOW|USE)\b|\bUSE\s+\w/i, 'SHOW and USE are not allowed here'],
];

export function assertAllowed(statement: string) {
  // Comments could hide a keyword from a reader but not from the server; check without them.
  const code = statement.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [re, message] of FORBIDDEN) if (re.test(code)) throw new ApiError(422, 'CYPHER_NOT_ALLOWED', message);
}

/** Turns driver values into JSON, collecting graph elements on the way. */
function serialiser() {
  const nodes = new Map<string, GraphNode>();
  const rels = new Map<string, GraphRelationship>();
  const props = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, plain(v)]));

  const node = (n: Node) => {
    if (!nodes.has(n.elementId)) nodes.set(n.elementId, { id: n.elementId, labels: n.labels, properties: props(n.properties) });
    return { node: n.elementId, labels: n.labels, properties: props(n.properties) };
  };
  const rel = (r: Relationship) => {
    if (!rels.has(r.elementId))
      rels.set(r.elementId, { id: r.elementId, type: r.type, start: r.startNodeElementId, end: r.endNodeElementId, properties: props(r.properties) });
    return { relationship: r.elementId, type: r.type, properties: props(r.properties) };
  };
  const path = (p: Path) => {
    node(p.start);
    for (const s of p.segments) {
      node(s.start);
      node(s.end);
      rel(s.relationship);
    }
    return { path: [p.start, ...p.segments.map((s) => s.end)].map((n) => (n.properties.code ?? n.properties.name ?? n.elementId) as string), length: p.length };
  };

  function plain(v: unknown): unknown {
    if (v === null || v === undefined) return null;
    if (isNode(v as object)) return node(v as Node);
    if (isRelationship(v as object)) return rel(v as Relationship);
    if (isPath(v as object)) return path(v as Path);
    if (isPoint(v as object)) {
      const p = v as { x: number; y: number };
      return { longitude: p.x, latitude: p.y };
    }
    if ([isDate, isDateTime, isLocalDateTime, isTime, isLocalTime, isDuration].some((f) => f(v as object))) return String(v);
    if (neo4j.isInt(v)) return (v as { toNumber(): number }).toNumber();
    if (Array.isArray(v)) return v.map(plain);
    if (typeof v === 'object') return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, plain(x)]));
    return v;
  }

  return { plain, graph: () => ({ nodes: [...nodes.values()], relationships: [...rels.values()] }) };
}

export async function runExplorerQuery(statement: string): Promise<ExplorerResult> {
  assertAllowed(statement);
  const session = graphDriver().session({ defaultAccessMode: neo4j.session.READ });
  const started = Date.now();
  try {
    const { keys, records } = await session.executeRead(
      async (tx) => {
        const run = tx.run(statement);
        // keys() is known even when no row comes back, so an empty result still has its columns.
        return { keys: (await run.keys()).map(String), records: (await run).records };
      },
      { timeout: TIMEOUT_MS },
    );
    const s = serialiser();
    return {
      columns: keys,
      rows: records.slice(0, MAX_ROWS).map((r) => keys.map((k) => s.plain(r.get(k)))),
      truncated: records.length > MAX_ROWS,
      graph: s.graph(),
      ms: Date.now() - started,
    };
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    const message = (e as Error).message;
    if (code === 'Neo.ClientError.Statement.AccessMode' || /read access mode|write.*not allowed/i.test(message))
      throw new ApiError(422, 'READ_ONLY', 'The explorer is read-only: this statement would change the graph');
    if (/Transaction.*(TimedOut|Terminated)|timed? ?out/i.test(code + message))
      throw new ApiError(422, 'QUERY_TIMEOUT', `The query ran longer than ${TIMEOUT_MS / 1000} s and was stopped`);
    if (code.startsWith('Neo.ClientError')) throw new ApiError(422, 'CYPHER_ERROR', message.split('\n')[0]);
    throw new ApiError(503, 'GRAPH_UNAVAILABLE', `The graph database is unreachable: ${message}`);
  } finally {
    await session.close();
  }
}
