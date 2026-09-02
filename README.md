# Alivia

Aplicación familiar para organizar medicamentos, inventario y presión arterial.

## Configuración

1. Ejecutar `supabase-step-2.sql` en el SQL Editor de Supabase.
2. Configurar en Coolify las variables de `.env.example`.
3. Mantener `OPENAI_API_KEY` como secreto; nunca subir `.env.local`.
4. En Supabase Auth > URL Configuration, usar la URL pública de Coolify como Site URL y Redirect URL.

## Desarrollo

```bash
npm install
npm run dev
```

## Producción

```bash
npm run build
npm start
```
