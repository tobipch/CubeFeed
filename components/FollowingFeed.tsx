"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import type { PersonPRs } from "@/lib/queries";
import PRList from "./PRList";
import DaysSelector from "./DaysSelector";
import LoginModal from "./LoginModal";

interface FollowedPerson {
  wcaId: string;
  name: string;
}

interface AuthUser {
  id: number;
  username: string;
  wca_id: string | null;
  wca_name: string | null;
  wca_avatar_url: string | null;
}

interface SearchResult {
  wcaId: string;
  name: string;
  countryIso2: string;
}

const FOLLOWING_KEY = "wca-following";
const VALID_DAYS = [3, 7, 14, 30];
const DEFAULT_DAYS = 7;

export default function FollowingFeed() {
  const searchParams = useSearchParams();
  const days = VALID_DAYS.includes(Number(searchParams.get("days")))
    ? Number(searchParams.get("days"))
    : DEFAULT_DAYS;

  const [following, setFollowing] = useState<FollowedPerson[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [persons, setPersons] = useState<PersonPRs[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  // Auth state
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Check login status once on mount
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        setUser(data ?? null);
        setAuthChecked(true);
      })
      .catch(() => setAuthChecked(true));
  }, []);

  // Load following list: from DB if logged in, else from localStorage
  useEffect(() => {
    if (!authChecked) return;
    if (user) {
      fetch("/api/user/following")
        .then((r) => r.json())
        .then((data: FollowedPerson[]) => {
          let list = Array.isArray(data) ? data : [];
          // Auto-add self for WCA users
          if (user.wca_id && user.wca_name && !list.some((f) => f.wcaId === user.wca_id)) {
            const self = { wcaId: user.wca_id, name: user.wca_name };
            list = [self, ...list];
            fetch("/api/user/following", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(list),
            }).catch(() => {});
          }
          setFollowing(list);
          setHydrated(true);
        })
        .catch(() => setHydrated(true));
    } else {
      try {
        const stored = JSON.parse(localStorage.getItem(FOLLOWING_KEY) ?? "[]");
        if (Array.isArray(stored)) setFollowing(stored);
      } catch {}
      setHydrated(true);
    }
  }, [authChecked, user]);

  // Persist following list whenever it changes
  const saveFollowing = useCallback(
    (next: FollowedPerson[]) => {
      if (user) {
        fetch("/api/user/following", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        }).catch(() => {});
      } else {
        try {
          localStorage.setItem(FOLLOWING_KEY, JSON.stringify(next));
        } catch {}
      }
    },
    [user]
  );

  const idsKey = useMemo(
    () =>
      following
        .map((f) => f.wcaId)
        .sort()
        .join(","),
    [following]
  );

  // Fetch PRs whenever the followed IDs or the days window change
  useEffect(() => {
    if (!hydrated) return;
    if (following.length === 0) {
      setPersons(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setFetchError(false);

    const controller = new AbortController();
    fetch(`/api/feed?ids=${encodeURIComponent(idsKey)}&days=${days}`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PersonPRs[]>;
      })
      .then((data) => {
        // Back-fill display names from the canonical WCA data
        const nameMap = new Map(data.map((p) => [p.personId, p.personName]));
        setFollowing((prev) => {
          let changed = false;
          const updated = prev.map((f) => {
            const fetched = nameMap.get(f.wcaId);
            if (fetched && fetched !== f.name) {
              changed = true;
              return { ...f, name: fetched };
            }
            return f;
          });
          if (!changed) return prev;
          saveFollowing(updated);
          return updated;
        });
        setPersons(data);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setFetchError(true);
        setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, days, hydrated]);

  const addPerson = useCallback(
    (person: FollowedPerson) => {
      setFollowing((prev) => {
        if (prev.some((p) => p.wcaId === person.wcaId)) return prev;
        const next = [...prev, person];
        saveFollowing(next);
        return next;
      });
    },
    [saveFollowing]
  );

  const removePerson = useCallback(
    (wcaId: string) => {
      if (user?.wca_id && wcaId === user.wca_id) return;
      setFollowing((prev) => {
        const next = prev.filter((p) => p.wcaId !== wcaId);
        saveFollowing(next);
        return next;
      });
    },
    [saveFollowing, user]
  );

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    try {
      const stored = JSON.parse(localStorage.getItem(FOLLOWING_KEY) ?? "[]");
      if (Array.isArray(stored)) setFollowing(stored);
      else setFollowing([]);
    } catch {
      setFollowing([]);
    }
  }

  function handleLoginSuccess(loggedInUser: { id: number; username: string }) {
    setShowLoginModal(false);
    const prevFollowing = following;
    setUser({ ...loggedInUser, wca_id: null, wca_name: null, wca_avatar_url: null });
    setHydrated(false);

    // Merge localStorage following into DB then reload
    fetch("/api/user/following")
      .then((r) => r.json())
      .then((dbFollowing: FollowedPerson[]) => {
        if (!Array.isArray(dbFollowing)) return [];
        const merged = [...dbFollowing];
        for (const lf of prevFollowing) {
          if (!merged.some((d) => d.wcaId === lf.wcaId)) {
            merged.push(lf);
          }
        }
        return merged;
      })
      .then((merged) => {
        setFollowing(merged);
        if (merged.length > 0) {
          fetch("/api/user/following", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(merged),
          }).catch(() => {});
        }
        setHydrated(true);
      })
      .catch(() => setHydrated(true));
  }

  if (!hydrated) return null;

  const totalPRs = persons?.reduce((s, p) => s + p.prs.length, 0) ?? 0;
  const cubersWithPRs = persons?.filter((p) => p.prs.length > 0).length ?? 0;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <header className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🏆</span>
            <h1 className="text-3xl font-bold tracking-tight">CubeFeed</h1>
          </div>
          <div className="flex items-center gap-2">
            <FollowingDropdown
              following={following}
              userWcaId={user?.wca_id ?? null}
              onAdd={addPerson}
              onRemove={removePerson}
            />
            <UserWidget
              user={user}
              onLoginClick={() => setShowLoginModal(true)}
              onLogout={handleLogout}
            />
          </div>
        </div>
        <p className="text-gray-500 text-sm">
          Never miss a great moment from your favorite cubers.
        </p>
      </header>

      {following.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
          <DaysSelector current={days} options={VALID_DAYS} />
          {!loading && persons !== null && (
            <p className="text-sm text-gray-500">
              <span className="font-semibold text-gray-800">{totalPRs}</span> PRs from{" "}
              <span className="font-semibold text-gray-800">{cubersWithPRs}</span> cuber{cubersWithPRs !== 1 ? "s" : ""}
              {" "}in the last{" "}
              <span className="font-semibold text-gray-800">{days}</span> days
            </p>
          )}
        </div>
      )}

      {following.length === 0 && <EmptyFollowingState />}
      {following.length > 0 && loading && <LoadingState />}
      {following.length > 0 && !loading && fetchError && <FetchErrorState />}
      {following.length > 0 && !loading && !fetchError && persons !== null && persons.length === 0 && (
        <NoPRsState days={days} />
      )}
      {following.length > 0 && !loading && !fetchError && persons && persons.length > 0 && (
        <PRList persons={persons} />
      )}

      {showLoginModal && (
        <LoginModal
          onSuccess={handleLoginSuccess}
          onClose={() => setShowLoginModal(false)}
        />
      )}
    </div>
  );
}

