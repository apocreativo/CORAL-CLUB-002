function shallowMerge(current = {}, patch = {}){
  const keysObj = ["brand","background","layout","payments"];
  const keysArr = ["categories","tents","reservations","logs"];
  const next = { ...current };
  for (const k of keysObj){ if (k in patch) next[k] = { ...(current[k]||{}), ...(patch[k]||{}) }; else if (current[k]!==undefined) next[k]=current[k]; }
  for (const k of keysArr){ if (k in patch) next[k] = Array.isArray(patch[k]) ? patch[k] : (Array.isArray(current[k])? current[k] : []); else next[k] = Array.isArray(current[k])? current[k]:[]; }
  for (const k of Object.keys(patch)) if (![...keysObj, ...keysArr].includes(k)) next[k]=patch[k];
  return next;
}
export default async function handler(req){
  if (req.method !== "POST") return new Response("Method Not Allowed",{status:405});
  const { stateKey, patch, revKey } = await req.json();
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const getRes = await fetch(`${url}/get/${encodeURIComponent(stateKey)}`, { headers: { Authorization:`Bearer ${token}` } });
  const getJson = await getRes.json().catch(()=>({}));
  const current = getRes.ok ? (getJson?.result || {}) : {};
  const next = shallowMerge(current, patch||{});
  const nextRev = Number(next?.rev || current?.rev || 0) + 1;
  next.rev = nextRev;
  const setRes = await fetch(`${url}/set/${encodeURIComponent(stateKey)}`, { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'content-type':'application/json' }, body: JSON.stringify({ value: next, nx:false }) });
  if(!setRes.ok) return new Response(await setRes.text(), { status: setRes.status });
  const incrRes = await fetch(`${url}/incr/${encodeURIComponent(revKey)}`, { method:'POST', headers:{ Authorization:`Bearer ${token}` } });
  const incrJson = await incrRes.json().catch(()=>({}));
  const rev = incrRes.ok ? Number(incrJson?.result||nextRev) : nextRev;
  return new Response(JSON.stringify({ ok:true, rev, state: next }), { status:200, headers:{ 'content-type':'application/json' } });
}