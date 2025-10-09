function kvHeaders() { return { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }; }
function kvJSON() { return { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, "content-type":"application/json" }; }

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method Not Allowed");
  try {
    const key = req.query.key;
    const r = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, { headers: kvHeaders() });
    const j = await r.json();
    return res.status(200).json({ ok:true, result: j?.result ?? null });
  } catch(e) { return res.status(500).json({ ok:false, error: String(e) }); }
}
