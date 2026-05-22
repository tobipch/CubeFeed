"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import type { PersonPRs } from "@/lib/queries";
import { effectivePRDate } from "@/lib/format";
import PRList from "./PRList";
import ChronologicalFeed from "./ChronologicalFeed";
import DaysSelector from "./DaysSelector";
import LoginModal from "./LoginModal";

function WcaAvatar({ wcaId, name }: { wcaId: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    fetch(`https://www.worldcubeassociation.org/api/v0/persons/${wcaId}`)
      .then((r) => r.json())
      .then((d) => { const t = d?.person?.avatar?.thumb_url; if (t) setUrl(t); })
      .catch(() => {});
  }, [wcaId]);
  if (!url) return <div className="w-7 h-7 rounded-full bg-gray-100 shrink-0" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={name} className="w-7 h-7 rounded-full object-cover ring-1 ring-gray-200 shrink-0" loading="lazy" />;
}

interface FollowedPerson {
  wcaId: string;
  name: string;
  countryIso2?: string;
}

interface AuthUser {
  id: number;
  username: string;
  wca_id: string | null;
  wca_name: string | null;
  wca_avatar_url: string | null;
  last_feed_visit: string | null;
}

interface SearchResult {
  wcaId: string;
  name: string;
  countryIso2: string;
}

const FOLLOWING_KEY = "wca-following";
const LAST_VISIT_KEY = "cubefeed_last_visit";
const VIEW_MODE_KEY = "cubefeed_view_mode";
const VALID_DAYS = [3, 7, 14, 30];
const DEFAULT_DAYS = 7;
const FEED_DAYS = 30;

