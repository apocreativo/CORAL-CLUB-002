// src/useKV.js
const API_BASE = '';

async function api(path, opts = {}){
  const res = await fetch(`${API_BASE}/api/${path}`, {
    credentials: 'same-origin',
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers||{}) }
  });
  if(!res.ok){
    const txt = await res.text().catch(()=> '');
    throw new Error(`API ${path} ${res.status} ${txt}`);
  }
  return res.json();
}
export async function kvGet(key){ const r = await api('kv-get',{method:'POST',body:JSON.stringify({key})}); return r?.value ?? null; }
export async function kvSet(key,value){ const r = await api('kv-set',{method:'POST',body:JSON.stringify({key,value})}); return r?.ok===true; }
export async function kvIncr(key){ const r = await api('kv-incr',{method:'POST',body:JSON.stringify({key})}); return r?.value ?? null; }
export async function kvMerge(stateKey, patch, revKey){
  const r = await api('kv-merge',{method:'POST',body:JSON.stringify({stateKey,patch,revKey})});
  return r?.state ?? null;
}
