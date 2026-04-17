"use client";

import { useState } from "react";

type ViewMode = "search" | "settings";

type SidebarProps = {
  activeView: ViewMode;
  onSelectView: (view: ViewMode) => void;
};

function SidebarItem({
  forceShowLabel,
  active,
  icon,
  label,
  onClick,
}: Readonly<{
  forceShowLabel?: boolean;
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}>) {
  const shouldShowLabel = forceShowLabel ?? true;
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
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const closeMenu = () => setIsMenuOpen(false);

  return (
    <>
      <button
        type="button"
        className={`menu-trigger ${isMenuOpen ? "menu-open" : ""}`}
        onClick={() => setIsMenuOpen((prev) => !prev)}
        aria-label="Abrir menu"
        aria-expanded={isMenuOpen}
      >
        ☰
      </button>
      {isMenuOpen ? <button type="button" className="sidebar-backdrop" onClick={closeMenu} aria-label="Fechar menu" /> : null}
      <aside className={`sidebar ${isMenuOpen ? "open" : ""}`}>
        <nav className="sidebar-nav">
          <SidebarItem
            forceShowLabel
            active={props.activeView === "search"}
            icon="⌕"
            label="Busca"
            onClick={() => {
              props.onSelectView("search");
              closeMenu();
            }}
          />
          <SidebarItem
            forceShowLabel
            active={props.activeView === "settings"}
            icon="⚙"
            label="Configuracoes"
            onClick={() => {
              props.onSelectView("settings");
              closeMenu();
            }}
          />
        </nav>
        {isMenuOpen ? (
          <button type="button" className="menu-close" onClick={closeMenu}>
            Fechar
          </button>
        ) : null}
      </aside>
    </>
  );
}

