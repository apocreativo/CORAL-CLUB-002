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
      setSessionRevParam(String(r||0));
      return;
    }
    throw new Error("kvMerge null");
  }catch(e){
    setData(s => ({ ...s, ...patch }));
    setSessionRevParam(v => String((+v||0)+1));
  }



// Multiusuario: poll de rev para rehidratar cambios (no modifica UI)
useEffect(()=>{
  let on = true;
  const tick = async ()=>{
    const r = await kvGet(REV_KEY);
    if(!on) return;
    if(r!=null){
      setSessionRevParam(String(r));
      const st = await kvGet(STATE_KEY);
      if(st) setData(st);
    }
  };
  const id = setInterval(tick, 1500);
  tick();
  return ()=>{ on=false; clearInterval(id); };
}, []);
