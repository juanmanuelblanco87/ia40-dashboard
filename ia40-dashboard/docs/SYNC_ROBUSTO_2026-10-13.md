# Sincronización robusta con Cobus/IA40 (13/10/2026)

Contexto: Importaciones "siempre se caía", unas categorías llegaban a julio y otras a agosto, y Sillas de ruedas aparecía en 0.

## Qué fallaba
1. El acceso (JWT) a Cobus dura ~15 min. Un cron lo renovaba cada 10 min abriendo un Chrome headless dentro de Vercel: en 48 hs fallaron 120 de 148 intentos.
2. La sync diaria (13:30 ART) bajaba TODAS las categorías en una sola función (tope 5 min). Con el acceso vencido en ese instante fallaba todo, sin reintento ni aviso (respondía 200).
3. `recomputeMonthlyAgg` hacía DELETE y luego INSERT en 2 pasos sueltos: si la función se cortaba en el medio, la categoría quedaba en 0.

## Qué cambió
- `lib/ia40Token.ts`: el acceso se renueva **a demanda** (login con hasta 3 intentos seguidos) sólo cuando hace falta; ya no hay cron cada 10 min. Si el login falla se espera 20 min antes de insistir.
- `lib/aggregate.ts`: `recomputeMonthlyAgg` es **atómico** (transacción) y nunca reemplaza un resumen con datos por uno vacío.
- `lib/syncRunner.ts` + `app/api/sync/route.ts`: la sync corre cada 15 min (vercel.json, 08–20 ART) y sólo trabaja sobre lo **pendiente de hoy**, la categoría más atrasada primero. Marca `running` en `sync_runs` al empezar; si la función se corta, queda `timeout` y el próximo intento usa una ventana de 6 meses. Una categoría que falla espera 45 min antes de reintentarse.
- `app/api/estado-datos` + `components/EstadoDatos.tsx`: en la pantalla principal se ve el estado de cada categoría (datos hasta qué mes, última sync OK, último error) y hay botones **Sincronizar ahora** / **Reintentar**.
- `app/api/ejecutar-sync`: lo que llaman esos botones (pasa por el login normal del dashboard).

## Notas
- `sync_runs.status` ahora puede ser: `running`, `ok`, `error`, `auth_error`, `timeout`.
- Si hay que volver atrás: revertir este commit y restaurar el cron `/api/refresh-ia40-token` (`*/10 * * * *`) en vercel.json.
- Pendiente a futuro: pedirle a Cobus un acceso de API / token de larga duración (lo único que elimina el login con navegador) y sacar del repo las credenciales en texto plano de `refresh_token.py`.
