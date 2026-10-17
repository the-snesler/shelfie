import { useEffect, useRef, useState } from "react";
import type { OwnerSettings } from "@shelfie/shared";
import { Navigate, Outlet, useLocation } from "react-router";
import {
  clearAuthToken,
  getAuthStatus,
  getAuthToken,
  logout,
  onAuthLost,
  onAuthTokenStorageChange,
  onAuthTokenUpdated,
} from "./auth";
import { createAuthSessionMonitor } from "./authSession";
import { AuthScreen } from "./AuthScreen";
import { getDatabase, type ShelfieDatabase } from "./db/database";
import { startReplication, stopReplication } from "./db/replication";
import IconMenu2 from "~icons/tabler/menu-2";
import { Sidebar } from "./features/layout/Sidebar";
import { getSettings } from "./settings";

export type AuthMode =
  "checking" | "setup" | "login" | "app" | "guest" | "unreachable";
export type AppOutletContext = {
  db: ShelfieDatabase;
  settings: OwnerSettings;
  setSettings: (settings: OwnerSettings) => void;
  authenticated: boolean;
  requestLogin: () => void;
};

const GUEST_SETTINGS: OwnerSettings = {
  username: "Visitor",
  libraryTheme: "classic",
  showProgressBars: false,
};
const SETTINGS_CACHE_KEY = "shelfie.cachedSettings";

function cachedSettings(): OwnerSettings | null {
  try {
    const cached = localStorage.getItem(SETTINGS_CACHE_KEY);
    return cached ? (JSON.parse(cached) as OwnerSettings) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode>(() =>
    getAuthToken() ? "app" : "checking",
  );
  const [setupRequired, setSetupRequired] = useState(false);
  const session = useRef<ReturnType<typeof createAuthSessionMonitor> | null>(
    null,
  );

  useEffect(() => {
    const monitor = createAuthSessionMonitor({
      readToken: getAuthToken,
      readStatus: getAuthStatus,
      clearToken: clearAuthToken,
      stopSync: stopReplication,
      onState: ({ mode, setupRequired }) => {
        if (setupRequired !== undefined) setSetupRequired(setupRequired);
        setAuthMode(mode);
      },
    });
    session.current = monitor;
    void monitor.check({ allowOffline: true });
    const removeStorageListener = onAuthTokenStorageChange(() => {
      void monitor.storageChanged();
    });
    const removeTokenListener = onAuthTokenUpdated(() => {
      // These tokens come from a successful same-tab credential request.
      // Keep the current owner view while checking its replacement token.
      void monitor.check({ allowOffline: true });
    });
    const removeListener = onAuthLost(() => {
      monitor.invalidate();
      clearAuthToken();
      stopReplication();
      setAuthMode("guest");
    });
    return () => {
      monitor.dispose();
      session.current = null;
      removeStorageListener();
      removeTokenListener();
      removeListener();
    };
  }, []);

  if (authMode !== "app" && authMode !== "guest") {
    return (
      <AuthScreen
        mode={authMode}
        onRetry={() => {
          setAuthMode("checking");
          void session.current?.check();
        }}
        onCancel={() => {
          session.current?.invalidate();
          setAuthMode("guest");
        }}
        onAuthenticated={() => {
          session.current?.invalidate();
          stopReplication();
          setSetupRequired(false);
          setAuthMode("app");
        }}
      />
    );
  }

  return (
    <BrowsingApp
      key={authMode}
      authenticated={authMode === "app"}
      requestLogin={() => {
        session.current?.invalidate();
        setAuthMode(setupRequired ? "setup" : "login");
      }}
      onLogout={() => {
        // Hide private local state immediately, even if the network is offline.
        session.current?.invalidate();
        stopReplication();
        void logout();
        clearAuthToken();
        setAuthMode("guest");
      }}
    />
  );
}

function BrowsingApp({
  authenticated,
  requestLogin,
  onLogout,
}: {
  authenticated: boolean;
  requestLogin: () => void;
  onLogout: () => void;
}) {
  const [db, setDb] = useState<ShelfieDatabase | null>(null);
  const [settings, setSettings] = useState<OwnerSettings | null>(
    authenticated ? null : GUEST_SETTINGS,
  );
  const [loadError, setLoadError] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    let active = true;
    async function load() {
      const database = await getDatabase();
      let ownerSettings = GUEST_SETTINGS;
      if (authenticated) {
        try {
          ownerSettings = await getSettings();
          localStorage.setItem(
            SETTINGS_CACHE_KEY,
            JSON.stringify(ownerSettings),
          );
        } catch (error) {
          const cached = cachedSettings();
          if (!getAuthToken() || !cached) throw error;
          ownerSettings = cached;
        }
      }
      if (!active) return;
      if (authenticated) {
        startReplication({
          collection: database.library_items,
          name: "library_items",
        });
      }
      setDb(database);
      setSettings(ownerSettings);
    }
    void load().catch(() => {
      if (active) setLoadError(true);
    });
    return () => {
      active = false;
      stopReplication();
    };
  }, [authenticated]);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Could not load Shelfie. Refresh to try again.
      </div>
    );
  }
  if (!db || !settings) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Loading…
      </div>
    );
  }

  const publicPage =
    /^\/(search|games\/[^/]+|movies\/[^/]+|tv\/[^/]+|books\/[^/]+)\/?$/.test(
      location.pathname,
    );
  if (!authenticated && !publicPage) return <Navigate to="/search" replace />;

  return (
    <div className="flex h-full flex-col md:flex-row">
      <div className="flex items-center gap-3 border-b border-divider bg-sidebar px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          title="Open menu"
          className="rounded-md p-1.5 text-muted hover:bg-well hover:text-ink"
        >
          <IconMenu2 className="size-5" />
        </button>
        <img src="/logo.svg" alt="Shelfie" className="h-8 w-auto" />
      </div>
      <Sidebar
        onLogout={onLogout}
        onLogin={requestLogin}
        authenticated={authenticated}
        username={settings.username}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />
      <main className="room-light min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Outlet
          context={
            {
              db,
              settings,
              setSettings,
              authenticated,
              requestLogin,
            } satisfies AppOutletContext
          }
        />
      </main>
    </div>
  );
}
