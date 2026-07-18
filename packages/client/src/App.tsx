import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router";
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

    async function checkAuth() {
      const token = getAuthToken();
      if (token) {
        // Optimistic offline-first path: show cached data immediately, then
        // reconcile with the server in the background.
        setAuthMode("app");
        try {
          const status = await getAuthStatus();
          if (!active) return;
          if (!status.authenticated) {
            clearAuthToken();
            stopReplication();
            setAuthMode(status.setupRequired ? "setup" : "login");
          }
        } catch {
          // Local-first: keep showing cached data while the server is offline.
        }
        return;
      }

      try {
        const status = await getAuthStatus();
        if (!active) return;
        if (status.authenticated) {
          setAuthMode("app");
          return;
        }
        setAuthMode(status.setupRequired ? "setup" : "login");
      } catch {
        if (active) setAuthMode("unreachable");
      }
    }

    void checkAuth();
    const unsubscribe = onAuthLost(() => {
      stopReplication();
      setAuthMode("login");
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  function retryAuth() {
    const token = getAuthToken();
    if (token) {
      setAuthMode("app");
      return;
    }

    setAuthMode("checking");
    void getAuthStatus()
      .then((status) => {
        if (status.authenticated) {
          setAuthMode("app");
          return;
        }
        setAuthMode(status.setupRequired ? "setup" : "login");
      })
      .catch(() => setAuthMode("unreachable"));
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
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-divider bg-panel px-4 py-3">
        <Link to="/" className="text-lg font-semibold text-ink">
          Shelfie
        </Link>
        <nav className="flex gap-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `rounded px-3 py-1.5 text-sm font-medium ${
                isActive ? "bg-accent text-white" : "text-muted hover:bg-bg"
              }`
            }
          >
            Library
          </NavLink>
          <NavLink
            to="/search"
            className={({ isActive }) =>
              `rounded px-3 py-1.5 text-sm font-medium ${
                isActive ? "bg-accent text-white" : "text-muted hover:bg-bg"
              }`
            }
          >
            Search
          </NavLink>
        </nav>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onLogout}
          className="text-sm text-muted hover:text-ink"
        >
          Log out
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet context={{ db } satisfies AppOutletContext} />
      </div>
    </div>
  );
}
