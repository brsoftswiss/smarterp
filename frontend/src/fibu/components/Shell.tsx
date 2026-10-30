// FiBu-Shell: Sidebar-Navigation + Mandanten-Umschalter + Inhaltsbereich.
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { MandantProvider, useMandant } from '../state/MandantContext';

const NAV = [
  { to: 'kreditoren', label: 'Dashboard' },
  { to: 'kreditoren/lieferanten', label: 'Lieferanten' },
  { to: 'kreditoren/erfassen', label: 'Rechnung erfassen' },
];

function Topbar() {
  const { mandant, mandanten } = useMandant();
  const navigate = useNavigate();
  return (
    <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-indigo-600 px-2 py-1 text-sm font-bold text-white">smart<span className="font-light">erp</span></span>
        <span className="text-sm text-slate-500 dark:text-slate-400">Fibu</span>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <span className="hidden text-slate-500 sm:inline dark:text-slate-400">Mandant</span>
        <select
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          value={mandant?.id ?? ''}
          onChange={(e) => navigate(`/${e.target.value}/kreditoren`)}
        >
          {mandanten.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
    </header>
  );
}

function Sidebar() {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 p-2 md:w-56 md:flex-col md:border-b-0 md:border-r dark:border-slate-800 dark:bg-slate-950">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === 'kreditoren'}
          className={({ isActive }) =>
            `whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition ${
              isActive
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800'
            }`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

function ShellBody() {
  const { loading, error } = useMandant();
  return (
    <div className="flex min-h-screen flex-col bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-100">
      <Topbar />
      <div className="flex flex-1 flex-col md:flex-row">
        <Sidebar />
        <main className="flex-1 p-4 md:p-6">
          {error && <div className="mb-4 rounded-md bg-red-100 p-3 text-sm text-red-800">{error}</div>}
          {loading ? <p className="text-slate-500">Lädt …</p> : <Outlet />}
        </main>
      </div>
    </div>
  );
}

export function Shell() {
  return (
    <MandantProvider>
      <ShellBody />
    </MandantProvider>
  );
}