// ─── UserWidget ───────────────────────────────────────────────────────────────

function UserWidget({
  user,
  onLoginClick,
  onLogout,
}: {
  user: AuthUser | null;
  onLoginClick: () => void;
  onLogout: () => void;
}) {
  if (user) {
    const displayName = user.wca_name ?? user.username;
    return (
      <div className="flex items-center gap-2">
        {user.wca_avatar_url && (
          <img
            src={user.wca_avatar_url}
            alt={displayName}
            className="w-8 h-8 rounded-full object-cover flex-shrink-0"
          />
        )}
        <span className="text-sm text-gray-600 hidden sm:block">
          Hello{" "}
          <span className="font-semibold text-gray-800">{displayName}</span>
        </span>
        <button
          type="button"
          onClick={onLogout}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-3 py-1.5 transition-colors ml-1"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Log out
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onLoginClick}
      className="text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-1.5 rounded-lg transition-colors"
    >
      Log in
    </button>
  );
}

// ─── FollowingDropdown ────────────────────────────────────────────────────────

function FollowingDropdown({
  following,
  userWcaId,
  onAdd,
  onRemove,
}: {
  following: FollowedPerson[];
  userWcaId: string | null;
  onAdd: (person: FollowedPerson) => void;
  onRemove: (wcaId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        !panelRef.current?.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Focus search when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Search with debounce
  useEffect(() => {
    if (query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      setSearchDone(false);
      return;
    }
    setIsSearching(true);
    setSearchDone(false);
    const timer = setTimeout(() => {
      fetch(`/api/persons/search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((data: SearchResult[]) => {
          setSuggestions(data);
          setShowSuggestions(true);
          setIsSearching(false);
          setSearchDone(true);
        })
        .catch(() => {
          setIsSearching(false);
          setSearchDone(true);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  function handleSelect(result: SearchResult) {
    onAdd({ wcaId: result.wcaId, name: result.name });
    setQuery("");
    setSuggestions([]);
    setShowSuggestions(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      const trimmed = query.trim().toUpperCase();
      if (/^[0-9]{4}[A-Z]{4}[0-9]{2}$/.test(trimmed)) {
        onAdd({ wcaId: trimmed, name: trimmed });
        setQuery("");
        setShowSuggestions(false);
      } else if (suggestions.length > 0) {
        handleSelect(suggestions[0]);
      }
    } else if (e.key === "Escape") {
      if (showSuggestions) {
        setShowSuggestions(false);
      } else {
        setOpen(false);
      }
    }
  }

  const label =
    following.length === 0
      ? "Add a cuber"
      : `Following ${following.length} cuber${following.length !== 1 ? "s" : ""}`;

  const showNoResults = showSuggestions && searchDone && !isSearching && suggestions.length === 0;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5 transition-colors bg-white"
      >
        <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        <span className="hidden sm:inline">{label}</span>
        <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-2xl shadow-xl z-50 overflow-hidden"
        >
          {/* Search */}
          <div className="p-3 border-b border-gray-100">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search cuber or WCA ID…"
                className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent placeholder:text-gray-400"
              />
              {isSearching ? (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : query ? (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => { setQuery(""); setShowSuggestions(false); inputRef.current?.focus(); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
                >
                  ×
                </button>
              ) : null}
            </div>

            {/* Search results */}
            {(showSuggestions || showNoResults) && (
              <div className="mt-2 border border-gray-100 rounded-xl overflow-hidden">
                {suggestions.map((r) => {
                  const already = following.some((f) => f.wcaId === r.wcaId);
                  return (
                    <button
                      key={r.wcaId}
                      type="button"
                      disabled={already}
                      onClick={() => handleSelect(r)}
                      className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors ${
                        already ? "opacity-40 cursor-not-allowed" : "hover:bg-blue-50 cursor-pointer"
                      }`}
                    >
                      <span className="flex flex-col min-w-0">
                        <span className="font-medium text-gray-900 truncate">{r.name}</span>
                        <span className="text-xs text-gray-400 font-mono">{r.wcaId}</span>
                      </span>
                      <span className="text-xs text-gray-400 shrink-0 ml-3">{r.countryIso2}</span>
                    </button>
                  );
                })}
                {showNoResults && (
                  <p className="px-3 py-2.5 text-sm text-gray-500">
                    No results. Enter a WCA ID (e.g. <span className="font-mono">2015MUEL01</span>) and press Enter.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Following list */}
          <div className="max-h-64 overflow-y-auto">
            {following.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">
                No cubers followed yet.
              </p>
            ) : (
              following.map((f) => {
                const isSelf = f.wcaId === userWcaId;
                return (
                  <div
                    key={f.wcaId}
                    className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{f.name}</div>
                      <div className="text-xs font-mono text-gray-400">{f.wcaId}</div>
                    </div>
                    {isSelf ? (
                      <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-md font-medium shrink-0">
                        You
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onRemove(f.wcaId)}
                        aria-label={`Unfollow ${f.name}`}
                        className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none shrink-0"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── States ───────────────────────────────────────────────────────────────────

function EmptyFollowingState() {
  return (
    <div className="mt-12 flex flex-col items-center text-center gap-3">
      <div className="text-5xl">🔍</div>
      <h2 className="text-xl font-semibold text-gray-800">
        Start your personal feed
      </h2>
      <p className="text-gray-500 text-sm max-w-sm">
        Click <span className="font-medium text-gray-700">Add a cuber</span> in the top right to follow cubers and track their PRs.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse"
        >
          <div className="h-5 w-40 bg-gray-200 rounded mb-4" />
          <div className="flex gap-2 flex-wrap">
            {[1, 2, 3].map((j) => (
              <div key={j} className="h-16 w-36 bg-gray-100 rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FetchErrorState() {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
      <p className="text-red-700 font-medium">Error loading PRs</p>
      <p className="text-red-500 text-sm mt-1">
        Please reload the page or try again later.
      </p>
    </div>
  );
}

function NoPRsState({ days }: { days: number }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
      <p className="text-gray-500">
        No PRs from followed cubers in the last {days} days.
      </p>
      <p className="text-gray-400 text-sm mt-1">
        Try a longer time range.
      </p>
    </div>
  );
}
