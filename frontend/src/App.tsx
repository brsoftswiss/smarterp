import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './fibu/components/Shell';
import { Dashboard } from './fibu/pages/Dashboard';
import { Lieferanten } from './fibu/pages/Lieferanten';
import { RechnungErfassen } from './fibu/pages/RechnungErfassen';
import { MandantSelect } from './fibu/pages/MandantSelect';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MandantSelect />} />
      <Route path="/:mandantId" element={<Shell />}>
        <Route index element={<Navigate to="kreditoren" replace />} />
        <Route path="kreditoren" element={<Dashboard />} />
        <Route path="kreditoren/lieferanten" element={<Lieferanten />} />
        <Route path="kreditoren/erfassen" element={<RechnungErfassen />} />
      </Route>
    </Routes>
  );
}
