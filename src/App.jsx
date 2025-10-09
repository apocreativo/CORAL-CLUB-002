import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { kvGet, kvSet, kvIncr, kvMerge } from "./useKV";

// ===== Claves en KV =====
const STATE_KEY = "coralclub:state";
const REV_KEY = "coralclub:rev";
const HOLD_MINUTES = 15;
const DEFAULT_PIN = "1234";

// ===== Estado inicial =====
const initialData = {
  rev: 0,
  brand: { name: "Coral Club", logoUrl: "/logo.png", logoSize: 42 },
  background: { publicPath: "/Mapa.png" },
  layout: { count: 20 },
  security: { adminPin: "1234" },
  payments: {
    usdToVES: 0,
    currency: "USD",
    whatsapp: "584121234567",
    mp: { link: "", alias: "" },
    pagoMovil: { bank: "", rif: "", phone: "" },
    zelle: { email: "", name: "" },
  },
  categories: [
    {
      id: "servicios",
      name: "Servicios",
      items: [
        { id: "sombrilla", name: "Sombrilla (1 mesa + 2 sillas)", price: 10, img: "/img/sombrilla.png" },
        { id: "toalla", name: "Toalla Extra", price: 2, img: "/img/toalla.png" },
        { id: "hielera", name: "Hielera con Hielo", price: 5, img: "/img/hielera.png" },
      ],
    },
    {
      id: "bebidas",
      name: "Bebidas",
      items: [
        { id: "agua", name: "Agua Mineral", price: 2.5, img: "/img/agua.png" },
        { id: "refresco", name: "Refresco", price: 3.0, img: "/img/refresco.png" },
      ],
    },
  ],
  tents: [],         // {id,x,y,state}
  reservations: [],  // {id,tentId,customer,status,createdAt,expiresAt}
  logs: [],
};

const nowISO = () => new Date().toISOString();
const addMinutesISO = (m) => new Date(Date.now() + m * 60000).toISOString();

function makeGrid(count = 20) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const padX = 0.10, padTop = 0.16, padBottom = 0.10;
  const usableW = 1 - padX * 2;
  const usableH = 1 - padTop - padBottom;
  return Array.from({ length: count }).map((_, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = padX + ((c + 0.5) / cols) * usableW;
    const y = padTop + ((r + 0.5) / rows) * usableH;
    return { id: i + 1, state: "av", x: +x.toFixed(4), y: +y.toFixed(4) };
  });
}

const throttle = (fn, ms=250) => {
  let t=0; let lastArgs=null; let pending=false;
  return (...args)=>{
    const now = Date.now();
    lastArgs=args;
    if(!pending && now-t>ms){
      t=now; pending=true;
      Promise.resolve(fn(...lastArgs)).finally(()=> pending=false);
    }
  };
};

function usePolling(onTick, delay=1500){
  useEffect(()=>{
    let id = setInterval(onTick, delay);
    return ()=> clearInterval(id);
  }, [onTick, delay]);
}

function logEvent(setData, type, message){
  setData(s=>{
    const row = { ts: nowISO(), type, message };
    const logs = [row, ...s.logs].slice(0,200);
    return { ...s, logs };
  });
}

