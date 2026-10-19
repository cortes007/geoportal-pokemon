import MapViewer from './components/map/MapViewer';
import DetailSheet from './components/ui/DetailSheet';
import FilterDrawer from './components/ui/FilterDrawer';
import ReportCard from './components/ui/ReportCard';
import SearchCard from './components/ui/SearchCard';
import { AvistamientosProvider } from './context/AvistamientosContext';
import { MapProvider } from './context/MapContext';

/**
 * App.jsx
 * ---------------------------------------------------------------------------
 * Composición: proveedores de estado global + capas flotantes sobre el visor a
 * pantalla completa (100vw x 100vh, sin scrollbars).
 *
 * `FilterDrawer` envuelve a `SearchCard` y decide su presentación (tarjeta en
 * escritorio, hoja inferior en móvil); aquí solo se compone, sin posicionar.
 * ---------------------------------------------------------------------------
 */
export default function App() {
  return (
    <MapProvider>
      <AvistamientosProvider>
        <main className="relative h-screen w-screen overflow-hidden bg-surface-muted">
          <MapViewer />

          {/* Capa de controles flotantes: el contenedor no captura clics; cada
              control flotante se declara `pointer-events-auto`. */}
          <div className="pointer-events-none absolute inset-0 z-10">
            <FilterDrawer>
              <SearchCard />
            </FilterDrawer>

            <DetailSheet />
            <ReportCard />
          </div>
        </main>
      </AvistamientosProvider>
    </MapProvider>
  );
}
