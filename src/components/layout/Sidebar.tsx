"use client";

type ViewMode = "search" | "settings";

type SidebarProps = {
  isCollapsed: boolean;
  activeView: ViewMode;
  onToggleCollapse: () => void;
  onSelectView: (view: ViewMode) => void;
};

function SidebarItem({
  isCollapsed,
  active,
  icon,
  label,
  onClick,
}: Readonly<{
  isCollapsed: boolean;
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}>) {
  const shouldShowLabel = isCollapsed === false;
  return (
    <button type="button" className={`sidebar-item ${active ? "active" : ""}`} onClick={onClick} title={label}>
      <span className="sidebar-item-icon" aria-hidden>
        {icon}
      </span>
      {shouldShowLabel ? <span>{label}</span> : null}
    </button>
  );
}

export function Sidebar(props: Readonly<SidebarProps>) {
  const showExpandedBrand = props.isCollapsed === false;
  return (
    <aside className={`sidebar ${props.isCollapsed ? "collapsed" : ""}`}>
      <div className="sidebar-head">
        {showExpandedBrand ? <strong>FindPlaces</strong> : <strong>FP</strong>}
        <button type="button" className="sidebar-collapse-btn" onClick={props.onToggleCollapse}>
          {props.isCollapsed ? ">" : "<"}
        </button>
      </div>

      <nav className="sidebar-nav">
        <SidebarItem
          isCollapsed={props.isCollapsed}
          active={props.activeView === "search"}
          icon="⌕"
          label="Busca"
          onClick={() => props.onSelectView("search")}
        />
        <SidebarItem
          isCollapsed={props.isCollapsed}
          active={props.activeView === "settings"}
          icon="⚙"
          label="Configuracoes"
          onClick={() => props.onSelectView("settings")}
        />
      </nav>
    </aside>
  );
}

