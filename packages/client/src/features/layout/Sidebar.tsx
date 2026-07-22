
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";
import IconMovie from "~icons/tabler/movie";
import IconDeviceTv from "~icons/tabler/device-tv";
import IconBook2 from "~icons/tabler/book-2";
import IconDeviceGamepad2 from "~icons/tabler/device-gamepad-2";
import IconListDetails from "~icons/tabler/list-details";
import IconCalendar from "~icons/tabler/calendar";
import IconNotebook from "~icons/tabler/notebook";
import IconLogout from "~icons/tabler/logout";
import IconSearch from "~icons/tabler/search";

import IconHome from "~icons/tabler/home";

const MEDIA_NAV = [
  { type: "movie", label: "Movies", icon: IconMovie },
  { type: "tv", label: "TV Shows", icon: IconDeviceTv },
  { type: "book", label: "Books", icon: IconBook2 },
  { type: "game", label: "Games", icon: IconDeviceGamepad2 },
] as const;

const UPCOMING_NAV = [
  { label: "Lists", icon: IconListDetails },
  { label: "Calendar", icon: IconCalendar },
] as const;

export function Sidebar({
  onLogout,
  open = false,
  onClose,
}: {
  onLogout: () => void;
  open?: boolean;
  onClose?: () => void;
}) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const activeType =
    location.pathname === "/" ? searchParams.get("type") : null;

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onClose}
        />
      ) : null}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-full w-60 shrink-0 flex-col border-r border-divider bg-sidebar transition-transform duration-300 ease-out md:static md:z-auto md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex justify-start px-5 pt-5 pb-1">
          <Link
            to="/"
            onClick={onClose}
            className="font-display text-[1.6rem] font-semibold tracking-tight text-ink"
          >
            Shelfie
          </Link>
        </div>

        <SidebarSearch />

        <nav className="mt-1 flex flex-col gap-0.5 px-3">
          <SidebarLink
            to="/"
            icon={IconHome}
            label="Home"
            active={location.pathname === "/" && !activeType}
            onClose={onClose}
          />
          {MEDIA_NAV.map(({ type, label, icon }) => (
            <SidebarLink
              key={type}
              to={`/?type=${type}`}
              icon={icon}
              label={label}
              active={activeType === type}
              onClose={onClose}
            />
          ))}
        </nav>

        <div className="mx-4 my-3 border-t border-divider" />

        <nav className="flex flex-col gap-0.5 px-3">
          <SidebarLink
            to="/logbook"
            icon={IconNotebook}
            label="Logbook"
            active={location.pathname === "/logbook"}
            onClose={onClose}
          />
          {UPCOMING_NAV.map(({ label, icon }) => (
            <SidebarSoon key={label} icon={icon} label={label} />
          ))}
        </nav>

        <div className="flex-1" />

        <div className="border-t border-divider p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-well font-display text-sm font-semibold text-accent ring-1 ring-divider">
              O
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">
                Owner
              </div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              title="Log out"
              className="rounded-md p-1.5 text-muted hover:bg-well hover:text-ink"
            >
              <IconLogout className="size-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
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
    <div className="px-3 pt-3">
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
  );
}

function SidebarLink({
  to,
  icon: Icon,
  label,
  active,
  onClose,
}: {
  to: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClose?: () => void;
}) {
  return (
    <Link
      to={to}
      title={label}
      aria-current={active ? "page" : undefined}
      onClick={onClose}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
        active
          ? "bg-well text-ink"
          : "text-muted hover:bg-well/60 hover:text-ink"
      }`}
    >
      <Icon className={`size-5 shrink-0 ${active ? "text-accent" : ""}`} />
      <span>{label}</span>
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
      className="flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-faint"
    >
      <Icon className="size-5 shrink-0" />
      <span className="flex-1">{label}</span>
      <span className="rounded-full border border-divider px-1.5 py-px text-[10px] leading-4 text-faint">
        Soon
      </span>
    </div>
  );
}
