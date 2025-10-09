function kvHeaders() {
  return { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` };
}
function kvJSON() {
  return { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, "content-type": "application/json" };
}
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  try {
    const body = await req.json();
    const stateKey = body.stateKey, patch = body.patch, revKey = body.revKey;

    // 1) Leer estado actual
    const getR = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(stateKey)}`, { headers: kvHeaders() });
    const curJ = await getR.json();
    const cur = curJ?.result ?? null;

    // 2) Merge superficial (last-write-wins)
    const next = { ...(cur || {}), ...(patch || {}) };

    // 3) Guardar
    await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(stateKey)}`, {
      method: "POST", headers: kvJSON(), body: JSON.stringify({ value: next, nx: false })
    });

    // 4) Bump de rev
    const incrR = await fetch(`${process.env.KV_REST_API_URL}/incr/${encodeURIComponent(revKey)}`, {
      method: "POST", headers: kvHeaders()
    });
    const incrJ = await incrR.json();
    const rev = incrJ?.result ?? 0;

    return res.status(200).json({ ok: true, state: next, rev });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
