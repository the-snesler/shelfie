import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router";
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
import IconMenu2 from "~icons/tabler/menu-2";
import { Sidebar } from "./features/layout/Sidebar";

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

function AuthedApp({ onLogout }: { onLogout: () => void }) {
  const [db, setDb] = useState<ShelfieDatabase | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

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

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  if (!db) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Loading…
      </div>
    );
  }

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
        <span className="font-display text-lg font-semibold tracking-tight text-ink">
          Shelfie
        </span>
      </div>
      <Sidebar
        onLogout={onLogout}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />
      <main className="room-light min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Outlet context={{ db } satisfies AppOutletContext} />
      </main>
    </div>
  );
}
