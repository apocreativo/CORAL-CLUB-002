// src/multiuser.js
export const STATE_KEY = "coralclub:state";
export const REV_KEY   = "coralclub:rev";

export async function kvGet(key) {
  try {
    const r = await fetch(`/api/kv-get?key=${encodeURIComponent(key)}`);
    const j = await r.json();
    return j?.result ?? null;
  } catch(e) { return null; }
}

export async function kvMerge(stateKey, patch, revKey) {
  try {
    const r = await fetch(`/api/kv-merge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stateKey, patch, revKey })
    });
    const j = await r.json();
    if (j?.ok) return j.state;
    return null;
  } catch(e) { return null; }
}

/** Hook de polling de rev (rehidrata cuando hay cambios) */
export function useKvPolling(React, { setData, setSessionRevParam }, interval = 1500) {
  const { useEffect, useRef } = React;
  useEffect(() => {
    let on = true;
    const tick = async () => {
      const r = await kvGet(REV_KEY);
      if (!on) return;
      if (r != null) {
        setSessionRevParam(String(r));
        const st = await kvGet(STATE_KEY);
        if (st) setData(st);
      }
    };
    const id = setInterval(tick, interval);
    tick();
    return () => { on = false; clearInterval(id); };
  }, []); // importante: cierre correcto
}

/** Envuelve tu mergeState local para usar KV con fallback */
export function wrapMergeState({ setData, setSessionRevParam, localMerge }) {
  return async function mergeState(patch, logMsg) {
    try {
      const next = await kvMerge(STATE_KEY, patch, REV_KEY);
      if (next) {
        setData(next);
        const r = await kvGet(REV_KEY);
        setSessionRevParam(String(r || 0));
        return;
      }
      throw new Error("kvMerge null");
    } catch (e) {
      // Fallback local si KV falla
      if (typeof localMerge === "function") {
        await localMerge(patch, logMsg);
      } else {
        setData(s => ({ ...s, ...patch }));
      }
      setSessionRevParam(v => String((+v || 0) + 1));
    }
  };
}
