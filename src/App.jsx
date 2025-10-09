// src/App.jsx
import "./App.css";
import { useEffect, useMemo, useRef, useState } from "react";

/* ============ Estado inicial ============ */
const HOLD_MINUTES = 15;

const initialData = {
  background: { publicPath: "/Mapa.png" },
  layout: { count: 20, edit: false },
  payments: {
    currency: "USD",
    usdToVES: 0,
    whatsappNumber: "",
    countryCode: "+58",
  },
  security: { adminPin: "1234" },
  tents: [],          // {id, x, y, state: 'av'|'pr'|'oc'|'bl', price?: number}
  reservations: [],   // {id, tentId, createdAt, expiresAt}
};

/* ============ Helpers genéricos ============ */
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function nowISO() { return new Date().toISOString(); }
function addMinutes(d, mins) { return new Date(new Date(d).getTime() + mins * 60000).toISOString(); }

function makeGrid(n = 20) {
  // Distribuye en una rejilla básica (posiciones relativas)
  const res = [];
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  let id = 1;
  for (let r = 0; r < rows && id <= n; r++) {
    for (let c = 0; c < cols && id <= n; c++) {
      res.push({
        id,
        x: (c + 0.5) / cols,
        y: (r + 0.5) / rows,
        state: "av",
        price: 0,
      });
      id++;
    }
  }
  return res;
}

/* ============ KV helpers (multiusuario) ============ */
const STATE_KEY = "coralclub:state";
const REV_KEY   = "coralclub:rev";