function flagEmoji(iso2: string | undefined): string {
  if (!iso2 || iso2.length !== 2) return "";
  return [...iso2.toUpperCase()].map((c) => String.fromCodePoint(c.charCodeAt(0) + 127397)).join("");
}

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

  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);

  const [lastVisitDate, setLastVisitDate] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"person" | "feed">("person");

  const effectiveDays = viewMode === "feed" ? FEED_DAYS : days;

  useEffect(() => {
    const saved = localStorage.getItem(VIEW_MODE_KEY);
    if (saved === "feed") setViewMode("feed");
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        setUser(data ?? null);
        setAuthChecked(true);
      })
      .catch(() => setAuthChecked(true));
  }, []);

  // Load lastVisitDate: prefer DB value for logged-in users, fall back to localStorage
  useEffect(() => {
    if (!authChecked) return;
    const local = localStorage.getItem(LAST_VISIT_KEY);
    if (user?.last_feed_visit) {
      const dbDate = user.last_feed_visit.slice(0, 10);
      const localDate = local ? local.slice(0, 10) : null;
      setLastVisitDate(localDate && localDate > dbDate ? localDate : dbDate);
    } else if (local) {
      setLastVisitDate(local.slice(0, 10));
    }
    // First visit: no lastVisitDate — save today so next visit shows diff
    if (!local && !user?.last_feed_visit) {
      localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString().slice(0, 10));
    }
  }, [authChecked, user]);

  // Save lastVisitDate when user leaves the page
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        const today = new Date().toISOString().slice(0, 10);
        localStorage.setItem(LAST_VISIT_KEY, today);
        if (user) {
          fetch("/api/user/last-visit", { method: "PUT" }).catch(() => {});
        }
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [user]);

  useEffect(() => {
    if (!authChecked) return;
    if (user) {
      fetch("/api/user/following")
        .then((r) => r.json())
        .then((data: FollowedPerson[]) => {
          const list = Array.isArray(data) ? data : [];
          if (user.wca_id && user.wca_name && !list.some((f) => f.wcaId === user.wca_id)) {
            const withSelf = [{ wcaId: user.wca_id, name: user.wca_name }, ...list];
            return fetch("/api/user/following", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(withSelf),
            })
              .then(() => fetch("/api/user/following"))
              .then((r) => r.json())
              .then((updated: FollowedPerson[]) => Array.isArray(updated) ? updated : withSelf);
          }
          return list;
        })
        .then((list) => { setFollowing(list); setHydrated(true); })
        .catch(() => setHydrated(true));
    } else {
      try {
        const stored = JSON.parse(localStorage.getItem(FOLLOWING_KEY) ?? "[]");
        if (Array.isArray(stored)) setFollowing(stored);
      } catch {}
      setHydrated(true);
    }
  }, [authChecked, user]);

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
    () => following.map((f) => f.wcaId).sort().join(","),
    [following]
  );

  const newPRCount = useMemo(() => {
    if (!lastVisitDate || !persons) return 0;
    return persons.reduce(
      (count, p) => count + p.prs.filter((pr) => effectivePRDate(pr) > lastVisitDate).length,
      0
    );
  }, [persons, lastVisitDate]);

  function handleViewModeChange(mode: "person" | "feed") {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }

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
    fetch("/api/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: idsKey.split(","), days: effectiveDays }),
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PersonPRs[]>;
      })
      .then((data) => {
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
  }, [idsKey, effectiveDays, hydrated]);

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

  const addPersons = useCallback(
    (persons: FollowedPerson[]) => {
      setFollowing((prev) => {
        const newOnes = persons.filter(
          (p) => !prev.some((e) => e.wcaId === p.wcaId)
        );
        if (!newOnes.length) return prev;
        const next = [...prev, ...newOnes];
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
    setUser({ ...loggedInUser, wca_id: null, wca_name: null, wca_avatar_url: null, last_feed_visit: null });
    setHydrated(false);

    fetch("/api/user/following")
      .then((r) => r.json())
      .then((dbFollowing: FollowedPerson[]) => {
        if (!Array.isArray(dbFollowing)) return [];
        const merged = [...dbFollowing];
        for (const lf of prevFollowing) {
          if (!merged.some((d) => d.wcaId === lf.wcaId)) merged.push(lf);
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
          <UserWidget
            user={user}
            onLoginClick={() => setShowLoginModal(true)}
            onLogout={handleLogout}
          />
        </div>
        <p className="text-gray-500 text-sm">
          Never miss a great moment from your favorite cubers.
        </p>
      </header>

      <FollowingSection
        following={following}
        userWcaId={user?.wca_id ?? null}
        onAdd={addPerson}
        onAddMany={addPersons}
        onRemove={removePerson}
      />

      {following.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-6 mt-6">
          {/* View toggle — always leftmost */}
          <div className="flex gap-0.5 border border-gray-200 rounded-lg p-0.5 bg-gray-50 shrink-0">
            <button
              type="button"
              onClick={() => handleViewModeChange("person")}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                viewMode === "person"
                  ? "bg-white text-gray-800 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
              Person
            </button>
            <button
              type="button"
              onClick={() => handleViewModeChange("feed")}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                viewMode === "feed"
                  ? "bg-white text-gray-800 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
              </svg>
              Feed
            </button>
          </div>
          {/* Summary text */}
          {!loading && persons !== null && (
            <p className="text-sm text-gray-500 flex-1">
              <span className="font-semibold text-gray-800">{totalPRs}</span> PRs
              {" · "}
              <span className="font-semibold text-gray-800">{cubersWithPRs}</span>{" "}
              cuber{cubersWithPRs !== 1 ? "s" : ""}
            </p>
          )}
          {/* Days selector — right side, person view only */}
          {viewMode === "person" && <DaysSelector current={days} options={VALID_DAYS} />}
        </div>
      )}

      {/* New PRs banner */}
      {newPRCount > 0 && !loading && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          <span className="font-semibold">{newPRCount} new PR{newPRCount !== 1 ? "s" : ""}</span>
          <span>since your last visit</span>
        </div>
      )}

      {following.length > 0 && loading && <LoadingState />}
      {following.length > 0 && !loading && fetchError && <FetchErrorState />}
      {following.length > 0 && !loading && !fetchError && persons !== null && persons.length === 0 && (
        <NoPRsState days={effectiveDays} />
      )}
      {following.length > 0 && !loading && !fetchError && persons && persons.length > 0 && (
        viewMode === "person" ? (
          <PRList
            persons={persons}
            isLoggedIn={user !== null}
            onLoginRequired={() => setShowLoginModal(true)}
          />
        ) : (
          <ChronologicalFeed
            persons={persons}
            isLoggedIn={user !== null}
            onLoginRequired={() => setShowLoginModal(true)}
          />
        )
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
            loading="lazy"
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

// ─── FollowingSection ─────────────────────────────────────────────────────────

function FollowingSection({
  following,
  userWcaId,
  onAdd,
  onAddMany,
  onRemove,
}: {
  following: FollowedPerson[];
  userWcaId: string | null;
  onAdd: (person: FollowedPerson) => void;
  onAddMany: (persons: FollowedPerson[]) => void;
  onRemove: (wcaId: string) => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [pendingPersons, setPendingPersons] = useState<FollowedPerson[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (!inputRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);

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
    const alreadyFollowed = following.some((f) => f.wcaId === result.wcaId);
    const alreadyPending = pendingPersons.some((p) => p.wcaId === result.wcaId);
    if (alreadyFollowed || alreadyPending) return;
    setPendingPersons((prev) => [
      ...prev,
      { wcaId: result.wcaId, name: result.name, countryIso2: result.countryIso2 },
    ]);
    setQuery("");
    setSuggestions([]);
    setShowSuggestions(false);
    setSearchDone(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      const trimmed = query.trim().toUpperCase();
      if (/^[0-9]{4}[A-Z]{4}[0-9]{2}$/.test(trimmed)) {
        const alreadyFollowed = following.some((f) => f.wcaId === trimmed);
        const alreadyPending = pendingPersons.some((p) => p.wcaId === trimmed);
        if (!alreadyFollowed && !alreadyPending) {
          setPendingPersons((prev) => [...prev, { wcaId: trimmed, name: trimmed }]);
        }
        setQuery("");
        setShowSuggestions(false);
      } else if (suggestions.length > 0) {
        handleSelect(suggestions[0]);
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }

  function handleConfirm() {
    if (!pendingPersons.length) return;
    onAddMany(pendingPersons);
    setPendingPersons([]);
  }

  const showNoResults = showSuggestions && searchDone && !isSearching && suggestions.length === 0;

  const searchInput = (large: boolean) => (
    <div className="flex flex-col gap-2">
      {/* Badge row — pending persons waiting to be confirmed */}
      {pendingPersons.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-0.5">
          {pendingPersons.map((p) => (
            <span
              key={p.wcaId}
              className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-800 text-xs font-medium pl-2 pr-1 py-0.5 rounded-full"
            >
              {p.countryIso2 && (
                <span className="text-sm leading-none">{flagEmoji(p.countryIso2)}</span>
              )}
              <span className="max-w-[120px] truncate">{p.name}</span>
              <button
                type="button"
                aria-label={`${p.name} entfernen`}
                onClick={() =>
                  setPendingPersons((prev) => prev.filter((x) => x.wcaId !== p.wcaId))
                }
                className="ml-0.5 p-2 -m-2 text-blue-400 hover:text-blue-700 text-base leading-none flex items-center justify-center"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input row + confirm button */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <svg
            className={`absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none ${large ? "w-4 h-4" : "w-3.5 h-3.5"}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
            placeholder={large ? "Search for a cuber to follow…" : "Add cuber by name or WCA ID…"}
            inputMode="search"
            enterKeyHint={pendingPersons.length > 0 ? "done" : "search"}
            className={`w-full border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent placeholder:text-gray-400 ${
              large
                ? "pl-10 pr-10 py-3 text-base text-center"
                : "pl-9 pr-8 py-2 text-sm"
            }`}
          />
          {isSearching ? (
            <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : query ? (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => { setQuery(""); setShowSuggestions(false); inputRef.current?.focus(); }}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
            >
              ×
            </button>
          ) : null}

          {/* Search suggestions */}
          {(showSuggestions || showNoResults) && (
            <div
              ref={dropdownRef}
              className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden"
            >
              {suggestions.map((r) => {
                const already =
                  following.some((f) => f.wcaId === r.wcaId) ||
                  pendingPersons.some((p) => p.wcaId === r.wcaId);
                return (
                  <button
                    key={r.wcaId}
                    type="button"
                    disabled={already}
                    onClick={() => handleSelect(r)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                      already ? "opacity-40 cursor-not-allowed" : "hover:bg-blue-50 cursor-pointer"
                    }`}
                  >
                    <span className="text-base w-6 text-center">{flagEmoji(r.countryIso2)}</span>
                    <span className="flex-1 min-w-0">
                      <span className="font-medium text-gray-900">{r.name}</span>
                      <span className="text-xs text-gray-400 font-mono ml-2">{r.wcaId}</span>
                    </span>
                    <span className="text-xs text-gray-400 shrink-0">{r.countryIso2}</span>
                  </button>
                );
              })}
              {showNoResults && (
                <p className="px-4 py-3 text-sm text-gray-500">
                  No results. Enter a WCA ID directly (e.g.{" "}
                  <span className="font-mono">2015MUEL01</span>) and press Enter.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Confirm button — only shown when there are pending persons */}
        {pendingPersons.length > 0 && (
          <button
            type="button"
            onClick={handleConfirm}
            className="w-full sm:w-auto sm:shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded-xl transition-colors whitespace-nowrap"
          >
            {pendingPersons.length === 1
              ? "1 Cuber folgen"
              : `${pendingPersons.length} Cuber folgen`}
          </button>
        )}
      </div>
    </div>
  );

  // ── Empty state: prominent centered search ──
  if (following.length === 0) {
    return (
      <div className="mb-8">
        <div className="max-w-md mx-auto">
          {searchInput(true)}
          {pendingPersons.length === 0 && (
            <p className="text-center text-sm text-gray-400 mt-3">
              Try <span className="font-medium text-gray-500">"Feliks Zemdegs"</span> or enter a WCA ID like{" "}
              <span className="font-mono text-gray-500">2009ZEMD01</span>
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Non-empty state: list + search ──
  return (
    <div className="mb-6 border border-gray-200 rounded-2xl overflow-visible">
      {/* Header – click to toggle list */}
      <button
        type="button"
        onClick={() => setListOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50/60 rounded-t-2xl hover:bg-gray-100/60 transition-colors"
      >
        <span className="text-sm font-semibold text-gray-700">
          Following {following.length} cuber{following.length !== 1 ? "s" : ""}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${listOpen ? "rotate-180" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* Collapsible grid */}
      {listOpen && (
        <div className="border-t border-gray-100 p-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {following.map((f) => {
              const isSelf = f.wcaId === userWcaId;
              return (
                <div
                  key={f.wcaId}
                  className="flex items-center gap-1.5 bg-gray-50 hover:bg-gray-100 rounded-lg px-2 py-1.5 transition-colors min-w-0"
                >
                  <WcaAvatar wcaId={f.wcaId} name={f.name} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 min-w-0">
                      {f.countryIso2 && (
                        <span className="text-xs leading-none shrink-0">{flagEmoji(f.countryIso2)}</span>
                      )}
                      <span className="text-xs font-medium text-gray-800 truncate">{f.name}</span>
                    </div>
                  </div>
                  {isSelf ? (
                    <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium shrink-0">
                      You
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onRemove(f.wcaId)}
                      aria-label={`Unfollow ${f.name}`}
                      className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none shrink-0 p-2 -m-2 flex items-center justify-center"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add search – always visible */}
      <div className={`px-3 py-2.5 ${listOpen ? "border-t border-gray-100" : "border-t border-gray-100 rounded-b-2xl"}`}>
        {searchInput(false)}
      </div>
    </div>
  );
}

// ─── States ───────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
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
      <p className="text-red-500 text-sm mt-1">Please reload the page or try again later.</p>
    </div>
  );
}

function NoPRsState({ days }: { days: number }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
      <p className="text-gray-500">No PRs from followed cubers in the last {days} days.</p>
      <p className="text-gray-400 text-sm mt-1">Try a longer time range.</p>
    </div>
  );
}
