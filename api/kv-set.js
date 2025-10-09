function kvHeaders() { return { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }; }
function kvJSON() { return { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, "content-type":"application/json" }; }

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  try {
    const body = await req.json();
    const r = await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(body.key)}`, {
      method: "POST", headers: kvJSON(), body: JSON.stringify({ value: body.value, nx:false })
    });
    const j = await r.json();
    return res.status(200).json({ ok:true, result: j?.result ?? null });
  } catch(e) { return res.status(500).json({ ok:false, error: String(e) }); }
}
