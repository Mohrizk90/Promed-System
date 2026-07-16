import { readFileSync } from 'fs';
const e = readFileSync('/opt/promed-telegram/repo/vps-collector/.env', 'utf8').split('\n');
for (const l of e) {
  if (!l || l.startsWith('#')) continue;
  const i = l.indexOf('=');
  if (i < 0) continue;
  const k = l.slice(0, i);
  const v = l.slice(i + 1);
  if (k === 'SUPABASE_URL') {
    console.log('value chars:');
    for (const c of v) process.stdout.write(c.charCodeAt(0).toString(16) + ' ');
    console.log();
    console.log('len:', v.length);
    console.log('value:', JSON.stringify(v));
  }
}