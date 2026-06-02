# 🎵 Tunely — Backend API

Backend de Tunely: playlists colaborativas sincronizadas entre Spotify y YouTube Music.

## Stack

- **Runtime:** Node.js 18+  **Language:** TypeScript 5
- **Framework:** Express.js
- **Base de datos:** Supabase (PostgreSQL)
- **Auth:** JWT + OAuth 2.0 (Spotify / Google)
- **Jobs:** node-cron
- **Validación:** Joi  **Logging:** Winston

## Instalación

```bash
npm install
cp .env.example .env
# Completar .env con credenciales reales

# Generar ENCRYPTION_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npm run dev      # desarrollo
npm run build    # compilar
npm start        # producción (requiere build previo)
npm run typecheck# verificar tipos sin compilar
```

## Estructura

```
src/
├── config/
│   ├── env.ts              ← valida y exporta todas las variables de entorno
│   └── supabase.ts         ← cliente Supabase con service_role
├── types/
│   └── index.ts            ← todos los tipos e interfaces TypeScript
├── utils/
│   ├── crypto.ts           ← AES-256-GCM encrypt/decrypt para tokens OAuth
│   ├── logger.ts           ← Winston logger
│   └── response.ts         ← helpers de respuesta HTTP estandarizados
├── middlewares/
│   ├── auth.middleware.ts  ← JWT verify + requireRole()
│   ├── error.middleware.ts ← errorHandler global + notFoundHandler
│   └── validate.middleware.ts ← validación Joi de req.body
├── services/
│   ├── auth.service.ts     ← registro, login, JWT, OAuth Spotify/Google
│   ├── playlist.service.ts ← CRUD playlists, miembros, roles
│   ├── song.service.ts     ← búsqueda unificada
│   ├── sync.service.ts     ← orquestación de sincronización + cola
│   ├── matching.service.ts ← algoritmo Levenshtein ponderado (score 0-100)
│   ├── spotify.service.ts  ← Spotify Web API + token refresh automático
│   └── youtube.service.ts  ← YouTube Data API + token refresh automático
├── controllers/
│   ├── auth.controller.ts
│   ├── playlist.controller.ts
│   ├── song.controller.ts
│   ├── sync.controller.ts
│   └── user.controller.ts
├── routes/
│   ├── auth.routes.ts
│   ├── playlist.routes.ts
│   ├── song.routes.ts
│   ├── user.routes.ts
│   └── index.ts
├── jobs/
│   ├── syncQueue.job.ts    ← procesa cola cada 2 min
│   └── tokenRefresh.job.ts ← refresca tokens cada 5 min
└── server.ts               ← entry point
```

## Endpoints

| Método   | Ruta                                  | Auth | Descripción                        |
|----------|---------------------------------------|------|------------------------------------|
| POST     | `/api/auth/register`                  | —    | Registro email/contraseña          |
| POST     | `/api/auth/login`                     | —    | Login                              |
| POST     | `/api/auth/refresh`                   | —    | Refrescar access token             |
| GET      | `/api/auth/spotify`                   | JWT  | Iniciar OAuth Spotify              |
| GET      | `/api/auth/spotify/callback`          | —    | Callback OAuth Spotify             |
| GET      | `/api/auth/google`                    | JWT  | Iniciar OAuth Google               |
| GET      | `/api/auth/google/callback`           | —    | Callback OAuth Google              |
| GET      | `/api/users/me`                       | JWT  | Perfil del usuario                 |
| GET      | `/api/users/me/accounts`             | JWT  | Cuentas conectadas                 |
| GET      | `/api/users/me/activity`             | JWT  | Actividad del usuario              |
| GET      | `/api/songs/search?q=`               | JWT  | Búsqueda unificada Spotify+YouTube |
| GET      | `/api/playlists`                      | JWT  | Mis playlists                      |
| POST     | `/api/playlists`                      | JWT  | Crear playlist                     |
| POST     | `/api/playlists/join`                 | JWT  | Unirse con código                  |
| GET      | `/api/playlists/:id`                  | JWT  | Ver playlist                       |
| PUT      | `/api/playlists/:id`                  | JWT  | Editar (admin/owner)               |
| DELETE   | `/api/playlists/:id`                  | JWT  | Eliminar (owner)                   |
| GET      | `/api/playlists/:id/songs`            | JWT  | Canciones de la playlist           |
| POST     | `/api/playlists/:id/songs/add`        | JWT  | Agregar canción + sync             |
| POST     | `/api/playlists/:id/songs/confirm`    | JWT  | Confirmar match manual             |
| DELETE   | `/api/playlists/:id/songs/:songId`    | JWT  | Eliminar canción (admin/owner)     |
| GET      | `/api/playlists/:id/conflicts`        | JWT  | Ver conflictos de sync             |
| PUT      | `/api/playlists/:id/members/:userId/role` | JWT | Cambiar rol (owner)           |
| DELETE   | `/api/playlists/:id/members/:userId`  | JWT  | Eliminar miembro                   |
| GET      | `/api/health`                         | —    | Health check                       |
