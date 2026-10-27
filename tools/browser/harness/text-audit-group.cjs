// Groups text-audit findings: one entry per (type, element), listing every viewport and state
// it appeared in, the example text and the worst measurement. Ellipsis findings are kept only
// in default states where less than 70% of the text shows (long-name stress states are meant
// to shorten). Usage: node text-audit-group.cjs <audit.json> [> groups.json]
const fs = require('fs');
const all = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const num = (s) => {
  const m = String(s).match(/([\d.]+)px/);
  return m ? Number(m[1]) : 0;
};
const keep = (x) => {
  if (x.type !== 'ellipsis') return true;
  if (x.state.startsWith('stress')) return false;
  const m = String(x.detail).match(/shows ([\d.]+)%/);
  return m && Number(m[1]) < 70;
};

const groups = new Map();
for (const x of all.filter(keep)) {
  const k = `${x.type}|${x.key}`;
  if (!groups.has(k)) groups.set(k, { type: x.type, key: x.key, texts: new Set(), where: new Set(), worst: x, shots: new Set(), count: 0 });
  const g = groups.get(k);
  g.count++;
  g.texts.add(x.text);
  g.where.add(`${x.vp}/${x.state}`);
  g.shots.add(x.shot);
  if (num(x.detail) > num(g.worst.detail)) g.worst = x;
}

const order = ['cut', 'overlap', 'spill', 'offcenter', 'row', 'wrapmix', 'cramped', 'ragged', 'ellipsis', 'small'];
const list = [...groups.values()]
  .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || b.count - a.count)
  .map((g, i) => ({
    id: `T${String(i + 1).padStart(3, '0')}`,
    type: g.type,
    key: g.key,
    texts: [...g.texts].slice(0, 4),
    where: [...g.where],
    count: g.count,
    worst: { vp: g.worst.vp, state: g.worst.state, detail: g.worst.detail, rect: g.worst.rect, shot: g.worst.shot },
  }));
process.stdout.write(JSON.stringify(list, null, 1));
