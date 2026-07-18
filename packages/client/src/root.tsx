import type { ReactNode } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from "react-router";
import "./index.css";

export function meta() {
  return [{ title: "Shelfie" }];
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <meta charSet="UTF-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, viewport-fit=cover"
        />
        <Meta />
        <Links />
      </head>
      <body className="h-full">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  return <Outlet />;
}

// Rendered into index.html at build time (SPA mode) and shown until the client
// bundle hydrates — matches the previous "Loading…" flash.
export function HydrateFallback() {
  return (
    <div className="flex h-full items-center justify-center bg-bg text-muted">
      Loading…
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : "Something went wrong.";
  return (
    <div className="flex h-full items-center justify-center bg-bg px-4 text-muted">
      {message}
    </div>
  );
}