async function kvGet(key) {
  try {
    const r = await fetch(`/api/kv-get?key=${encodeURIComponent(key)}`);
    const j = await r.json();
    return j?.result ?? null;
  } catch (e) { return null; }
}
async function kvMerge(stateKey, patch, revKey) {
  try {
    const r = await fetch(`/api/kv-merge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stateKey, patch, revKey }),
    });
    const j = await r.json();
    if (j?.ok) return j.state;
    return null;
  } catch (e) { return null; }
}

/* ============ App ============ */
export default function App() {
  const [data, setData] = useState(initialData);
  const [rev, setRev] = useState(0);
  const [sessionRevParam, setSessionRevParam] = useState("0");
  const [authed, setAuthed] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminTab, setAdminTab] = useState("layout"); // layout | pagos | oper
  const [selectedTent, setSelectedTent] = useState(null);

  // cache-busting del fondo
  const bustMap = `${data.background?.publicPath || "/Mapa.png"}?v=${sessionRevParam}`;

  // ====== Montaje: cargar localStorage y seed de toldos
  useEffect(() => {
    try {
      const saved = localStorage.getItem("coralclub:localState");
      if (saved) {
        const parsed = JSON.parse(saved);
        const tents = parsed.tents?.length ? parsed.tents : (data.tents?.length ? data.tents : makeGrid(data.layout?.count || 20));
        setData(d => ({ ...d, ...parsed, tents }));
      } else {
        setData(d => ({ ...d, tents: (d.tents?.length ? d.tents : makeGrid(d.layout?.count || 20)) }));
      }
    } catch (e) { /* ignore */ }
  }, []);

  // ====== Multiusuario: poll de rev para rehidratar cambios
  useEffect(() => {
    let on = true;
    const tick = async () => {
      const r = await kvGet(REV_KEY);
      if (!on) return;
      if (r != null && r !== rev) {
        setRev(r);
        setSessionRevParam(String(r));
        const st = await kvGet(STATE_KEY);
        if (st) setData(st);
      }
    };
    const id = setInterval(tick, 1500);
    tick();
    return () => { on = false; clearInterval(id); };
  }, [rev]);

  // ====== Persistencia local mínima
  useEffect(() => {
    try {
      const minimal = {
        tents: data.tents,
        reservations: data.reservations,
        payments: data.payments,
        background: data.background,
        layout: data.layout,
        security: data.security,
      };
      localStorage.setItem("coralclub:localState", JSON.stringify(minimal));
    } catch (e) { /* ignore */ }
  }, [data.tents, data.reservations, data.payments, data.background, data.layout, data.security]);

  // ====== Limpieza de reservas expiradas
  useEffect(() => {
    const now = Date.now();
    const changed = [];
    const active = (data.reservations || []).filter(r => {
      const alive = new Date(r.expiresAt).getTime() > now;
      if (!alive) changed.push(r.tentId);
      return alive;
    });
    if (changed.length) {
      const tentsUpd = data.tents.map(t =>
        changed.includes(t.id) && t.state === "pr" ? { ...t, state: "av" } : t
      );
      mergeState({ reservations: active, tents: tentsUpd }, "Purgar reservas vencidas");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]); // cuando rev cambia, re-evalúa

  /* ===== mergeState con KV + fallback local ===== */
  const mergeState = async (patch, logMsg) => {
    try {
      const next = await kvMerge(STATE_KEY, patch, REV_KEY);
      if (next) {
        setData(next);
        const r = await kvGet(REV_KEY);
        setRev(r || 0);
        setSessionRevParam(String(r || 0));
        return;
      }
      throw new Error("kvMerge null");
    } catch (e) {
      setData(s => ({ ...s, ...patch }));
      setRev(r => (r || 0) + 1);
      setSessionRevParam(v => String((+v || 0) + 1));
    }
  };

  /* ===== Admin: login sencillo por PIN ===== */
  const doAdminLogin = () => {
    const v = prompt("PIN Admin:");
    if ((v || "") === (data.security?.adminPin || "1234")) setAuthed(true);
    else alert("PIN inválido");
  };

  /* ===== Layout: drag & drop de toldos (solo si edit ON) ===== */
  const mapRef = useRef(null);
  const dragInfo = useRef(null);

  const onTentDown = (e, t) => {
    if (!data.layout?.edit) return; // drag solo en modo edición
    e.preventDefault();
    const rect = mapRef.current.getBoundingClientRect();
    dragInfo.current = {
      id: t.id,
      startX: e.clientX,
      startY: e.clientY,
      rect,
    };
    window.addEventListener("pointermove", onTentMove);
    window.addEventListener("pointerup", onTentUp);
  };

  const onTentMove = (e) => {
    const d = dragInfo.current;
    if (!d) return;
    const { rect, id } = d;
    const relX = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const relY = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    setData(s => ({
      ...s,
      tents: s.tents.map(tt => tt.id === id ? { ...tt, x: relX, y: relY } : tt)
    }));
  };
  const onTentUp = async () => {
    window.removeEventListener("pointermove", onTentMove);
    window.removeEventListener("pointerup", onTentUp);
    const d = dragInfo.current;
    dragInfo.current = null;
    if (!d) return;
    // persiste a KV
    await mergeState({ tents: data.tents }, "Mover toldo");
  };

  /* ===== Reservar toldo (cliente) ===== */
  const reservar = async () => {
    if (!selectedTent) return alert("Selecciona un toldo");
    const t = data.tents.find(x => x.id === selectedTent.id);
    if (!t || t.state !== "av") return alert("Ese toldo no está disponible.");
    const res = {
      id: `${t.id}-${Date.now()}`,
      tentId: t.id,
      createdAt: nowISO(),
      expiresAt: addMinutes(new Date(), HOLD_MINUTES),
    };
    const tentsUpd = data.tents.map(x => x.id === t.id ? { ...x, state: "pr" } : x);
    await mergeState({ tents: tentsUpd, reservations: [...(data.reservations || []), res] }, "Reservar");
    setSelectedTent({ ...t, state: "pr" });
  };

  /* ===== WhatsApp ===== */
  const cart = useMemo(() => {
    // Puedes agregar extras aquí si los manejas en otro estado
    const items = [];
    if (selectedTent) items.push({ name: `Toldo #${selectedTent.id}`, price: selectedTent.price || 0, qty: 1 });
    return items;
  }, [selectedTent]);

  const total = useMemo(() => cart.reduce((a, b) => a + b.price * b.qty, 0), [cart]);

  const openWhatsApp = () => {
    const lines = [];
    lines.push("*Reserva Coral Club*");
    if (selectedTent) {
      lines.push(`- Toldo #${selectedTent.id} — ${data.payments.currency} ${(selectedTent.price || 0).toFixed(2)}`);
    }
    lines.push(
      `*Total:* ${data.payments.currency} ${total.toFixed(2)}` +
      (data.payments.usdToVES ? ` (Bs ${(total * (data.payments.usdToVES || 0)).toFixed(2)})` : ``)
    );
    const msg = encodeURIComponent(lines.join("\n"));
    const phone = `${(data.payments.countryCode || "+58")}${(data.payments.whatsappNumber || "").replace(/\D/g, "")}`;
    const url = `https://wa.me/${phone}?text=${msg}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  /* ===== Admin: handlers ===== */
  const onChangePayments = async (patch) => {
    await mergeState({ payments: { ...data.payments, ...patch } }, "Cambiar pagos");
  };
  const onChangeBgPath = async (v) => {
    await mergeState({ background: { ...(data.background || {}), publicPath: v } }, "Cambiar fondo");
  };
  const toggleEdit = async () => {
    await mergeState({ layout: { ...(data.layout || {}), edit: !data.layout?.edit } }, "Toggle edición");
  };
  const recreateGrid = async () => {
    const n = parseInt(prompt("Cantidad de toldos:", String(data.layout?.count || 20)) || "20", 10);
    const count = Number.isFinite(n) ? clamp(n, 1, 500) : 20;
    const tents = makeGrid(count);
    await mergeState({ tents, layout: { ...(data.layout || {}), count } }, "Recrear rejilla");
  };

  /* ===== UI ===== */
  const [bgOk, setBgOk] = useState(true);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setBgOk(true);
    img.onerror = () => setBgOk(false);
    if (data?.background?.publicPath) {
      img.src = `${data.background.publicPath}?v=${sessionRevParam}`;
    }
  }, [data.background?.publicPath, sessionRevParam]);

  // Altura de leyenda respecto a topbar (ajusta a tu layout real)
  const topInsetPx = 60;

  return (
    <div className="app-shell">
      <div className="phone">
        {/* Fondo */}
        <div className="bg" style={{ backgroundImage: `url('${bustMap}')` }} />
        {!bgOk && (
          <div className="bg-fallback">
            No se encontró el mapa en {data.background.publicPath}. Verifica nombre/capitalización o súbelo a /public.
          </div>
        )}

        {/* Topbar */}
        <div className="topbar">
          <div className="brand">Coral Club</div>
          <div className="spacer" />
          <button className="iconbtn" onClick={() => setAdminOpen(true)}>⚙️</button>
        </div>

        {/* Leyenda */}
        <div className="legend" style={{ top: `${topInsetPx}px` }}>
          <div className="row"><span className="dot av" /> <span>Disponible</span></div>
          <div className="row"><span className="dot pr" /> <span>En proceso</span></div>
          <div className="row"><span className="dot oc" /> <span>Ocupado</span></div>
          <div className="row"><span className="dot bl" /> <span>Bloqueado</span></div>
        </div>

        {/* MAPA */}
        <div
          ref={mapRef}
          className="map"
          style={{
            position: "relative",
            width: "100%",
            paddingTop: "170%", // ratio aproximado; ajusta al mapa real
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {/* TOLDOS ABSOLUTOS */}
          <div className="tents-abs" style={{ inset: `${topInsetPx}px 12px 12px 12px` }}>
            {data.tents.map((t) => {
              const left = `${t.x * 100}%`;
              const top = `${t.y * 100}%`;
              const sel = selectedTent?.id === t.id;
              return (
                <div
                  key={t.id}
                  className={`tent ${t.state}${sel ? " selected" : ""}`}
                  style={{ left, top }}
                  onPointerDown={(e) => onTentDown(e, t)}
                  onClick={() => setSelectedTent(t)}
                >
                  {t.id}
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom Sheet */}
        <div className="sheet">
          <div className="sheet-header">
            <div className={`tab ${adminTab === "toldo" ? "active" : ""}`} onClick={() => setAdminTab("toldo")}>Toldo</div>
            <div className={`tab ${adminTab === "extras" ? "active" : ""}`} onClick={() => setAdminTab("extras")}>Extras</div>
            <div className={`tab ${adminTab === "carrito" ? "active" : ""}`} onClick={() => setAdminTab("carrito")}>Carrito</div>
            <div className="spacer" />
            <button className="iconbtn" onClick={toggleEdit}>{data.layout?.edit ? "🔓" : "🔒"}</button>
          </div>

          <div className="sheet-body">
            {/* Tab Toldo */}
            {adminTab === "toldo" && (
              <div className="list">
                <div className="item">
                  <div className="title">Selecciona un toldo</div>
                  <div className="row">
                    <div className="grow">
                      {selectedTent ? (
                        <div>
                          Editando: <b>#{selectedTent.id}</b> — Estado: <b>{selectedTent.state}</b>
                        </div>
                      ) : (
                        <div className="hint">Toca un toldo del mapa.</div>
                      )}
                    </div>
                    {selectedTent && (
                      <button
                        className="btn"
                        onClick={async () => {
                          const nextState = prompt("Estado (av, pr, oc, bl):", selectedTent.state) || selectedTent.state;
                          const tentsUpd = data.tents.map(t => t.id === selectedTent.id ? { ...t, state: nextState } : t);
                          await mergeState({ tents: tentsUpd }, "Cambiar estado toldo");
                          const t2 = tentsUpd.find(x => x.id === selectedTent.id);
                          setSelectedTent(t2 || null);
                        }}
                      >Cambiar estado</button>
                    )}
                  </div>
                  {selectedTent && (
                    <div className="row" style={{ marginTop: 8 }}>
                      <label className="grow">
                        <div>Precio (USD)</div>
                        <input
                          className="input"
                          type="number"
                          min="0"
                          step="0.5"
                          value={selectedTent?.price ?? 0}
                          onChange={async (e) => {
                            const val = parseFloat(e.target.value || "0") || 0;
                            const tentsUpd = data.tents.map(t => t.id === selectedTent.id ? { ...t, price: val } : t);
                            await mergeState({ tents: tentsUpd }, "Editar precio toldo");
                            const t2 = tentsUpd.find(x => x.id === selectedTent.id);
                            setSelectedTent(t2 || null);
                          }}
                        />
                      </label>
                      <button className="btn primary" onClick={reservar}>Reservar</button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tab Extras (placeholder simple) */}
            {adminTab === "extras" && (
              <div className="list">
                <div className="item">
                  <div className="title">Extras</div>
                  <div className="hint">Aquí puedes agregar extras si lo necesitas.</div>
                </div>
              </div>
            )}

            {/* Tab Carrito */}
            {adminTab === "carrito" && (
              <div className="list">
                <div className="item">
                  <div className="title">Resumen</div>
                  <div className="row">
                    <div className="grow">
                      {cart.length ? cart.map((it, i) => (
                        <div key={i}>• {it.name} — {data.payments.currency} {it.price.toFixed(2)}</div>
                      )) : <div className="hint">Tu carrito está vacío.</div>}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="sheet-footer">
            <button className="btn" onClick={() => setAdminOpen(true)}>Admin</button>
            <button className="btn primary" onClick={openWhatsApp}>Enviar por WhatsApp</button>
            <div className="total">
              Total: {data.payments.currency} {total.toFixed(2)}
              {data.payments.usdToVES ? `  |  Bs ${(total * (data.payments.usdToVES || 0)).toFixed(2)}` : ""}
            </div>
          </div>
        </div>

        {/* Admin modal */}
        {adminOpen && (
          <div className="overlay" onClick={() => setAdminOpen(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              {!authed ? (
                <div>
                  <h3>Admin</h3>
                  <button className="btn" onClick={doAdminLogin}>Ingresar con PIN</button>
                </div>
              ) : (
                <div>
                  <div className="tabs">
                    <div className={`tab-admin ${adminTab === "layout" ? "active" : ""}`} onClick={() => setAdminTab("layout")}>Layout</div>
                    <div className={`tab-admin ${adminTab === "pagos" ? "active" : ""}`} onClick={() => setAdminTab("pagos")}>Pagos</div>
                    <div className={`tab-admin ${adminTab === "oper" ? "active" : ""}`} onClick={() => setAdminTab("oper")}>Operación</div>
                  </div>

                  <div className="admin-scroll">
                    {/* LAYOUT */}
                    {adminTab === "layout" && (
                      <div className="list">
                        <div className="item">
                          <div className="title">Editar mapa (drag & drop)</div>
                          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                            <button className="btn" onClick={toggleEdit}>
                              {data.layout?.edit ? "Desactivar edición" : "Activar edición"}
                            </button>
                            <button className="btn" onClick={recreateGrid}>Recrear en rejilla</button>
                          </div>
                        </div>

                        <div className="item">
                          <div className="title">Fondo – ruta pública</div>
                          <label className="row">
                            <div className="grow">
                              <input
                                className="input"
                                placeholder="/Mapa.png"
                                value={data.background?.publicPath || ""}
                                onChange={(e) => onChangeBgPath(e.target.value || "")}
                              />
                            </div>
                            <button
                              className="btn"
                              onClick={async () => {
                                await mergeState({ __touch: Date.now() }, "Refrescar mapa");
                              }}
                            >Refrescar mapa</button>
                          </label>
                          <div className="hint">Ej: /Mapa.png (respetar mayúsculas). El botón refresca cache con ?v=rev.</div>
                        </div>

                        <div className="item">
                          <div className="title">Precio de Toldo</div>
                          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <label><div>Seleccionar toldo</div>
                              <select
                                className="input"
                                value={selectedTent?.id || ""}
                                onChange={(e) => {
                                  const id = parseInt(e.target.value || "");
                                  const t = (data.tents || []).find(x => x.id === id);
                                  setSelectedTent(t || null);
                                }}
                              >
                                <option value="">—</option>
                                {(data.tents || []).map(t => <option key={t.id} value={t.id}>#{t.id}</option>)}
                              </select>
                            </label>
                            <label><div>Precio (USD)</div>
                              <input
                                className="input"
                                type="number"
                                min="0"
                                step="0.5"
                                disabled={!selectedTent}
                                value={selectedTent?.price ?? ""}
                                onChange={async (e) => {
                                  const val = parseFloat(e.target.value || "0") || 0;
                                  if (!selectedTent) return;
                                  const tentsUpd = data.tents.map(t => t.id === selectedTent.id ? { ...t, price: val } : t);
                                  await mergeState({ tents: tentsUpd }, "Editar precio toldo");
                                  const t2 = tentsUpd.find(x => x.id === selectedTent.id);
                                  setSelectedTent(t2 || null);
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* PAGOS */}
                    {adminTab === "pagos" && (
                      <div className="list">
                        <div className="item">
                          <div className="title">Pagos</div>
                          <div className="grid2">
                            <label><div>Moneda</div>
                              <input
                                className="input"
                                value={data.payments.currency}
                                onChange={(e) => onChangePayments({ currency: (e.target.value || "USD").toUpperCase() })}
                              />
                            </label>
                            <label><div>Tasa Bs/USD</div>
                              <input
                                className="input"
                                type="number"
                                min="0"
                                step="0.01"
                                value={data.payments.usdToVES || 0}
                                onChange={(e) => onChangePayments({ usdToVES: parseFloat(e.target.value || "0") })}
                              />
                            </label>
                            <label><div>Código país (WhatsApp)</div>
                              <input
                                className="input"
                                placeholder="+58"
                                value={data.payments.countryCode || "+58"}
                                onChange={(e) => onChangePayments({ countryCode: e.target.value || "+58" })}
                              />
                            </label>
                            <label><div>WhatsApp (solo dígitos)</div>
                              <input
                                className="input"
                                placeholder="4121234567"
                                value={data.payments.whatsappNumber || ""}
                                onChange={(e) => onChangePayments({ whatsappNumber: e.target.value })}
                              />
                            </label>
                          </div>
                          <div className="hint" style={{ marginTop: 6 }}>
                            El total del cliente mostrará: USD y Bs automáticamente (si la tasa &gt; 0).
                          </div>
                        </div>
                      </div>
                    )}

                    {/* OPERACIÓN */}
                    {adminTab === "oper" && (
                      <div className="list">
                        <div className="item">
                          <div className="title">Seguridad</div>
                          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <label><div>PIN Admin</div>
                              <input
                                className="input"
                                type="password"
                                placeholder="1234"
                                value={data.security?.adminPin || ""}
                                onChange={async (e) => {
                                  const pin = (e.target.value || "").trim();
                                  await mergeState({ security: { ...(data.security || {}), adminPin: pin } }, "Cambiar PIN");
                                }}
                              />
                            </label>
                          </div>
                          <div className="hint">Este PIN se pide para abrir Admin.</div>
                        </div>
                      </div>
                    )}
                  </div>

                  <button className="fab-save" onClick={() => setAdminOpen(false)}>Cerrar</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
