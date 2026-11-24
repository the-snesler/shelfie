import { motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useNavigate } from "react-router";
import IconDice1 from "~icons/tabler/dice-1-filled";
import IconDice2 from "~icons/tabler/dice-2-filled";
import IconDice3 from "~icons/tabler/dice-3-filled";
import IconDice4 from "~icons/tabler/dice-4-filled";
import IconDice5 from "~icons/tabler/dice-5-filled";
import IconDice6 from "~icons/tabler/dice-6-filled";
import type { DetailLinkState } from "../detail/DetailScreen";
import { celebrate, celebrationOrigin } from "../media/celebrate";
import { rouletteHops } from "./randomPick";

export interface RandomPickCandidate {
  id: string;
  href: string;
  state: DetailLinkState;
}

/** How long the winner glows (and the confetti flies) before navigating. */
const WINNER_HOLD_MS = 950;
/** Time for a smooth scroll to bring an off-screen winner into view. */
const SCROLL_SETTLE_MS = 450;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function cardElement(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    `[data-roulette-id="${CSS.escape(id)}"]`,
  );
}

function onScreen(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

/**
 * Drives the planned shelf's random pick: a spotlight hops across the
 * section's cards (`[data-roulette-id]` inside `containerRef`), slows down,
 * lands on the winner, then navigates to it with the card's own cover view
 * transition. The hops toggle `data-lit` straight on the DOM so the shelf
 * doesn't re-render a dozen times, and the winner gets the shared
 * completion confetti (`celebrate`). Escape cancels a roll in progress.
 */
export function useRandomPick(
  containerRef: RefObject<HTMLElement | null>,
  candidates: readonly RandomPickCandidate[],
) {
  const navigate = useNavigate();
  const [rolling, setRolling] = useState(false);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    const container = containerRef.current;
    if (container) {
      delete container.dataset.roulette;
      for (const el of container.querySelectorAll<HTMLElement>("[data-lit]")) {
        delete el.dataset.lit;
      }
    }
    setRolling(false);
  }, [clearTimers, containerRef]);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    if (!rolling) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rolling, reset]);

  const roll = useCallback(() => {
    const container = containerRef.current;
    if (rolling || !container || candidates.length === 0) return;
    const winner = candidates[Math.floor(Math.random() * candidates.length)];
    const go = () =>
      navigate(winner.href, { viewTransition: true, state: winner.state });

    if (reducedMotion()) {
      go();
      return;
    }

    const later = (fn: () => void, ms: number) => {
      timers.current.push(window.setTimeout(fn, ms));
    };

    setRolling(true);
    container.dataset.roulette = "";

    const spin = () => {
      const visible = candidates
        .map((candidate) => candidate.id)
        .filter((id) => {
          const el = cardElement(container, id);
          return el != null && onScreen(el);
        });
      const pool =
        visible.length > 1
          ? visible
          : candidates.map((candidate) => candidate.id);
      let lit: HTMLElement | null = null;
      let elapsed = 0;
      const hops = rouletteHops(pool, winner.id);
      hops.forEach((hop, index) => {
        const last = index === hops.length - 1;
        later(() => {
          if (lit) delete lit.dataset.lit;
          lit = cardElement(container, hop.id);
          if (!lit) return;
          lit.dataset.lit = last ? "win" : "";
          // Burst from the cover, not the whole card with its caption.
          if (last) celebrate(celebrationOrigin(lit.querySelector("a") ?? lit));
        }, elapsed);
        elapsed += hop.delay;
      });
      later(go, elapsed + WINNER_HOLD_MS);
    };

    // Bring an off-screen winner into view first, so the spotlight spins
    // over the cards around where it will land.
    const winnerEl = cardElement(container, winner.id);
    if (winnerEl && !onScreen(winnerEl)) {
      winnerEl.scrollIntoView({ block: "center", behavior: "smooth" });
      later(spin, SCROLL_SETTLE_MS);
    } else {
      spin();
    }
  }, [candidates, containerRef, navigate, rolling]);

  return { roll, rolling };
}

const DICE_FACES = [
  IconDice1,
  IconDice2,
  IconDice3,
  IconDice4,
  IconDice5,
  IconDice6,
];

/** The planned header's dice button. While rolling it tumbles and flips
 *  through faces on its own timer, so only the button re-renders. */
export function RandomPickButton({
  rolling,
  onRoll,
}: {
  rolling: boolean;
  onRoll: () => void;
}) {
  const [face, setFace] = useState(4);

  useEffect(() => {
    if (!rolling) return;
    const timer = window.setInterval(() => {
      setFace((current) => (current + 1 + Math.floor(Math.random() * 5)) % 6);
    }, 90);
    return () => window.clearInterval(timer);
  }, [rolling]);

  const Face = DICE_FACES[face];
  return (
    <button
      type="button"
      onClick={onRoll}
      disabled={rolling}
      aria-label="Pick a random planned item"
      title="Pick something at random"
      className="inline-flex items-center gap-1.5 rounded-md border border-divider bg-panel px-2 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-accent disabled:border-accent disabled:text-accent"
    >
      <motion.span
        className="inline-flex"
        animate={
          rolling
            ? { rotate: [0, 360], scale: [1, 1.25, 1] }
            : { rotate: 0, scale: 1 }
        }
        transition={
          rolling
            ? {
                rotate: { duration: 0.45, ease: "linear", repeat: Infinity },
                scale: { duration: 0.45, repeat: Infinity },
              }
            : { type: "spring", stiffness: 300, damping: 15 }
        }
        whileHover={rolling ? undefined : { rotate: -15 }}
      >
        <Face className="size-4" />
      </motion.span>
      Random
    </button>
  );
}
