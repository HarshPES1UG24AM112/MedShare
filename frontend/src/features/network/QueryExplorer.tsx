import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { ApiError, type CypherResult, type GraphNode } from '@/api';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Segmented, Skeleton, Textarea } from '@/components/ui';
import { useCypherCatalogue, useRunCypher } from '@/hooks/queries';
import { cn } from '@/lib/utils';
import { GraphView, labelColour, nodeCaption } from './GraphView';

type View = 'graph' | 'table';

/** How one result cell reads in the table: nodes, relationships and paths in Cypher-like shorthand. */
export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(formatCell).join(', ')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('path' in o) return (o.path as string[]).join(' → ');
    if ('node' in o) return `(:${(o.labels as string[]).join(':')} ${nodeCaption(o as { labels: string[]; properties: Record<string, unknown> })})`;
    if ('relationship' in o) return `[:${o.type as string}]`;
    return JSON.stringify(o);
  }
  return String(v);
}

export function QueryExplorer() {
  const catalogue = useCypherCatalogue();
  const run = useRunCypher();
  const [statement, setStatement] = useState('');
  const [activeId, setActiveId] = useState<string>();
  const [view, setView] = useState<View>('graph');
  const [selected, setSelected] = useState<GraphNode>();
  const result: CypherResult | undefined = run.data;
  const hasGraph = (result?.graph.nodes.length ?? 0) > 0;

  const execute = (input: { id: string } | { statement: string }) => {
    setSelected(undefined);
    run.mutate(input, { onSuccess: (r) => setView(r.graph.nodes.length ? 'graph' : 'table') });
  };

  const pick = (id: string) => {
    const q = catalogue.data?.find((x) => x.id === id);
    if (!q) return;
    setActiveId(id);
    setStatement(q.statement);
    execute({ id });
  };

  // Open on the whole-network picture, the most telling first result.
  useEffect(() => {
    if (catalogue.data && !activeId && !statement) pick(catalogue.data.find((q) => q.id === 'G14') ? 'G14' : catalogue.data[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogue.data]);

  const submit = () => {
    const q = catalogue.data?.find((x) => x.id === activeId);
    // An unedited catalogue query runs by id; anything typed runs as a statement.
    execute(q && q.statement === statement.trim() ? { id: q.id } : { statement: statement.trim() });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <Card className="lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto">
        <CardHeader title="Documented queries" description="From backend/db/graph/queries.cypher. Click one to run it." />
        {catalogue.error ? (
          <ErrorState error={catalogue.error} onRetry={() => catalogue.refetch()} />
        ) : !catalogue.data ? (
          <CardBody>
            <Skeleton className="h-64" />
          </CardBody>
        ) : (
          <ul className="divide-y divide-line">
            {catalogue.data.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => pick(q.id)}
                  aria-current={q.id === activeId}
                  className={cn('flex w-full gap-2 px-4 py-2 text-left text-xs hover:bg-subtle', q.id === activeId && 'bg-brand-50')}
                >
                  <span className="tabular shrink-0 font-semibold text-ink-500">{q.id}</span>
                  <span className="text-ink-800">{q.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader
            title="Cypher"
            description="Read-only: Neo4j runs it in read mode, so writes are refused. Edit and press Ctrl+Enter to run."
            actions={
              <Button size="sm" icon={<Play className="size-3.5" />} loading={run.isPending} disabled={!statement.trim()} onClick={submit}>
                Run
              </Button>
            }
          />
          <CardBody>
            <Textarea
              aria-label="Cypher statement"
              value={statement}
              onChange={(e) => {
                setStatement(e.target.value);
              }}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  if (statement.trim()) submit();
                }
              }}
              rows={Math.min(10, Math.max(4, statement.split('\n').length + 1))}
              spellCheck={false}
              className="font-mono text-xs"
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Result"
            description={
              result
                ? `${result.rows.length} row${result.rows.length === 1 ? '' : 's'} · ${result.graph.nodes.length} nodes · ${result.graph.relationships.length} relationships · ${result.ms} ms${result.truncated ? ' · first 1,000 rows shown' : ''}`
                : 'Run a query to see its result.'
            }
            actions={
              result && (
                <Segmented
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'graph', label: 'Graph' },
                    { value: 'table', label: 'Table' },
                  ]}
                />
              )
            }
          />
          {run.error instanceof ApiError && run.error.status === 422 ? (
            // The query itself was refused (read-only, not allowed, syntax, timeout): say why, in the query's terms.
            <CardBody>
              <div role="alert" className="rounded-md border border-danger-100 bg-danger-50 p-3 text-sm text-danger-700">
                <p className="font-semibold">Query not run · {run.error.code}</p>
                <p className="mt-1 font-mono text-xs break-words">{run.error.message}</p>
              </div>
            </CardBody>
          ) : run.error ? (
            <ErrorState error={run.error} />
          ) : run.isPending && !result ? (
            <CardBody>
              <Skeleton className="h-80" />
            </CardBody>
          ) : !result ? null : view === 'graph' ? (
            hasGraph ? (
              <CardBody className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_16rem]">
                <div>
                  <GraphView nodes={result.graph.nodes} relationships={result.graph.relationships} selectedId={selected?.id} onSelect={setSelected} />
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600">
                    {[...new Set(result.graph.nodes.map((n) => n.labels[0]))].map((l) => (
                      <span key={l} className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full" style={{ background: labelColour(l) }} aria-hidden />
                        {l} ({result.graph.nodes.filter((n) => n.labels[0] === l).length})
                      </span>
                    ))}
                    <span className="text-ink-500">Drag nodes to rearrange; click one for its properties.</span>
                  </div>
                </div>
                <NodeDetails node={selected} />
              </CardBody>
            ) : (
              <EmptyState title="No nodes or relationships in this result" description="It returns plain values; switch to Table, or return nodes, relationships or paths (RETURN p)." />
            )
          ) : (
            <ResultTable result={result} />
          )}
        </Card>
      </div>
    </div>
  );
}

function NodeDetails({ node }: { node?: GraphNode }) {
  if (!node) return <p className="text-xs text-ink-500">Click a node to see its labels and properties.</p>;
  return (
    <div className="min-w-0 text-xs">
      <div className="mb-2 flex flex-wrap gap-1">
        {node.labels.map((l) => (
          <Badge key={l} tone="info">
            {l}
          </Badge>
        ))}
      </div>
      <dl className="space-y-1">
        {Object.entries(node.properties)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => (
            <div key={k} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
              <dt className="truncate text-ink-500">{k}</dt>
              <dd className="break-words text-ink-900">{formatCell(v)}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

function ResultTable({ result }: { result: CypherResult }) {
  if (result.rows.length === 0) return <EmptyState title="No rows" description={`Columns: ${result.columns.join(', ') || 'none'}`} />;
  return (
    <div className="max-h-[32rem] overflow-auto">
      <table className="w-full text-xs">
        <caption className="sr-only">Query result</caption>
        <thead className="sticky top-0 bg-subtle text-left text-ink-500">
          <tr>
            {result.columns.map((c) => (
              <th key={c} className="px-4 py-2 font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {result.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={cn('px-4 py-1.5 text-ink-800', typeof cell === 'number' && 'tabular text-right')}>
                  {formatCell(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