export default function App(){
  const [data, setData] = useState(initialData);
  const [rev, setRev] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // Auto-seed tents and load local saved state
  useEffect(()=>{
    try{
      const saved = localStorage.getItem("coralclub:localState");
      if(saved){
        const parsed = JSON.parse(saved);
        setData(d => ({ ...d, ...parsed, tents: (parsed.tents?.length? parsed.tents : (d.tents?.length? d.tents : makeGrid(d.layout?.count||20))) }));
      }else{
        setData(d => ({ ...d, tents: (d.tents?.length? d.tents : makeGrid(d.layout?.count||20)) }));
      }
    }catch(e){}
  }, []);
  useEffect(()=>{
    try{
      const minimal = { tents: data.tents, reservations: data.reservations, payments: data.payments, security: data.security };
      localStorage.setItem("coralclub:localState", JSON.stringify(minimal));
    }catch(e){}
  }, [data.tents, data.reservations, data.payments, data.security]);

  // UI
  const [adminOpen, setAdminOpen] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [adminTab, setAdminTab] = useState("catalogo");
  const [sheetTab, setSheetTab] = useState("toldo");
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  const [editingMap, setEditingMap] = useState(false);
  const [selectedTent, setSelectedTent] = useState(null);
  const [dragId, setDragId] = useState(null);

  const [sessionRevParam, setSessionRevParam] = useState("0");
  const [bgOk, setBgOk] = useState(true);
  useEffect(()=>{
    const img = new Image();
    img.onload = ()=> setBgOk(true);
    img.onerror = ()=> setBgOk(false);
    if(data?.background?.publicPath){
      img.src = `${data.background.publicPath}?v=${sessionRevParam}`;
    }
  }, [data.background?.publicPath, sessionRevParam]);

  const topbarRef = useRef(null);
  const [topInsetPx, setTopInsetPx] = useState(70);

  const [payOpen, setPayOpen] = useState(false);
  const [payTab, setPayTab] = useState("mp");
  const [userForm, setUserForm] = useState({ name: '', phoneCountry: '+58', phone: '', email: '' });
  const [myPendingResId, setMyPendingResId] = useState(null);
  // ===== Countdown for my pending reservation =====
  const myRes = useMemo(()=> (data.reservations||[]).find(r=> r.id===myPendingResId), [data.reservations, myPendingResId]);
  const [nowTick, setNowTick] = useState(0);
  useEffect(()=>{
    if(!myRes) return;
    const id = setInterval(()=> setNowTick(x=>x+1), 1000);
    return ()=> clearInterval(id);
  }, [myRes]);
  const remainingMs = useMemo(()=>{
    if(!myRes?.expiresAt) return 0;
    const diff = new Date(myRes.expiresAt).getTime() - Date.now();
    return Math.max(0, diff);
  }, [myRes, nowTick]);
  const mm = Math.floor(remainingMs/60000);
  const ss = Math.floor((remainingMs%60000)/1000);


  // compute totals
  const [cart, setCart] = useState([]);
  const total = useMemo(() => (cart.reduce((a,b)=> a + b.price*b.qty, 0) + (selectedTent?.price||0)), [cart, selectedTent]);
  const resCode = useMemo(()=>{
    const d = new Date(); const s = d.toISOString().replace(/[-:T.Z]/g,"").slice(2,12);
    return `CC-${selectedTent?.id||"XX"}-${s}`;
  }, [selectedTent]);

  // top inset dynamic
  useEffect(()=>{
    if(!topbarRef.current) return;
    const el = topbarRef.current;
    const ro = new ResizeObserver((entries)=>{
      for(const entry of entries){
        const h = entry.contentRect.height || el.offsetHeight || 46;
        setTopInsetPx(12 + h + 12);
      }
    });
    ro.observe(el);
    return ()=> ro.disconnect();
  }, []);
  useEffect(()=>{
    if(topbarRef.current){
      const h = topbarRef.current.offsetHeight || 46;
      setTopInsetPx(12 + h + 12);
    }
  }, [data.brand.logoSize, data.brand.name]);

  // ===== Carga inicial desde KV (o seedea) =====
  useEffect(()=>{
    (async ()=>{
      try{
        const cur = await kvGet(STATE_KEY);
        if(!cur){
          const seeded = { ...initialData, tents: makeGrid(initialData.layout.count) };
          await kvSet(STATE_KEY, seeded);
          await kvSet(REV_KEY, 1);
          setData(seeded); setRev(1);
          setSessionRevParam("1");
          logEvent(setData, "system", "Seed inicial");
        } else {
          setData(cur);
          const r = (await kvGet(REV_KEY)) ?? 1;
          setRev(r); setSessionRevParam(String(r));
        }
        setLoaded(true);
      }catch(e){
        console.error(e);
        setLoaded(true);
      }
    })();
  }, []);

  // ===== Polling de rev =====
  usePolling(async ()=>{
    try{
      const r = await kvGet(REV_KEY);
      if(typeof r === "number" && r !== rev){
        setRev(r);
        const cur = await kvGet(STATE_KEY);
        if(cur){
          setData(cur);
          setSessionRevParam(String(r));
        }
      }
    }catch(e){ /* ignore */ }
  }, 1500);

  // ===== Expiración de reservas pendientes =====
  useEffect(()=>{
    const id = setInterval(async ()=>{
      const now = nowISO();
      const expired = data.reservations.filter(r => r.status==="pending" && r.expiresAt && r.expiresAt <= now);
      if(expired.length){
        const tentsUpd = data.tents.map(t=>{
          const hit = expired.find(r=> r.tentId === t.id);
          if(hit) return { ...t, state: "av" };
          return t;
        });
        const resUpd = data.reservations.map(r=> expired.some(x=>x.id===r.id) ? { ...r, status:"expired" } : r);
        await kvMerge(STATE_KEY, { tents: tentsUpd, reservations: resUpd }, REV_KEY);
        logEvent(setData, "system", `Expiraron ${expired.length} reservas`);
      }
    }, 10000);
    return ()=> clearInterval(id);
  }, [data.reservations, data.tents]);

  // ===== Helpers de merge =====
  
  const mergeState = async (patch, logMsg) => {
    try{
      const next = await kvMerge(STATE_KEY, patch, REV_KEY);
      if(next){
        setData(next);
        const r = await kvGet(REV_KEY);
        setRev(r||0); setSessionRevParam(String(r||0));
        if(logMsg) logEvent(setData, "action", logMsg);
        return;
      }
      throw new Error("kvMerge returned null");
    }catch(e){
      setData(s => ({ ...s, ...patch }));
      setRev(r=> (r||0)+1);
      setSessionRevParam(v=> String((+v||0)+1));
      if(logMsg) logEvent(setData, "action (local)", logMsg);
    }
  };


  // ===== Toldo: selección y drag =====
  const onTentClick = (t) => {
    if(editingMap) return;
    if(t.state !== "av") { alert("Ese toldo no está disponible"); return; }
    setSelectedTent(c => c && c.id===t.id ? null : t);
  };
  const onTentDown = (id) => { if(editingMap) setDragId(id); };
  const onMouseMove = throttle(async (e)=>{
    if(!editingMap || dragId == null) return;
    const el = document.querySelector(".tents-abs"); if(!el) return;
    const rect = el.getBoundingClientRect();
    let x = (e.clientX - rect.left) / rect.width;
    let y = (e.clientY - rect.top) / rect.height;
    x = Math.min(0.98, Math.max(0.02, x));
    y = Math.min(0.98, Math.max(0.02, y));
    const tentsUpd = data.tents.map(t => t.id===dragId ? { ...t, x:+x.toFixed(4), y:+y.toFixed(4) } : t);
    setData(s=> ({ ...s, tents: tentsUpd })); // local preview
  }, 150);
  const onMouseUp = async ()=>{
    if(!editingMap || dragId==null) return;
    const t = data.tents.find(x=> x.id===dragId);
    await mergeState({ tents: data.tents }, `Mover toldo #${t?.id}`);
    setDragId(null);
  };

  // ===== Carrito =====
  const qtyOf = (itemId) => (cart.find(x=> x.key === `extra:${itemId}`)?.qty || 0);
  const addOne = (it) => setCart(s=>{
    const key = `extra:${it.id}`;
    const ex = s.find(x=> x.key===key);
    if(ex) return s.map(x=> x.key===key ? { ...x, qty: x.qty+1 } : x);
    return [...s, { key, name: it.name, price: it.price, qty: 1 }];
  });
  const removeOne = (it) => setCart(s=> s.map(x=> x.key===`extra:${it.id}` ? { ...x, qty: Math.max(0, x.qty-1)} : x).filter(x=> x.qty>0));
  const delLine = (key) => setCart(s=> s.filter(x=> x.key!==key));
  const emptyCart = () => setCart([]);

  // ===== Reserva =====
  async function reservar(){
    if(!selectedTent) { alert("Selecciona un toldo disponible primero"); return; }
    const expiresAt = addMinutesISO(HOLD_MINUTES);
    const reservation = {
      id: crypto.randomUUID(),
      tentId: selectedTent.id,
      status: "pending",
      createdAt: nowISO(),
      expiresAt,
      customer: { name: userForm.name||"", phone: userForm.phone||"", email: userForm.email||"" },
      cart,
    };
    // set 'pr' if still available
    const t = data.tents.find(x=> x.id===selectedTent.id);
    if(!t || t.state!=="av"){ alert("Ese toldo ya no está disponible"); return; }
    const tentsUpd = data.tents.map(x=> x.id===t.id ? { ...x, state:"pr" } : x);
    const reservationsUpd = [reservation, ...data.reservations];
    await mergeState({ tents: tentsUpd, reservations: reservationsUpd }, `Reserva creada toldo #${t.id}`);
    setMyPendingResId(reservation.id);
    setPayOpen(true);
  }
  async function releaseTent(tentId, resId, toState="av", newStatus="expired"){
    const tentsUpd = data.tents.map(t=> t.id===tentId ? { ...t, state: toState } : t);
    const resUpd = data.reservations.map(r=> r.id===resId ? { ...r, status:newStatus } : r);
    await mergeState({ tents: tentsUpd, reservations: resUpd }, `Liberar toldo #${tentId}`);
    if(myPendingResId===resId) setMyPendingResId(null);
    if(selectedTent?.id===tentId && toState!=="pr") setSelectedTent(null);
  }
  async function confirmPaid(tentId, resId){
    const tentsUpd = data.tents.map(t=> t.id===tentId ? { ...t, state:"oc" } : t);
    const resUpd = data.reservations.map(r=> r.id===resId ? { ...r, status:"paid" } : r);
    await mergeState({ tents: tentsUpd, reservations: resUpd }, `Pago confirmado #${tentId}`);
    if(myPendingResId===resId) setMyPendingResId(null);
  }

  // ===== WhatsApp =====
  const openWhatsApp = () => {
    const num = (data.payments.whatsapp || "").replace(/[^0-9]/g, "");
    if(!num) return alert("Configura el número de WhatsApp en Admin → Pagos");
    if(!selectedTent) return alert("Selecciona un toldo disponible primero");
    if(!userForm.name || !userForm.phone){ alert("Completa tu nombre y teléfono."); return; }
    const cur = data.payments.currency || "USD";
    const extrasLines = cart.length
      ? cart.map(x=> `• ${x.name} x${x.qty} — ${cur} ${(x.price * x.qty).toFixed(2)}`).join("\n")
      : "• Sin extras";
    const metodo = (payTab==="mp" ? "Mercado Pago" : payTab==="pm" ? "Pago Móvil" : payTab==="zelle" ? "Zelle" : "—");
    const fecha = new Date(); const fechaTxt = fecha.toLocaleDateString() + " " + fecha.toLocaleTimeString();
    const msg = [
      `Hola 👋, me gustaría realizar una *reserva en ${data.brand?.name || "su establecimiento"}*.`,
      "",
      `*Código:* ${resCode}`,
      `*Toldo:* #${selectedTent?.id}`,
      `*Fecha/hora:* ${fechaTxt}`,
      "",
      "*Cliente*",
      `• Nombre: ${userForm.name}`,
      `• Teléfono (WhatsApp): ${userForm.phone}`,
      userForm.email ? `• Email: ${userForm.email}` : null,
      "",
      "*Extras*",
      extrasLines,
      "",
      `*Total estimado:* ${cur} ${total.toFixed(2)}`,
      `*Método de pago:* ${metodo}`,
      "",
      "Adjunto mi comprobante. ¿Podrían confirmar la reserva cuando esté verificado? ✅",
      "¡Muchas gracias! 🙌"
    ].filter(Boolean).join("\n");
    const txt = encodeURIComponent(msg);
    
  msg.push(`*Total:* ${data.payments.currency} ${total.toFixed(2)}${data.payments.usdToVES ? ` (Bs ${(total*(data.payments.usdToVES||0)).toFixed(2)})` : ""}`);
window.open(`https://wa.me/${num}?text=${txt}`, "_blank");
  };

  // ===== Admin handlers (autosave sincronizado) =====
  const onChangeBrandName = async (v)=> mergeState({ brand: { ...data.brand, name: v } }, "Editar marca");
  const onChangeLogoUrl = async (v)=> mergeState({ brand: { ...data.brand, logoUrl: v } }, "Editar logo");
  const onChangeLogoSize = async (v)=> mergeState({ brand: { ...data.brand, logoSize: v } }, "Tamaño logo");
  const onChangeBgPath  = async (v)=> mergeState({ background: { ...data.background, publicPath: v } }, "Editar fondo");
  const onChangePayments = async (patch)=> mergeState({ payments: {
    usdToVES: 0, ...data.payments, ...patch } }, "Editar pagos");

  // Seed grid if empty
  const regenGrid = async ()=>{
    const tents = makeGrid(data.layout.count || 20);
    await mergeState({ tents }, "Regenerar grilla");
  };

  // Hotkeys
  useEffect(()=>{
    const onKey = (e)=>{
      if((e.key==="a"||e.key==="A") && (e.altKey||e.metaKey)){ setAdminOpen(true); setAuthed(false); }
    };
    window.addEventListener("keydown", onKey);
    return ()=> window.removeEventListener("keydown", onKey);
  }, []);

  const bustLogo = `${data.brand.logoUrl || "/logo.png"}?v=${sessionRevParam}`;
  const bustMap  = `${data.background.publicPath || "/Mapa.png"}?v=${sessionRevParam}`;

  return (
    <div className="app-shell" onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
      <div className="phone">
        {/* Fondo */}
        <div className="bg" style={{ backgroundImage: `url('${bustMap}')` }} />
        {!bgOk && <div className="bg-fallback">No se encontró el mapa en {data.background.publicPath}. Verifica nombre/capitalización o súbelo a /public.</div>}
        {/* TOPBAR */}
        <div className="topbar" ref={topbarRef}>
          <img
            src={bustLogo}
            alt="logo"
            width={data.brand.logoSize} height={data.brand.logoSize}
            style={{ objectFit:"contain", borderRadius:12, filter:"drop-shadow(0 1px 2px rgba(0,0,0,.5))" }}
            onDoubleClick={()=>{ setAdminOpen(true); setAuthed(false); }}
            onError={(e)=>{ e.currentTarget.src = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='100%' height='100%' fill='%23131a22'/><text x='50%' y='55%' dominant-baseline='middle' text-anchor='middle' fill='%23cbd5e1' font-size='10'>LOGO</text></svg>`; }}
          />
          <div className="brand">{data.brand.name}</div>
            {myRes && remainingMs>0 && (
              <div className="timer-inline" title="Reserva en proceso">
                <span className="timer-emoji">⏳</span>
                <span className="timer-text">{String(mm).padStart(2,'0')}:{String(ss).padStart(2,'0')}</span>
              </div>
            )}

          <div className="spacer" />
          {/* Leyenda */}
          <div className="legend" style={{ top: `${topInsetPx}px` }}>
            <div style={{ fontWeight:800, marginBottom:4 }}>Estados</div>
            <div className="row"><span className="dot av"></span> Disponible</div>
            <div className="row"><span className="dot pr"></span> En proceso</div>
            <div className="row"><span className="dot oc"></span> Ocupada</div>
            <div className="row"><span className="dot bl"></span> Bloqueada</div>
          </div>

          {/* Botón Admin */}
          <button className="iconbtn" title="Admin" onClick={()=>{ setAdminOpen(true); setAuthed(false); }}>
            <svg viewBox="0 0 24 24" width="22" height="22"><path fill="#cbd5e1" d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 1h-3.8a.5.5 0 0 0-.49.41l-.36 2.54c-.58.22-1.13.52-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.81 7.97a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.69.22l2.39-.96c.5.42 1.05.72 1.63.94l.36 2.54c.04.24.25.41.49.41h3.8c.24 0 .45-.17.49-.41l.36-2.54c.58-.22 1.13-.52 1.63-.94l2.39.96c.26.12.55.02.69-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"/></svg>
          </button>
        </div>

        {/* TOLDOS ABSOLUTOS */}
        <div className="tents-abs" style={{ inset: `${topInsetPx}px 12px 12px 12px` }}>
          {data.tents.map((t)=>(
            <div
              key={t.id}
              className={`tent ${t.state} ${selectedTent?.id===t.id ? "selected" : ""}`}
              style={{ left:`${t.x*100}%`, top:`${t.y*100}%` }}
              title={`Toldo ${t.id}`}
              onMouseDown={()=> onTentDown(t.id)}
              onClick={()=> onTentClick(t)}
            >
              {t.id}
            </div>
          ))}
        </div>

        {/* SHEET */}
        {!editingMap && (
          <div className={`sheet ${sheetCollapsed ? "collapsed" : ""}`}>
            <div className="sheet-header">
              <div className={`tab ${sheetTab==="toldo"?"active":""}`} onClick={()=> setSheetTab("toldo")}>Toldo</div>
              <div className={`tab ${sheetTab==="extras"?"active":""}`} onClick={()=> setSheetTab("extras")}>Extras</div>
              <div className={`tab ${sheetTab==="carrito"?"active":""}`} onClick={()=> setSheetTab("carrito")}>Carrito</div>
              <div className="spacer"></div>
              <button className="iconbtn" title={sheetCollapsed ? "Expandir" : "Colapsar"} onClick={()=> setSheetCollapsed(v=>!v)}>{sheetCollapsed ? "▲" : "▼"}</button>
            </div>
            <div className="sheet-body">
              {sheetTab==="toldo" && (
                <div className="list">
                  <div className="item">
                    <div className="title">Reservar Toldo</div>
                    <div className="hint" style={{ marginTop:6 }}>Toca un toldo <b>disponible</b> en el mapa. Luego pulsa “Continuar”.</div>
                    <div style={{ marginTop:8 }}>
                      {selectedTent ? <div>Seleccionado: <b>Toldo {selectedTent.id}</b></div> : <div className="hint">Ningún toldo seleccionado</div>}
                    </div>
                    <div className="row" style={{ marginTop:8, gap:8 }}>
                      <button className="btn" onClick={()=>{ if(!selectedTent) return; setSelectedTent(null); emptyCart(); }}>Quitar selección</button>
                      <button className="btn primary" disabled={!selectedTent} onClick={()=> setSheetTab("extras")} title={!selectedTent?"Primero selecciona un toldo":""}>Continuar a Extras</button>
                    </div>
                  </div>
                </div>
              )}

              {sheetTab==="extras" && (
                <div className="list">
                  {data.categories.map((cat)=>(
                    <div key={cat.id} className="item">
                      <div className="title" style={{ marginBottom:6 }}>{cat.name}</div>
                      <div className="list">
                        {cat.items.length===0 ? (
                          <div className="hint">Sin ítems</div>
                        ) : (
                          cat.items.map((it)=>(
                            <div key={it.id} className="row" style={{ justifyContent:"space-between" }}>
                              <div className="row" style={{ gap:8 }}>
                                {it.img && <img src={`${it.img}?v=${sessionRevParam}`} alt="" className="thumb" />}
                                <div>{it.name} <span className="hint">${it.price.toFixed(2)}</span></div>
                              </div>
                              <div className="row">
                                <button className="btn" onClick={()=> removeOne(it)}>-</button>
                                <div className="btn alt">{qtyOf(it.id)}</div>
                                <button className="btn" onClick={()=> addOne(it)}>+</button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {sheetTab==="carrito" && (
                <div className="list">
                  {!selectedTent && cart.length===0 && <div className="hint">Aún no seleccionas toldo ni extras.</div>}
                  {selectedTent && (
                    <div className="item">
                      <div className="title">Toldo seleccionado</div>
                      <div> Toldo <b>#{selectedTent.id}</b></div>
                    </div>
                  )}
                  {cart.length > 0 && (
                    <div className="item">
                      <div className="title" style={{ marginBottom:6 }}>Tus extras</div>
                      <div className="list">
                        {cart.map(row => (
                          <div key={row.key} className="row" style={{ justifyContent:"space-between" }}>
                            <div>{row.name} <span className="hint">x{row.qty}</span></div>
                            <button className="btn" onClick={()=> delLine(row.key)}>Quitar</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="sheet-footer">
              <button className="btn" onClick={()=> setSheetTab(sheetTab==="carrito" ? "extras" : "carrito")}>Ir a {sheetTab==="carrito" ? "Extras" : "Carrito"}</button>
              <div className="total">Total: {data.payments.currency} {total.toFixed(2)}{data.payments.usdToVES? `  |  Bs ${ (total*(data.payments.usdToVES||0)).toFixed(2) }` : ""}</div>
              <button className="btn primary" disabled={!selectedTent} title={!selectedTent ? "Primero selecciona un toldo" : ""} onClick={reservar}>Reservar</button>
            </div>
          </div>
        )}

        {/* ADMIN */}
        {adminOpen && (
          <div className="overlay" onClick={(e)=>{ if(e.target===e.currentTarget) setAdminOpen(false); }}>
            {!authed ? (
              <div className="modal">
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                  <div style={{ fontWeight:800, fontSize:16 }}>Ingresar al Administrador</div>
                  <div className="spacer"></div>
                  <button className="btn" onClick={()=> setAdminOpen(false)}>Cerrar</button>
                </div>
                <div className="row">
                  <input className="input" id="pin" placeholder="PIN" type="password" />
                  <button className="btn primary" onClick={()=>{
                    const v = document.getElementById("pin").value;
                    (v === (data.security?.adminPin||DEFAULT_PIN)) ? setAuthed(true) : alert("PIN inválido");
                  }}>Entrar</button>
                </div>
                <div className="hint" style={{ marginTop:6 }}>Atajos: Alt/⌥+A • doble clic en el logo.</div>
              </div>
            ) : (
              <div className="modal">
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
                  <div style={{ fontWeight:800, fontSize:16 }}>Administrador</div>
                  <div className="spacer"></div>
                  <button className="btn" onClick={()=> setAuthed(false)}>Salir</button>
                  <button className="btn" onClick={()=> setAdminOpen(false)}>Cerrar</button>
                </div>

                <div className="tabs">
                  <div className={`tab-admin ${adminTab==="catalogo" ? "active":""}`} onClick={()=> setAdminTab("catalogo")}>Catálogo</div>
                  <div className={`tab-admin ${adminTab==="marca" ? "active":""}`} onClick={()=> setAdminTab("marca")}>Marca & Fondo</div>
                  <div className={`tab-admin ${adminTab==="layout" ? "active":""}`} onClick={()=> setAdminTab("layout")}>Layout</div>
                  <div className={`tab-admin ${adminTab==="pagos" ? "active":""}`} onClick={()=> setAdminTab("pagos")}>Pagos</div>
   
                    <div className="item">
                      <div className="title">Precio de Toldo</div>
                      <div className="row" style={{ gap:8, flexWrap:"wrap", alignItems:"center" }}>
                        <label><div>Seleccionar toldo</div>
                          <select className="input" value={selectedTent?.id || ""}
                            onChange={(e)=>{
                              const id = parseInt(e.target.value||"");
                              const t = (data.tents||[]).find(x=> x.id===id);
                              setSelectedTent(t||null);
                            }}>
                            <option value="">—</option>
                            {(data.tents||[]).map(t=> <option key={t.id} value={t.id}>#{t.id}</option>)}
                          </select>
                        </label>
                        <label><div>Precio (USD)</div>
                          <input className="input" type="number" min="0" step="0.5"
                            disabled={!selectedTent}
                            value={selectedTent?.price ?? ""}
                            onChange={async (e)=>{
                              const val = parseFloat(e.target.value||"0")||0;
                              if(!selectedTent) return;
                              const tentsUpd = data.tents.map(t=> t.id===selectedTent.id ? { ...t, price: val } : t);
                              await mergeState({ tents: tentsUpd }, "Editar precio toldo");
                              const t2 = tentsUpd.find(x=> x.id===selectedTent.id);
                              setSelectedTent(t2||null);
                            }} />
                        </label>
                      </div>
                    </div>
               <div className={`tab-admin ${adminTab==="oper" ? "active":""}`} onClick={()=> setAdminTab("oper")}>Operación</div>
                  <div className={`tab-admin ${adminTab==="log" ? "active":""}`} onClick={()=> setAdminTab("log")}>Log</div>
                </div>

                {adminTab==="catalogo" && (
                  <div>
                    {/* Seguridad */}
                    <div className="item">
                      <div className="title">Seguridad</div>
                      <div className="row" style={{ gap:8, flexWrap:"wrap", alignItems:"center" }}>
                        <label><div>PIN Admin</div>
                          <input className="input" type="password" placeholder="1234" value={data.security?.adminPin||""}
                            onChange={async (e)=>{
                              const pin = (e.target.value||"").trim();
                              await mergeState({ security: { ...(data.security||{}), adminPin: pin } }, "Cambiar PIN");
                            }} />
                        </label>
                      </div>
                    </div>

                    <div className="row" style={{ marginBottom:8 }}>
                      <button className="btn" onClick={async ()=>{
                        const name = prompt("Nombre de la categoría:")?.trim(); if(!name) return;
                        const id = name.toLowerCase().replace(/[^a-z0-9]+/g,"-");
                        if(data.categories.some(c=> c.id===id)) return alert("Ya existe esa categoría");
                        await mergeState({ categories: [...data.categories, { id, name, items: [] }] }, "Agregar categoría");
                      }}>+ Categoría</button>
                    </div>
                    <div className="admin-scroll">
                      <div className="list">
                        {data.categories.map(cat => (
                          <div key={cat.id} className="item">
                            <div className="row" style={{ justifyContent:"space-between", marginBottom:6 }}>
                              <div className="title">{cat.name}</div>
                              <div className="row">
                                <button className="btn" onClick={async ()=>{
                                  const newName = prompt("Nuevo nombre:", cat.name)?.trim();
                                  if(!newName) return;
                                  const cats = data.categories.map(c=> c.id!==cat.id ? c : { ...c, name: newName });
                                  await mergeState({ categories: cats }, "Renombrar categoría");
                                }}>Renombrar</button>
                                <button className="btn danger" onClick={async ()=>{
                                  const cats = data.categories.filter(c=> c.id!==cat.id);
                                  await mergeState({ categories: cats }, "Eliminar categoría");
                                }}>Eliminar Cat.</button>
                              </div>
                            </div>
                            <div className="list">
                              {cat.items.length===0 ? (
                                <div className="hint">Sin ítems</div>
                              ) : (
                                cat.items.map(it => (
                                  <div key={it.id} className="row" style={{ justifyContent:"space-between" }}>
                                    <div className="row" style={{ gap:8 }}>
                                      {it.img && <img src={`${it.img}?v=${sessionRevParam}`} alt="" className="thumb" />}
                                      <div>{it.name} <span className="hint">${it.price.toFixed(2)}</span></div>
                                    </div>
                                    <div className="row">
                                      <button className="btn" onClick={async ()=>{
                                        const url = prompt("Ruta pública de la imagen (ej: /img/agua.png):", it.img || "")?.trim();
                                        if(url==null) return;
                                        const cats = data.categories.map(c=> c.id!==cat.id ? c : { ...c, items: c.items.map(x=> x.id!==it.id ? x : { ...x, img:url }) });
                                        await mergeState({ categories: cats }, "Imagen ítem");
                                      }}>Imagen</button>
                                      <button className="btn" onClick={async ()=>{
                                        const name = prompt("Nuevo nombre:", it.name)?.trim(); if(!name) return;
                                        const price = parseFloat(prompt("Nuevo precio:", String(it.price)) || String(it.price)) || it.price;
                                        const cats = data.categories.map(c=> c.id!==cat.id ? c : { ...c, items: c.items.map(x=> x.id!==it.id ? x : { ...x, name, price }) });
                                        await mergeState({ categories: cats }, "Editar ítem");
                                      }}>Editar</button>
                                      <button className="btn danger" onClick={async ()=>{
                                        const cats = data.categories.map(c=> c.id!==cat.id ? c : { ...c, items: c.items.filter(x=> x.id!==it.id) });
                                        await mergeState({ categories: cats }, "Eliminar ítem");
                                      }}>Borrar</button>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                            <div className="row" style={{ marginTop:8 }}>
                              <button className="btn" onClick={async ()=>{
                                const name = prompt("Nombre del ítem:")?.trim(); if(!name) return;
                                const price = parseFloat(prompt("Precio:") || "0") || 0;
                                const id = name.toLowerCase().replace(/[^a-z0-9]+/g,"-");
                                const cats = data.categories.map(c=> c.id!==cat.id ? c : { ...c, items: [...c.items, { id, name, price, img:"" }] });
                                await mergeState({ categories: cats }, "Agregar ítem");
                              }}>+ Ítem</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
)}

                {adminTab==="marca" && (
                  <div>
                    <div className="grid2">
                      <label><div>Nombre de marca</div>
                        <input className="input" value={data.brand.name} onChange={(e)=> onChangeBrandName(e.target.value)} />
                      </label>
                      <label><div>Tamaño del logo</div>
                        <input className="input" type="number" min={24} max={120} value={data.brand.logoSize} onChange={(e)=> onChangeLogoSize(Math.max(24, Math.min(120, parseInt(e.target.value||"40"))))} />
                      </label>
                    </div>
                    <div className="grid2" style={{ marginTop:8 }}>
                      <label><div>Logo – ruta pública</div>
                        <input className="input" placeholder="/logo.png" value={data.brand.logoUrl} onChange={(e)=> onChangeLogoUrl(e.target.value)} />
                      </label>
                      <label><div>Fondo – ruta pública</div>
                        <input className="input" placeholder="/Mapa.png" value={data.background.publicPath} onChange={(e)=> onChangeBgPath(e.target.value)} />
                      </label>
                      <div className="row" style={{ marginTop:8 }}>
                        <button className="btn" onClick={async ()=>{
                          // Bump rev to force cache-busting of background
                          try{
                            await mergeState({ __touch: Date.now() }, "Refrescar mapa");
                          }catch(e){}
                        }}>Refrescar mapa (forzar cache)</button>
                        <div className="hint">Si cambiaste el archivo en /public, usa este botón para que todos vean el mapa nuevo.</div>
                      </div>

                    </div>
                  </div>
                )}

                {adminTab==="layout" && (
                  <div>
                    <div className="row" style={{ flexWrap:"wrap", gap:8 }}>
                      <button className="btn" onClick={()=> setEditingMap(v=>!v)}>{editingMap ? "Dejar de editar mapa" : "Editar mapa (drag&drop)"}</button>
                      <button className="btn" onClick={regenGrid}>Regenerar en rejilla</button>
                      <button className="btn" onClick={async ()=>{
                        // Add tent
                        const last = data.tents[data.tents.length-1];
                        const t = { id: (last?.id||0)+1, state:"av", x:0.5, y:0.5 };
                        await mergeState({ tents: [...data.tents, t] }, "Agregar toldo");
                      }}>+ Agregar Toldo</button>
                    </div>
                    <div className="row" style={{ marginTop:8 }}>
                      <input className="input" type="number" min={1} value={data.layout.count}
                        onChange={async (e)=>{
                          const cnt = Math.max(1, parseInt(e.target.value||"1"));
                          await mergeState({ layout: { ...data.layout, count: cnt } }, "Editar cantidad");
                        }} />
                    </div>
                    <div className="hint" style={{ marginTop:6 }}>Al editar, se oculta la hoja inferior para arrastrar hasta abajo del mapa.</div>
                  </div>
                )}

                {adminTab==="pagos" && (
                  <div>
                    <div className="grid2">
                      <label><div>Moneda</div>
                        <input className="input" value={data.payments.currency} onChange={(e)=> onChangePayments({ currency:e.target.value })} />
                      </label>
                      <label><div>Tasa Bs/USD</div>
                        <input className="input" type="number" min="0" step="0.01" value={data.payments.usdToVES||0}
                          onChange={(e)=> onChangePayments({ usdToVES: parseFloat(e.target.value||"0") })} />
                      </label>

                      <label><div>WhatsApp (Ejem 58412...)</div>
                        <input className="input" value={data.payments.whatsapp} onChange={(e)=> onChangePayments({ whatsapp:e.target.value })} />
                      </label>
                    </div>
                    <div className="hr"></div>
                    <div className="title">Mercado Pago</div>
                    <div className="grid2" style={{ marginTop:6 }}>
                      <label><div>Link de pago</div>
                        <input className="input" placeholder="https://..." value={data.payments.mp.link} onChange={(e)=> onChangePayments({ mp: { ...data.payments.mp, link:e.target.value } })} />
                      </label>
                      <label><div>Alias / Comentario</div>
                        <input className="input" value={data.payments.mp.alias} onChange={(e)=> onChangePayments({ mp: { ...data.payments.mp, alias:e.target.value } })} />
                      </label>
                    </div>
                    <div className="hr"></div>
                    <div className="title">Pago Móvil</div>
                    <div className="grid2" style={{ marginTop:6 }}>
                      <label><div>Banco</div>
                        <input className="input" value={data.payments.pagoMovil.bank} onChange={(e)=> onChangePayments({ pagoMovil: { ...data.payments.pagoMovil, bank:e.target.value } })} />
                      </label>
                      <label><div>RIF / CI</div>
                        <input className="input" value={data.payments.pagoMovil.rif} onChange={(e)=> onChangePayments({ pagoMovil: { ...data.payments.pagoMovil, rif:e.target.value } })} />
                      </label>
                      <label><div>Teléfono</div>
                        <input className="input" value={data.payments.pagoMovil.phone} onChange={(e)=> onChangePayments({ pagoMovil: { ...data.payments.pagoMovil, phone:e.target.value } })} />
                      </label>
                    </div>
                    <div className="hr"></div>
                    <div className="title">Zelle</div>
                    <div className="grid2" style={{ marginTop:6 }}>
                      <label><div>Email</div>
                        <input className="input" value={data.payments.zelle.email} onChange={(e)=> onChangePayments({ zelle: { ...data.payments.zelle, email:e.target.value } })} />
                      </label>
                      <label><div>Nombre</div>
                        <input className="input" value={data.payments.zelle.name} onChange={(e)=> onChangePayments({ zelle: { ...data.payments.zelle, name:e.target.value } })} />
                      </label>
                    </div>
                  </div>
                )}

                {adminTab==="oper" && (
                  <div>
                    <div className="item">
                      <div className="title">Cambiar estado de toldos</div>
                      <div className="row" style={{ marginTop:8 }}>
                        <select className="select" onChange={(e)=>{
                          const id = parseInt(e.target.value||"0");
                          const t = data.tents.find(x=> x.id===id) || null;
                          setSelectedTent(t);
                        }} value={selectedTent?.id || ""}>
                          <option value="">— Seleccionar toldo —</option>
                          {data.tents.map(t=>(<option key={t.id} value={t.id}>#{t.id} ({t.state})</option>))}
                        </select>
                        {selectedTent && (
                          <>
                            <button className="btn" onClick={()=> mergeState({ tents: data.tents.map(t=> t.id===selectedTent.id ? { ...t, state:"av" } : t) }, "AV")}>Disponible</button>
                            <button className="btn" onClick={()=> mergeState({ tents: data.tents.map(t=> t.id===selectedTent.id ? { ...t, state:"oc" } : t) }, "OC")}>Ocupada</button>
                            <button className="btn" onClick={()=> mergeState({ tents: data.tents.map(t=> t.id===selectedTent.id ? { ...t, state:"bl" } : t) }, "BL")}>Bloqueada</button>
                          </>
                        )}
                      </div>
                    </div>

                    {selectedTent && (
                      <div className="item" style={{ marginTop:10 }}>
                        <div className="title">Reserva pendiente del toldo #{selectedTent.id}</div>
                        {(()=>{
                          const pending = data.reservations.filter(r=> r.tentId===selectedTent.id && r.status==="pending").sort((a,b)=> a.createdAt>b.createdAt?-1:1)[0];
                          if(!pending) return <div className="hint">No hay reservas pendientes.</div>;
                          return (
                            <>
                              <div className="hint" style={{ marginTop:4 }}>
                                Cliente: <b>{pending.customer?.name || "—"}</b> | Tel: <b>{pending.customer?.phone || "—"}</b> | Expira: <b>{new Date(pending.expiresAt).toLocaleTimeString()}</b>
                              </div>
                              <div className="row" style={{ marginTop:8 }}>
                                <button className="btn primary" onClick={()=> confirmPaid(selectedTent.id, pending.id)}>Confirmar pago (OC)</button>
                                <button className="btn danger" onClick={()=> releaseTent(selectedTent.id, pending.id, "av", "expired")}>Cancelar y liberar</button>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}

                {adminTab==="log" && (
                  <div className="admin-scroll">
                    <div className="list">
                      {data.logs.length===0 ? (
                        <div className="hint">Sin eventos aún…</div>
                      ) : data.logs.map((row, i)=>(
                        <div key={i} className="item">
                          <div className="row">
                            <div className="hint">{new Date(row.ts).toLocaleString()}</div>
                            <div className="btn alt">{row.type}</div>
                          </div>
                          <div style={{ marginTop:6 }}>{row.message}</div>
                        </div>
                      ))}
                    </div>
                    <div className="row" style={{ marginTop:8, justifyContent:"flex-end" }}>
                      <button className="btn" onClick={async ()=> mergeState({ logs: [] }, "Limpiar log")}>Limpiar log</button>
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>
        )}

        {/* MODAL DE PAGO */}
        {payOpen && (
          <div className="overlay" onClick={(e)=>{ if(e.target===e.currentTarget) setPayOpen(false); }}>
            <div className="modal">
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ fontWeight:800, fontSize:16 }}>Confirmar Reserva</div>
                <div className="spacer" />
                <button className="btn danger" onClick={async ()=>{
                  const r = data.reservations.find(x=> x.id===myPendingResId && x.status==="pending");
                  if(r) await releaseTent(r.tentId, r.id, "av", "expired");
                  setPayOpen(false);
                }}>Cancelar y liberar</button>
                <button className="btn" onClick={()=> setPayOpen(false)}>Cerrar</button>
              </div>

              <div className="hint" style={{ marginTop:6 }}>
                Código: <b>{resCode}</b> — Toldo #{selectedTent?.id} — Total: {data.payments.currency} {total.toFixed(2)}
              </div>

              <div className="item" style={{ marginTop:8 }}>
                <div className="title">Tus datos</div>
                <div className="grid2" style={{ marginTop:6 }}>
                  <label><div>Nombre y Apellido</div>
                    <input className="input" value={userForm.name} onChange={(e)=> setUserForm(u=> ({ ...u, name:e.target.value }))} />
                  </label>
                  <label>
                  <div>Teléfono (WhatsApp)</div>
                  <div className="row" style={{ marginTop: 4 }}>
                    <select
                      className="select"
                      value={userForm.phoneCountry}
                      onChange={(e) => setUserForm((u) => ({ ...u, phoneCountry: e.target.value }))}
                    >
                      <option value="+58">(+58) Venezuela</option>
                      <option value="+57">(+57) Colombia</option>
                      <option value="+1">(+1) USA/Canadá</option>
                      <option value="+52">(+52) México</option>
                      <option value="+54">(+54) Argentina</option>
                      <option value="+34">(+34) España</option>
                      <option value="+55">(+55) Brasil</option>
                      <option value="+56">(+56) Chile</option>
                      <option value="+51">(+51) Perú</option>
                      <option value="+593">(+593) Ecuador</option>
                      <option value="+507">(+507) Panamá</option>
                    </select>
                    <input
                      className="input"
                      placeholder="4120239460"
                      value={userForm.phone}
                      onChange={(e) => setUserForm((u) => ({ ...u, phone: e.target.value }))}
                    />
                  </div>
                  <div className="hint" style={{ marginTop: 4 }}>
                    Formato: solo números, sin 0 inicial, ni + ni espacios. Se enviará como {`${userForm.phoneCountry}${(userForm.phone || '').replace(/[^0-9]/g, '')}` }.
                  </div>
                </label>
                </div>
                <div className="row" style={{ marginTop:6 }}>
                  <input className="input" placeholder="Correo (opcional)" value={userForm.email} onChange={(e)=> setUserForm(u=> ({ ...u, email:e.target.value }))} />
                </div>
              </div>

              <div className="tabs" style={{ marginTop:10 }}>
                <div className={`tab-admin ${payTab==="mp" ? "active":""}`} onClick={()=> setPayTab("mp")}>Mercado Pago</div>
                <div className={`tab-admin ${payTab==="pm" ? "active":""}`} onClick={()=> setPayTab("pm")}>Pago Móvil</div>
                <div className={`tab-admin ${payTab==="zelle" ? "active":""}`} onClick={()=> setPayTab("zelle")}>Zelle</div>
              </div>

              {payTab==="mp" && (
                <div className="item" style={{ marginTop:8 }}>
                  <div className="title">Mercado Pago</div>
                  <div className="hint">Usa tu link de pago o alias configurado.</div>
                  <div className="row" style={{ marginTop:8 }}>
                    <input className="input" readOnly value={data.payments.mp.link || data.payments.mp.alias || "(Configura en Admin → Pagos)"} />
                    {data.payments.mp.link && (<a className="btn" href={data.payments.mp.link} target="_blank" rel="noreferrer">Abrir</a>)}
                  </div>
                </div>
              )}

              {payTab==="pm" && (
                <div className="item" style={{ marginTop:8 }}>
                  <div className="title">Pago Móvil</div>
                  <div className="row" style={{ marginTop:6 }}>
                    <div className="grow">Banco: <b>{data.payments.pagoMovil.bank || "–"}</b></div>
                    <button className="btn copy" onClick={()=> navigator.clipboard.writeText(data.payments.pagoMovil.bank || "")}>Copiar</button>
                  </div>
                  <div className="row">
                    <div className="grow">RIF/CI: <b>{data.payments.pagoMovil.rif || "–"}</b></div>
                    <button className="btn copy" onClick={()=> navigator.clipboard.writeText(data.payments.pagoMovil.rif || "")}>Copiar</button>
                  </div>
                  <div className="row">
                    <div className="grow">Teléfono: <b>{data.payments.pagoMovil.phone || "–"}</b></div>
                    <button className="btn copy" onClick={()=> navigator.clipboard.writeText(data.payments.pagoMovil.phone || "")}>Copiar</button>
                  </div>
                </div>
              )}

              {payTab==="zelle" && (
                <div className="item" style={{ marginTop:8 }}>
                  <div className="title">Zelle</div>
                  <div className="row" style={{ marginTop:6 }}>
                    <div className="grow">Email: <b>{data.payments.zelle.email || "–"}</b></div>
                    <button className="btn copy" onClick={()=> navigator.clipboard.writeText(data.payments.zelle.email || "")}>Copiar</button>
                  </div>
                  <div className="row">
                    <div className="grow">Nombre: <b>{data.payments.zelle.name || "–"}</b></div>
                    <button className="btn copy" onClick={()=> navigator.clipboard.writeText(data.payments.zelle.name || "")}>Copiar</button>
                  </div>
                </div>
              )}

              <div className="hr"></div>
              <div className="item">
                <div className="title">Enviar solicitud</div>
                <div className="row" style={{ marginTop:6 }}>
                  <button className="btn primary" onClick={openWhatsApp}>Enviar por WhatsApp</button>
                </div>
                <div className="hint" style={{ marginTop:6 }}>La confirmación y el cambio de estado lo realiza el administrador en <b>Operación</b>.</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
