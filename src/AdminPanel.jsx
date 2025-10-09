
import React from "react";

export default function AdminPanel({selectedTent, setTentState, setTentPrice, exportJSON, importJSON, resetGrid}){
  if(!selectedTent){
    return (
      <div className="item">
        <div className="title">Toldo</div>
        <div className="hint">Selecciona un toldo en el mapa para editar precio/estado.</div>
        <div className="row" style={{marginTop:8, gap:8, flexWrap:"wrap"}}>
          <button className="btn" onClick={resetGrid}>Recrear grid</button>
          <button className="btn" onClick={exportJSON}>Exportar JSON</button>
          <label className="btn">
            Importar JSON
            <input type="file" accept="application/json" style={{display:"none"}}
                   onChange={(e)=>{
                     const file = e.target.files?.[0];
                     if(!file) return;
                     const reader = new FileReader();
                     reader.onload = ()=> importJSON(reader.result);
                     reader.readAsText(file);
                   }}/>
          </label>
        </div>
      </div>
    );
  }
  return (
    <div className="item">
      <div className="title">Toldo #{selectedTent.id}</div>
      <div className="row" style={{gap:8, alignItems:"center"}}>
        <label>Precio:</label>
        <input type="number" defaultValue={selectedTent.price||0} min="0" step="0.5"
               onBlur={(e)=> setTentPrice(selectedTent.id, e.target.value)}
               style={{width:100}}/>
      </div>
      <div className="row" style={{gap:8, marginTop:8, flexWrap:"wrap"}}>
        <button className="btn" onClick={()=>setTentState(selectedTent.id, "av")}>Disponible</button>
        <button className="btn" onClick={()=>setTentState(selectedTent.id, "pr")}>Hold</button>
        <button className="btn" onClick={()=>setTentState(selectedTent.id, "rs")}>Reservado</button>
        <button className="btn" onClick={()=>setTentState(selectedTent.id, "bl")}>Bloqueado</button>
      </div>
      <div className="row" style={{marginTop:8, gap:8, flexWrap:"wrap"}}>
        <button className="btn" onClick={exportJSON}>Exportar JSON</button>
        <label className="btn">
          Importar JSON
          <input type="file" accept="application/json" style={{display:"none"}}
                 onChange={(e)=>{
                   const file = e.target.files?.[0];
                   if(!file) return;
                   const reader = new FileReader();
                   reader.onload = ()=> importJSON(reader.result);
                   reader.readAsText(file);
                 }}/>
        </label>
        <button className="btn" onClick={resetGrid}>Recrear grid</button>
      </div>
      <div className="hint" style={{marginTop:8}}>Colores: verde=Disponible, amarillo=Hold, rojo=Reservado, gris=Bloqueado.</div>
    </div>
  );
}
