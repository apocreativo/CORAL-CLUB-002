function kvHeaders() {
  return { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` };
}
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  try {
    const body = await req.json();
    const r = await fetch(`${process.env.KV_REST_API_URL}/incr/${encodeURIComponent(body.key)}`, {
      method: "POST", headers: kvHeaders()
    });
    const j = await r.json();
    return res.status(200).json({ ok: true, result: j?.result ?? 0 });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
