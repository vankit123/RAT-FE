import { Project, ViewMode } from '../types';

type SidebarProps = {
  collapsed: boolean;
  projects: Project[];
  selectedProjectId: number | null;
  activeView: ViewMode;
  projectsExpanded: boolean;
  onToggleSidebar(): void;
  onToggleProjects(): void;
  onSelectView(view: ViewMode): void;
  onSelectProject(project: Project): void;
};

export function Sidebar({
  collapsed,
  projects,
  selectedProjectId,
  activeView,
  projectsExpanded,
  onToggleSidebar,
  onToggleProjects,
  onSelectView,
  onSelectProject,
}: SidebarProps) {
  const labelClass = collapsed ? 'hidden' : '';

  return (
    <aside className="overflow-hidden bg-slate-950/90 px-4 py-6 text-white backdrop-blur">
      <div className={`flex items-center ${collapsed ? 'flex-col gap-4' : 'justify-between gap-3'}`}>
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-sky-400 font-extrabold">
            RT
          </div>
          <div className={labelClass}>
            <p className="m-0 text-xs text-white/60">Reusable</p>
            <strong>Automation Hub</strong>
          </div>
        </div>
        <button className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2" type="button" onClick={onToggleSidebar}>
          ☰
        </button>
      </div>

      <nav className="mt-6 grid gap-3">
        <p className={`mx-3 mb-0 text-xs uppercase tracking-[0.18em] text-white/40 ${labelClass}`}>Workspace</p>
        <button
          className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left ${activeView === 'home' ? 'bg-white/15' : 'hover:bg-white/10'}`}
          type="button"
          onClick={() => onSelectView('home')}
        >
          <span>◈</span>
          <span className={labelClass}>Tạo dự án</span>
        </button>

        <div className="rounded-3xl bg-white/[0.04] p-1">
          <button
            className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left ${activeView === 'project' ? 'bg-white/15' : 'hover:bg-white/10'}`}
            type="button"
            onClick={onToggleProjects}
          >
            <span>▣</span>
            <span className={labelClass}>Dự án</span>
            <span className={`ml-auto ${labelClass}`}>{projectsExpanded ? '▾' : '▸'}</span>
          </button>
          {projectsExpanded && !collapsed ? (
            <div className="grid gap-3 px-2 pb-2 pt-2">
              {projects.length ? (
                projects.map((project) => (
                  <button
                    key={project.id}
                    className={`grid gap-2 rounded-2xl px-4 py-4 text-left ${project.id === selectedProjectId ? 'bg-white/15' : 'hover:bg-white/10'}`}
                    type="button"
                    onClick={() => onSelectProject(project)}
                  >
                    <span className="font-bold">{project.name}</span>
                    <span className="break-words text-sm leading-5 text-white/65">{project.baseUrl || project.description || 'Chưa có Base URL'}</span>
                    <span className="text-xs leading-4 text-white/50">{project.code}</span>
                  </button>
                ))
              ) : (
                <div className="px-3 py-3 text-sm text-white/65">Chưa có dự án nào.</div>
              )}
            </div>
          ) : null}
        </div>

        <p className={`mx-3 mb-0 mt-2 text-xs uppercase tracking-[0.18em] text-white/40 ${labelClass}`}>Advanced</p>
        <button
          className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left ${activeView === 'recorder' ? 'bg-white/15' : 'hover:bg-white/10'}`}
          type="button"
          onClick={() => onSelectView('recorder')}
        >
          <span>⦿</span>
          <span className={labelClass}>Recorder</span>
        </button>
        <button
          className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left ${activeView === 'custom' ? 'bg-white/15' : 'hover:bg-white/10'}`}
          type="button"
          onClick={() => onSelectView('custom')}
        >
          <span>⋯</span>
          <span className={labelClass}>Custom Flow</span>
        </button>
      </nav>
    </aside>
  );
}
