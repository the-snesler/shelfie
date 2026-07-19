import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";
import IconSearch from "~icons/tabler/search";
import IconHome from "~icons/tabler/home";
import IconMovie from "~icons/tabler/movie";
import IconDeviceTv from "~icons/tabler/device-tv";
import IconBook2 from "~icons/tabler/book-2";
import IconDeviceGamepad2 from "~icons/tabler/device-gamepad-2";
import IconListDetails from "~icons/tabler/list-details";
import IconCalendar from "~icons/tabler/calendar";
import IconChartBar from "~icons/tabler/chart-bar";
import IconLogout from "~icons/tabler/logout";
import {
  clearAuthToken,
  getAuthStatus,
  getAuthToken,
  logout,
  onAuthLost,
} from "./auth";
import { AuthScreen } from "./AuthScreen";
import { getDatabase, type ShelfieDatabase } from "./db/database";
import { startReplication, stopReplication } from "./db/replication";

export type AuthMode = "checking" | "setup" | "login" | "app" | "unreachable";
export type AppOutletContext = { db: ShelfieDatabase };

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode>(() =>
    getAuthToken() ? "app" : "checking",
  );

  useEffect(() => {
    let active = true;

    if (!getAuthToken()) {
      void getAuthStatus().then(
        (status) => {
          if (!active) return;
          setAuthMode(status.setupRequired ? "setup" : "login");
        },
        () => {
          if (!active) return;
          setAuthMode("unreachable");
        },
      );
    }

    const removeListener = onAuthLost(() => {
      clearAuthToken();
      stopReplication();
      setAuthMode("login");
    });

    return () => {
      active = false;
      removeListener();
    };
  }, []);

  function retryAuth() {
    setAuthMode("checking");
    void getAuthStatus().then(
      (status) => {
        setAuthMode(status.setupRequired ? "setup" : "login");
      },
      () => {
        setAuthMode("unreachable");
      },
    );
  }

  if (authMode !== "app") {
    return (
      <AuthScreen
        mode={authMode}
        onRetry={retryAuth}
        onAuthenticated={() => {
          stopReplication();
          setAuthMode("app");
        }}
      />
    );
  }

  return (
    <AuthedApp
      onLogout={() => {
        void logout().finally(() => {
          stopReplication();
          setAuthMode("login");
        });
      }}
    />
  );
}

const MEDIA_NAV = [
  { type: "movie", label: "Movies", icon: IconMovie },
  { type: "tv", label: "TV Shows", icon: IconDeviceTv },
  { type: "book", label: "Books", icon: IconBook2 },
  { type: "game", label: "Games", icon: IconDeviceGamepad2 },
] as const;

const UPCOMING_NAV = [
  { label: "Lists", icon: IconListDetails },
  { label: "Calendar", icon: IconCalendar },
  { label: "Stats", icon: IconChartBar },
] as const;

function AuthedApp({ onLogout }: { onLogout: () => void }) {
  const [db, setDb] = useState<ShelfieDatabase | null>(null);

  useEffect(() => {
    let active = true;
    void getDatabase().then((database) => {
      if (!active) return;
      startReplication({
        collection: database.library_items,
        name: "library_items",
      });
      setDb(database);
    });
    return () => {
      active = false;
      stopReplication();
    };
  }, []);

  if (!db) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <Sidebar onLogout={onLogout} />
      <main className="room-light min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Outlet context={{ db } satisfies AppOutletContext} />
      </main>
    </div>
  );
}

