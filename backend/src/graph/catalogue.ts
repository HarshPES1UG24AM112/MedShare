/** The documented Cypher queries in db/graph/queries.cypher, split on their `// G01: title` headers. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '../../db/graph/queries.cypher');

export interface CatalogueQuery {
  id: string;
  title: string;
  statement: string;
}

let cached: CatalogueQuery[] | null = null;

export function graphCatalogue(): CatalogueQuery[] {
  cached ??= readFileSync(FILE, 'utf8')
    .split(/^(?=\/\/ G\d{2}:)/m)
    .filter((b) => b.startsWith('// G'))
    .map((b) => {
      const lines = b.trim().split('\n');
      const [, id, title] = /^\/\/ (G\d{2}): (.*)$/.exec(lines[0])!;
      const statement = lines.filter((l) => !l.trim().startsWith('//')).join('\n').trim().replace(/;$/, '');
      return { id, title: title.trim(), statement };
    });
  return cached;
}
