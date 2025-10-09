# Multiusuario con Vercel KV

1) En Vercel → Storage → KV → Create Database
2) En tu proyecto (Settings → Environment Variables), agrega:
   - KV_REST_API_URL
   - KV_REST_API_TOKEN
3) Deploy. Las rutas API ya están en /api/kv-*. El front hace:
   - mergeState(patch) → /api/kv-merge (merge + bump rev)
   - Poll de rev cada ~1.5s → si cambia, rehidrata estado
Claves: STATE_KEY="coralclub:state", REV_KEY="coralclub:rev"