function Sidebar({ onLogout }: { onLogout: () => void }) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const activeType =
    location.pathname === "/" ? searchParams.get("type") : null;

  return (
    <aside className="flex h-full w-14 shrink-0 flex-col border-r border-divider bg-sidebar md:w-60">
      <div className="flex justify-center px-2 pt-4 pb-1 md:justify-start md:px-5 md:pt-5">
        <Link
          to="/"
          className="font-display text-[1.6rem] font-semibold tracking-tight text-ink"
        >
          <span className="md:hidden">S</span>
          <span className="hidden md:inline">Shelfie</span>
        </Link>
      </div>

      <SidebarSearch />

      <nav className="mt-1 flex flex-col gap-0.5 px-2 md:px-3">
        <SidebarLink
          to="/"
          icon={IconHome}
          label="Home"
          active={location.pathname === "/" && !activeType}
        />
        {MEDIA_NAV.map(({ type, label, icon }) => (
          <SidebarLink
            key={type}
            to={`/?type=${type}`}
            icon={icon}
            label={label}
            active={activeType === type}
          />
        ))}
      </nav>

      <div className="mx-3 my-3 border-t border-divider md:mx-4" />

      <nav className="flex flex-col gap-0.5 px-2 md:px-3">
        {UPCOMING_NAV.map(({ label, icon }) => (
          <SidebarSoon key={label} icon={icon} label={label} />
        ))}
      </nav>

      <div className="flex-1" />

      <div className="border-t border-divider p-2 md:p-3">
        <div className="flex items-center gap-3 rounded-lg px-1 py-1.5 md:px-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-well font-display text-sm font-semibold text-accent ring-1 ring-divider">
            O
          </div>
          <div className="hidden min-w-0 flex-1 md:block">
            <div className="truncate text-sm font-medium text-ink">Owner</div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            title="Log out"
            className="hidden rounded-md p-1.5 text-muted hover:bg-well hover:text-ink md:block"
          >
            <IconLogout className="size-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={onLogout}
          title="Log out"
          className="mt-1 flex w-full items-center justify-center rounded-md p-1.5 text-muted hover:bg-well hover:text-ink md:hidden"
        >
          <IconLogout className="size-4" />
        </button>
      </div>
    </aside>
  );
}

function SidebarSearch() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const onSearchPage = location.pathname === "/search";
  const urlQuery = onSearchPage ? (searchParams.get("q") ?? "") : "";
  const [value, setValue] = useState(urlQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the field in step with the URL (back/forward, leaving search) —
  // but never fight the user while they're typing.
  useEffect(() => {
    if (document.activeElement === inputRef.current) return;
    setValue(urlQuery);
  }, [urlQuery, onSearchPage]);

  function update(next: string) {
    setValue(next);
    navigate(
      {
        pathname: "/search",
        search: next ? `?q=${encodeURIComponent(next)}` : "",
      },
      { replace: onSearchPage },
    );
  }

  return (
    <>
      <div className="hidden px-3 pt-3 md:block">
        <div className="relative">
          <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
          <input
            ref={inputRef}
            type="search"
            value={value}
            onChange={(event) => update(event.target.value)}
            onFocus={() => {
              if (!onSearchPage && value) update(value);
            }}
            placeholder="Search everything…"
            className="w-full rounded-lg border border-divider bg-well py-1.5 pr-3 pl-8 text-sm text-ink placeholder:text-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </div>
      </div>
      <div className="px-2 pt-3 md:hidden">
        <NavLink
          to="/search"
          title="Search"
          className={({ isActive }) =>
            `flex items-center justify-center rounded-md p-2 ${
              isActive
                ? "bg-well text-accent"
                : "text-muted hover:bg-well hover:text-ink"
            }`
          }
        >
          <IconSearch className="size-5" />
        </NavLink>
      </div>
    </>
  );
}

function SidebarLink({
  to,
  icon: Icon,
  label,
  active,
}: {
  to: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      title={label}
      aria-current={active ? "page" : undefined}
      className={`flex items-center justify-center gap-3 rounded-md p-2 text-sm font-medium md:justify-start md:px-3 md:py-2 ${
        active
          ? "bg-well text-ink"
          : "text-muted hover:bg-well/60 hover:text-ink"
      }`}
    >
      <Icon className={`size-5 shrink-0 ${active ? "text-accent" : ""}`} />
      <span className="hidden md:inline">{label}</span>
    </Link>
  );
}

function SidebarSoon({
  icon: Icon,
  label,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <div
      aria-disabled="true"
      title={`${label} — coming soon`}
      className="flex cursor-default items-center justify-center gap-3 rounded-md p-2 text-sm font-medium text-faint md:justify-start md:px-3 md:py-2"
    >
      <Icon className="size-5 shrink-0" />
      <span className="hidden flex-1 md:inline">{label}</span>
      <span className="hidden rounded-full border border-divider px-1.5 py-px text-[10px] leading-4 text-faint md:inline">
        Soon
      </span>
    </div>
  );
}
