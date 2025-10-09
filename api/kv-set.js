export default async function handler(req){
  if (req.method !== "POST") return new Response("Method Not Allowed",{status:405});
  const { key, value } = await req.json();
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method:'POST', headers: { Authorization:`Bearer ${token}`, 'content-type':'application/json' },
    body: JSON.stringify({ value, nx:false })
  });
  if(!res.ok) return new Response(await res.text(), { status: res.status });
  const j = await res.json();
  return new Response(JSON.stringify({ ok: j?.result === 'OK' }), { status: 200, headers: { 'content-type':'application/json' } });
}