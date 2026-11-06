/**
 * A small force-directed layout (Fruchterman–Reingold): nodes repel each other,
 * relationships pull their ends together, and a weak pull keeps everything near
 * the centre. Deterministic (nodes start on a circle, no randomness), so the same
 * result always draws the same picture. O(n²) per step: fine for the few hundred
 * nodes a query explorer result holds.
 */
export interface LayoutInput {
  nodes: { id: string }[];
  links: { start: string; end: string }[];
}

export function forceLayout({ nodes, links }: LayoutInput, width: number, height: number, iterations = 300) {
  const n = nodes.length;
  const pos = new Map<string, { x: number; y: number }>();
  if (n === 0) return pos;
  const [cx, cy] = [width / 2, height / 2];
  const r0 = Math.min(width, height) * 0.35;
  nodes.forEach((node, i) => {
    const a = (2 * Math.PI * i) / n;
    pos.set(node.id, { x: cx + r0 * Math.cos(a), y: cy + r0 * Math.sin(a) });
  });
  if (n === 1) return new Map([[nodes[0].id, { x: cx, y: cy }]]);

  const k = Math.sqrt((width * height) / n) * 0.75; // ideal edge length
  const edges = links.filter((l) => l.start !== l.end && pos.has(l.start) && pos.has(l.end));
  const pts = nodes.map((node) => pos.get(node.id)!);
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  let temperature = width / 8;

  for (let it = 0; it < iterations; it++) {
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        let ex = pts[i].x - pts[j].x;
        let ey = pts[i].y - pts[j].y;
        let d = Math.hypot(ex, ey);
        if (d < 0.01) [ex, ey, d] = [0.01 * (i - j), 0.01, 0.01 * Math.hypot(i - j, 1)];
        const f = (k * k) / d;
        dx[i] += (ex / d) * f;
        dy[i] += (ey / d) * f;
        dx[j] -= (ex / d) * f;
        dy[j] -= (ey / d) * f;
      }
    for (const e of edges) {
      const [i, j] = [index.get(e.start)!, index.get(e.end)!];
      const ex = pts[i].x - pts[j].x;
      const ey = pts[i].y - pts[j].y;
      const d = Math.max(Math.hypot(ex, ey), 0.01);
      const f = (d * d) / k;
      dx[i] -= (ex / d) * f;
      dy[i] -= (ey / d) * f;
      dx[j] += (ex / d) * f;
      dy[j] += (ey / d) * f;
    }
    for (let i = 0; i < n; i++) {
      // Weak gravity: enough to keep disconnected parts on screen, not enough to crowd the centre.
      // It pulls harder vertically in a wide frame, so the drawing takes the frame's shape.
      dx[i] += (cx - pts[i].x) * 0.01 * (k / 50);
      dy[i] += (cy - pts[i].y) * 0.01 * (k / 50) * (width / height) ** 2;
      const d = Math.max(Math.hypot(dx[i], dy[i]), 0.01);
      const step = Math.min(d, temperature);
      pts[i].x += (dx[i] / d) * step;
      pts[i].y += (dy[i] / d) * step;
    }
    temperature = Math.max(temperature * 0.97, 0.5);
  }

  // Fit the result into the box with a margin. A force layout has no meaningful axes, so x and
  // y may scale differently (at most 1.8 : 1) to fill a wide frame instead of a square in its middle.
  const pad = 40;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let sx = Math.min((width - 2 * pad) / Math.max(x1 - x0, 1), 3);
  let sy = Math.min((height - 2 * pad) / Math.max(y1 - y0, 1), 3);
  sx = Math.min(sx, sy * 1.8);
  sy = Math.min(sy, sx * 1.8);
  const [ox, oy] = [(width - (x1 - x0) * sx) / 2, (height - (y1 - y0) * sy) / 2];
  for (const p of pts) {
    p.x = ox + (p.x - x0) * sx;
    p.y = oy + (p.y - y0) * sy;
  }
  return pos;
}
