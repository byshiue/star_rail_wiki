import { useRef, type JSX, type MouseEvent } from "react";
import { HashRouter, NavLink, useRoutes } from "react-router-dom";
import { appRoutes } from "./routes";

const navigationItems = [
  { label: "资料库", to: "/" },
  { label: "角色构筑", to: "/builds" },
  { label: "配队实验室", to: "/simulator" },
  { label: "Agent 推荐", to: "/agent" },
  { label: "社区配队", to: "/community" },
  { label: "账号与版本", to: "/profiles" },
] as const;

function AppNavigation() {
  return (
    <header className="site-header">
      <div className="brand-block">
        <span className="brand-mark" aria-hidden="true">✦</span>
        <span>
          <strong>星穹铁道资料站</strong>
          <small>版本化资料与配队工具</small>
        </span>
      </div>
      <nav aria-label="主要导航">
        {navigationItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === "/"}>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}

function AppContent() {
  const mainRef = useRef<HTMLElement>(null);
  const routeContent = useRoutes(appRoutes);

  function focusMain(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    mainRef.current?.focus();
  }

  return (
    <>
      <a className="skip-link" href="#main" onClick={focusMain}>跳到主要内容</a>
      <AppNavigation />
      <main id="main" ref={mainRef} tabIndex={-1}>{routeContent}</main>
    </>
  );
}

export function App(): JSX.Element {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}
