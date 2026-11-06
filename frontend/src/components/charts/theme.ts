/**
 * Chart colour roles. Categorical slots are used in this fixed order and never
 * cycled; validated (CVD + normal vision + contrast) against the white surface.
 * Slot 3 is < 3:1 on white, so every chart ships a legend and a table view.
 * Status colours are reserved for state (critical/low) and always paired with a label.
 */
export const series = {
  s1: '#2a78d6',
  s2: '#eb6834',
  s3: '#1baf7a',
} as const;

/** Categorical colours for unordered groups (organisations on the network map). */
export const categorical = ['#2a78d6', '#eb6834', '#1baf7a', '#8a5cd0', '#c2477e', '#0f9fb5'] as const;

export const status = {
  critical: '#d64545',
  warning: '#d98a1c',
} as const;

export const chrome = {
  grid: '#e3e8ef',
  axis: '#8d9bb4',
  text: '#4a5f80',
  surface: '#ffffff',
  cursor: '#f0f3f7',
} as const;

export const axisProps = {
  tick: { fill: chrome.text, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: chrome.grid },
} as const;
