# Multiusuario mínimo (sin tocar UI)

1) Variables en Vercel → Settings → Environment Variables:
   - KV_REST_API_URL
   - KV_REST_API_TOKEN
2) Deploy. Las funciones están en /api:
   - /api/kv-get.js
   - /api/kv-incr.js
   - /api/kv-merge.js
3) El front usa kvMerge() en mergeState y hace poll de rev cada 1.5s.
