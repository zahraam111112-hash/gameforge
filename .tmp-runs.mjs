import { LEVELS } from './game/src/level.js';
const chars = (s) => {
  const out = [];
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j < s.length && s[j] === s[i]) j++;
    out.push(`${i}-${j - 1}:${s[i]}(${j - i})`);
    i = j;
  }
  return out.join(' ');
};
for (const id of ['s1','s2','s3','arena']) {
  const spec = LEVELS[id];
  console.log('===', id, 'width', spec.width);
  [11,12,13].forEach((y) => {
    if (spec.rows[y]) console.log('row', y, chars(spec.rows[y]));
  });
  if (id === 'arena') [8,9].forEach((y)=>console.log('row',y,chars(spec.rows[y])));
  // walk row = the row whose tile below is solid at spawn
  for (let y=1;y<spec.height;y++){
    const above = spec.rows[y-1] ?? '';
    const row = spec.rows[y] ?? '';
    // report solid runs on row y
    console.log('solid row', y, chars(row));
  }
}
