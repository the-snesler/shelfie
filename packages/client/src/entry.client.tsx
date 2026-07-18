// No StrictMode: it double-invokes effects in dev, which would open a second
// SSE connection and race the single-instance RxDB database.
import { startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

startTransition(() => {
  hydrateRoot(document, <HydratedRouter />);
});
