import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";

/** Returns a stable `onBack` handler shared by every detail screen.
 *
 *  location.key is "default" only for the initial history entry (deep link
 *  / hard load), where going back would leave the app — same guard the old
 *  pushCount-based hasAppHistory() provided. `navigate(-1)`'s delta
 *  overload takes no options, but react-router replays a POP navigation's
 *  view transition automatically when the matching forward nav used one
 *  (see `appliedViewTransitions` in its router), so the cover still morphs. */
export function useBackNavigation(): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (location.key !== "default") navigate(-1);
    else navigate("/", { viewTransition: true });
  }, [location, navigate]);
}
