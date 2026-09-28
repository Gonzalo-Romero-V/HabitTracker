# Habit Tracker — Frontend (Next.js)

Cliente web de Habit Tracker: Next.js (App Router) + TypeScript +
Tailwind v4 + shadcn/ui. El mismo código se empaqueta para Android con
Capacitor. Visión general en el [README raíz](../../README.md).

## Estructura

| Carpeta | Qué contiene |
|---|---|
| `src/app/(app)` | Pantallas autenticadas: `today`, `calendar`, `mori`, `analytics`, `habits`, `categories` |
| `src/app/(auth)`, `src/app/(onboarding)` | Login/registro y onboarding |
| `src/hooks` | Toda llamada a la API pasa por aquí (las páginas no hacen `fetch` directo) |
| `src/lib/api.ts` | `apiFetch` (envelope `{ data }`, errores `ApiError`, header `X-Client-Timezone`) y `apiFetchAllPages` para listados paginados |
| `src/components/custom` | Proveedores de formularios (hábito, categoría), `AuthGuard`, heatmap |

Reglas clave:

- Nada de lógica de negocio aquí: rachas, "debido hoy" y metas los decide
  el backend (`vault/decisions/architecture.md`).
- Los valores de métricas se muestran en unidad natural (minutos, monto) y
  se convierten a segundos o centavos al enviarlos (`lib/habit-form-utils.ts`).
- Todo el texto visible va en español neutro de Ecuador, con tú y sin
  voseo (`vault/decisions/i18n-copy.md` 🔒).

## Desarrollo

```bash
npm install
cp .env.example .env   # BACKEND_URL, NEXT_PUBLIC_GOOGLE_CLIENT_ID
npm run dev            # http://localhost:3000 — proxea /api/* al backend
```

Build web vs. build mobile (Capacitor, `BUILD_TARGET=mobile`):
[`vault/decisions/environments.md`](../../vault/decisions/environments.md).
Despliegue: [`DEPLOY.md`](../../DEPLOY.md).
