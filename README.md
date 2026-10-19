# Geoportal Pokémon GO · Hábitats, Nidos y Avistamientos

Visor geográfico interactivo estilo Google Maps / Waze.
Stack: **React + Vite · OpenLayers · Proj4js · Uber H3 · Supabase Realtime · Tailwind CSS v4 · Lucide**.

## Estructura (SRP)

```
src/
├── config/
│   ├── constants.js        # Tipos Pokémon/hábitat, capas, resolución H3, tabla/RPC
│   ├── mapConfig.js        # Centro/zoom y capas base (OSM / CartoDB Positron)
│   └── supabaseClient.js   # Cliente Supabase (import.meta.env)
├── context/
│   ├── AvistamientosContext.jsx  # Datos, filtros, capas, selección y flujo de reporte
│   └── MapContext.jsx            # Instancia ol/Map + ubicación del usuario
├── hooks/
│   ├── useAvistamientos.js       # RPC + INSERT + Realtime
│   ├── useHabitats.js            # GeoJSON de hábitats (con respaldo demo)
│   ├── useOpenMap.js             # Ciclo de vida del mapa (3 capas vectoriales + cleanup)
│   ├── useAvistamientosLayer.js  # Avistamientos -> VectorSource
│   ├── useHabitatsLayer.js       # GeoJSON -> VectorSource
│   ├── useH3DensityLayer.js      # Análisis de densidad con mallas H3
│   └── useUserLocation.js        # Geolocation API
├── utils/
│   ├── spatialUtils.js   # proj4 (4326/3857/9377/3116) + h3-js (índices, vecinos, agregación)
│   ├── pokemonUtils.js   # Filtrado/validación puro
│   ├── formatUtils.js    # Antigüedad, distancias, enlace "Cómo llegar"
│   └── mapStyles.js      # Estilos OL (marcador, nido, hábitat, choropleth H3)
├── components/
│   ├── map/MapViewer.jsx # Contenedor + capas + botón "Mi Ubicación"
│   └── ui/
│       ├── SearchCard.jsx  # Búsqueda, tipo, toggles de capas, resolución H3
│       ├── DetailSheet.jsx # Bottom Sheet (móvil) / tarjeta lateral (desktop)
│       └── ReportCard.jsx  # Formulario de captura de avistamiento/nido
├── data/habitatsDemo.js  # GeoJSON de respaldo
├── App.jsx · main.jsx · index.css
```

## Puesta en marcha

```bash
npm install
cp .env.example .env   # completa VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev
```

Ejecuta `supabase/schema.sql` en el SQL Editor de Supabase (tablas, RLS, Realtime,
RPC `listar_avistamientos_recientes` y datos de ejemplo). Sin `.env` el mapa sigue
funcionando con el GeoJSON demo y muestra el aviso de configuración.

## Flujo de datos

1. `useAvistamientos` llama al RPC y se suscribe a Realtime (`INSERT`).
2. `AvistamientosContext` deriva los visibles con `filterAvistamientos` (pura).
3. `useAvistamientosLayer` reproyecta **EPSG:4326 → EPSG:3857** y crea features.
4. `singleclick` → si hay marcador selecciona; si no, entrega la coordenada
   (reproyectada a 4326) para capturar un reporte.

## CRS y H3

| Recurso | Detalle |
| --- | --- |
| EPSG:4326 | Dato fuente / GeoJSON — `[longitud, latitud]` |
| EPSG:3857 | Proyección del `View` de OpenLayers — `[x, y]` metros |
| EPSG:9377 / 3116 | Origen Nacional / Bogotá — `[Norte, Este]` metros |
| H3 resolución 9 | Celda por defecto del análisis de densidad |

El índice H3 se calcula con `h3-js` en el cliente al crear el reporte y se
persiste en `avistamientos.h3_index`; la capa "Malla H3" agrupa y pinta un
choropleth según el número de reportes por celda.
