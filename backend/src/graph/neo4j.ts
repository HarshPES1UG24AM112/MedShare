/**
 * Neo4j access for the graph read model. The graph is optional: when NEO4J_URL
 * is not configured, or the server is down, callers get a 503 GRAPH_UNAVAILABLE
 * and everything backed by PostgreSQL keeps working.
 */
import neo4j, { type Driver, type QueryResult, type RecordShape } from 'neo4j-driver';
import { config } from '../config.js';
import { ApiError } from '../http/errors.js';

let driver: Driver | null = null;

/** A Cypher INTEGER parameter (plain JS numbers are sent as FLOAT). */
export const int = (v: number) => neo4j.int(v);

export const graphConfigured =() => Boolean(config.NEO4J_URL && config.NEO4J_PASSWORD);

export function graphDriver(): Driver {
  if (!graphConfigured()) throw new ApiError(503, 'GRAPH_UNAVAILABLE', 'The graph database is not configured (set NEO4J_URL and NEO4J_PASSWORD)');
  // Integers come back as JS numbers: every count and id here is far below 2^53.
  driver ??= neo4j.driver(config.NEO4J_URL!, neo4j.auth.basic(config.NEO4J_USER, config.NEO4J_PASSWORD!), { disableLosslessIntegers: true });
  return driver;
}

const unavailable = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(503, 'GRAPH_UNAVAILABLE', `The graph database is unreachable: ${(e as Error).message}`);

/** Runs one read-only Cypher query and returns plain objects keyed by the RETURN aliases. */
export async function cypher<T = Record<string, unknown>>(statement: string, params: Record<string, unknown> = {}): Promise<T[]> {
  let result: QueryResult<RecordShape>;
  try {
    result = await graphDriver().executeQuery(statement, params, { routing: neo4j.routing.READ });
  } catch (e) {
    // Cypher syntax/semantic errors are bugs, not outages.
    if ((e as { code?: string }).code?.startsWith('Neo.ClientError.Statement')) throw e;
    throw unavailable(e);
  }
  return result.records.map((r) => r.toObject() as T);
}

export async function closeGraph() {
  await driver?.close();
  driver = null;
}
