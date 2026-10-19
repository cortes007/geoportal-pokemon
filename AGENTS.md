# AGENTS.md 
---
## 1. Rol y Contexto del Proyecto
Geoportal Pokémon GO colaborativo para Medellín y el Valle de Aburrá, estilo Google Maps/Waze. Stack: React + Vite, OpenLayers, Tailwind, Supabase (Postgres con PostGIS, Auth, Storage, Realtime) y h3-js. Reglas: la lógica de datos vive en Supabase (SQL y funciones RPC) y el frontend solo muestra; el mapa inicia en Medellín (lat 6.2442, lon -75.5812, zoom 13) y solo se centra en el usuario cuando pulsa “Mi ubicación”; interfaz en español, móvil primero, tarjetas con efecto glass; siempre distinguir “reportado” de “probable”.
DIRECCIÓN DE PRODUCTO
El geoportal pasa a ser colaborativo, estilo Google Maps/Waze, para Medellín y el Valle de Aburrá.

### Reglas de producto:
- Todo dato mostrado se distingue como "Reportado" (lo hizo un usuario) o "Probable" (estimado por terreno). Nunca se mezclan bajo un solo número.
- La interfaz muestra niveles (baja, media, alta), nunca porcentajes exactos.
- La lógica de datos y de probabilidad vive en Supabase (SQL y RPC). El frontend solo la presenta.
- Los scripts de datos se escriben en Node. Python no está instalado y no debe instalarse.
- La service role key nunca va en el frontend ni en variables con prefijo VITE_. Solo en scripts locales leyendo un .env no versionado.
- El mapa inicia centrado en Medellín (lat 6.2442, lon -75.5812, zoom 13) y solo se mueve a la ubicación del usuario cuando pulsa "Mi ubicación".

Reglas de trabajo (se suman a las ya existentes en este archivo):
- Una fase por vez. Antes de ejecutar, presenta el plan y espera mi aprobación explícita.
- Respeta las decisiones registradas en MEMORY.md §4 y las reglas de estilo de §2 (cero hex crudo, tokens, SRP con ciclo de vida en /hooks).
- Al terminar cada fase: corre npm run build, comprueba los tokens con la rutina de MEMORY.md §11, actualiza MEMORY.md (decisiones y su porqué, estado medido, pendientes) y detente. No empieces la siguiente fase.
- No interactúes con git.
---

## 2. Principio Core: SOLID y Responsabilidad Única (SRP)
La regla de oro de este proyecto es SOLID, específicamente el **Single Responsibility Principle (SRP)**. Todo el código generado debe adherirse estrictamente a lo siguiente:

- **Componentes de UI (`/components`):** Su ÚNICA responsabilidad es renderizar la interfaz y escuchar eventos del usuario. NO deben contener lógica de negocio, llamadas a APIs complejas, ni transformaciones matemáticas espaciales.
- **Hooks Personalizados (`/hooks`):** Su ÚNICA responsabilidad es gestionar el ciclo de vida de React, conectar con el Contexto y coordinar la lógica entre la UI y las utilidades.
- **Utilidades (`/utils`):** Su ÚNICA responsabilidad es ejecutar lógica pura e independiente (ej. las funciones matemáticas de reproyección de `proj4` van aquí, no en los componentes).
- **Contexto (`/context`):** Su ÚNICA responsabilidad es proveer estado global a la aplicación, sin incluir lógica pesada de renderizado.

---

## 3. Reglas de Desarrollo (GIS & React)
- **Componentes Funcionales:** Usa siempre Functional Components y Hooks (`useState`, `useEffect`, `useRef`, `useCallback`, `useMemo`).
- **Inmutabilidad:** No mutes el estado directamente. Usa funciones puras.
- **Manejo de Mapas (OpenLayers):**
  - La instancia del mapa (`ol/Map`) se maneja a través de Referencias (`useRef`) o el Estado Global (`MapContext`).
  - En el cleanup de `useEffect` en los visores de mapa, destruye/limpia siempre la instancia (`map.setTarget(null)`) y desvincula eventos para evitar *memory leaks*.
  - Nunca re-renderices el mapa completo si solo cambia una capa. Usa los métodos directos de OpenLayers (`map.addLayer()`, `layer.getSource().clear()`, etc.) dentro de `useEffect` con dependencias estrictas.
- **Sistemas de Referencia Espacial (CRS):**
  - Por defecto, la web y GeoJSON usan `EPSG:4326` (WGS84).
  - Las transformaciones locales utilizan `EPSG:9377` (Origen Nacional) o `EPSG:3116` (Magna-Sirgas / Bogotá).
  - Siempre documenta en el código en qué CRS está una coordenada antes y después de una transformación.



## 4. Estilo y Convenciones UI/UX
- **Layout:** El contenedor principal del mapa debe abarcar el 100% del viewport (`100vw` y `100vh`).
- **Componentes Flotantes y Glassmorphism:** Los controles sobre el mapa deben ir en tarjetas flotantes absolutas (`absolute z-10`) usando Tailwind CSS:
  - Fondo translúcido: `bg-white/80 backdrop-blur-md`
  - Bordes y sombras: `border border-slate-200/50 shadow-xl rounded-2xl`
- **Tailwind CSS:** Úsalo para todo el estilizado. No uses archivos `.css` externos salvo los necesarios para librerías de terceros (como `ol/ol.css`).
- **Nombres de archivos:**
  - Componentes: `PascalCase` (ej. `MapContainer.jsx`).
  - Utilidades y Hooks: `camelCase` (ej. `spatialUtils.js`, `useOpenMap.js`).
- **Estructura de código:** Usa siempre **Early Returns** para reducir la anidación del código (evitar *Callback Hell* o *If Hell*).

---

## 5. Formato de Respuesta del Agente
- Proporciona el código directamente sin explicaciones redundantes a menos que se te solicite.
- Si notas que una petición viola el principio de Responsabilidad Única (SRP), corrígeme amablemente y propón la estructura de archivos correcta antes de escribir el código.

---

## 6. Uso de Git
- No interactuar con el repositorio de GitHub ni realizar cambios en él.
- Solo recomendar cambios y uso de comandos de Git/GitHub, más no realizarlos directamente.

## 7.Dirección de producto
- el geoportal pasa a ser colaborativo, estilo Google Maps/Waze. Todo dato mostrado debe distinguirse como “Reportado” (hecho por un usuario) o “Probable” (estimado por terreno). La lógica de datos y probabilidad vive en Supabase; el frontend solo la presenta. Los scripts de datos se escriben en Node, no en Python. Al cerrar cada fase, actualiza MEMORY.md con las decisiones y su porqué. Antes de ejecutar cada fase, presenta el plan y espera mi aprobación.