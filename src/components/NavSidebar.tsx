/**
 * NavSidebar — slim 56px icon rail on the left edge of the app shell.
 * Pure presentational: no API calls, no global state dependencies.
 *
 * Shows the Mely logo (always), the home button, and (when charName is set)
 * three additional per-character buttons: Detail, Generate, Train.
 *
 * Usage:
 *   import { NavSidebar, NavPage } from "@/components/NavSidebar";
 *
 *   // Home only (no character selected)
 *   <NavSidebar page="home" onNav={setPage} />
 *
 *   // With per-character nav items
 *   <NavSidebar
 *     page={page}
 *     onNav={setPage}
 *     charName="星野ミカ"
 *     charAccent="hsl(320, 70%, 65%)"
 *   />
 */

import { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NavPage = "home" | "detail" | "dna" | "llm" | "visual" | "generation" | "voice";

interface NavSidebarProps {
  page: NavPage;
  onNav: (page: NavPage) => void;
  /** When set, character-specific nav items are rendered */
  charName?: string | null;
  /** CSS color applied to the active item, e.g. "hsl(320, 70%, 65%)" */
  charAccent?: string;
}

interface NavItemDef {
  id: NavPage;
  label: string;
  icon: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Inline SVG icons (paths from prototype Ic object)
// ---------------------------------------------------------------------------

function IconSparkle() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none">
      <path
        d="M7 1l1.5 4.5L13 7l-4.5 1.5L7 13l-1.5-4.5L1 7l4.5-1.5L7 1z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconHome() {
  return (
    <svg width={15} height={15} viewBox="0 0 15 15" fill="none">
      <path
        d="M2.5 7.5l5-5 5 5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 6.5V12h2.5V9.5h2V12H11V6.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconDNA() {
  return (
    <svg width={15} height={15} viewBox="0 0 15 15" fill="none">
      <path
        d="M4.5 1.5v12M10.5 1.5v12M4.5 4.5h6M4.5 7.5h6M4.5 10.5h6"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconGenerate() {
  return (
    <svg width={15} height={15} viewBox="0 0 15 15" fill="none">
      <rect x="2" y="2" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M5 5l2.5 2.5L10 5M5 8l2.5 2.5L10 8"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconTrain() {
  return (
    <svg width={15} height={15} viewBox="0 0 15 15" fill="none">
      <path
        d="M7.5 1.5L3.5 8h3.5l-.5 5L11 6H7l.5-4.5z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// NavItem — single icon button with right-side tooltip on hover
// ---------------------------------------------------------------------------

interface NavItemProps {
  id: NavPage;
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  activeColor: string;
  onClick: () => void;
}

function NavItem({ id, icon, label, isActive, activeColor, onClick }: NavItemProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      // CSS class handles default background/color; inline style overrides active color
      // with the per-character accent rather than the CSS var default.
      className={`nav-item${isActive ? " active" : ""}`}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={label}
      aria-current={isActive ? "page" : undefined}
      style={isActive ? { background: `${activeColor}15`, color: activeColor } : undefined}
    >
      {icon}

      {/* Tooltip shown to the right of the button */}
      {hovered && (
        <div className="nav-tooltip" role="tooltip" id={`nav-tip-${id}`}>
          {label}
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// NavSidebar
// ---------------------------------------------------------------------------

export function NavSidebar({
  page,
  onNav,
  charName,
  charAccent = "var(--accent-brand)",
}: NavSidebarProps) {
  const items: NavItemDef[] = [
    { id: "home", icon: <IconHome />, label: "角色库" },
    ...(charName
      ? [
          { id: "detail" as NavPage, icon: <IconDNA />, label: charName },
        ]
      : []),
  ];

  return (
    <nav className="nav-sidebar" aria-label="主导航">
      {/* Logo button — always navigates home */}
      <div
        className="nav-logo"
        role="button"
        tabIndex={0}
        aria-label="Mely AI — 返回角色库"
        onClick={() => onNav("home")}
        onKeyDown={(e) => e.key === "Enter" && onNav("home")}
      >
        <IconSparkle />
      </div>

      {items.map((item) => (
        <NavItem
          key={item.id}
          id={item.id}
          icon={item.icon}
          label={item.label}
          isActive={
            item.id === "home"
              ? page === "home"
              : page !== "home" // any detail tab = character item is active
          }
          activeColor={charAccent}
          onClick={() => onNav(item.id)}
        />
      ))}
    </nav>
  );
}
