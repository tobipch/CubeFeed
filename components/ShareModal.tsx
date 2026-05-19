"use client";

import { useEffect, useRef, useState } from "react";
import type { PersonPRs } from "@/lib/queries";

type ShareState = "generating" | "ready" | "sharing" | "copied" | "error";

interface Props {
  person: PersonPRs;
  bravos?: Record<string, number>;
  avatarUrl?: string;
  onClose: () => void;
}

export default function ShareModal({ person, bravos, avatarUrl, onClose }: Props) {
  const [state, setState] = useState<ShareState>("generating");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const blobUrlRef = useRef<string | null>(null);

  // Generate image via server-side API (Satori / next/og)
  useEffect(() => {
    let cancelled = false;
    async function generate() {
      try {
        const res = await fetch("/api/share-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ person, bravos, avatarUrl }),
        });
        if (!res.ok) throw new Error(`API error ${res.status}`);
        const result = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(result);
        blobUrlRef.current = url;
        setBlob(result);
        setImageUrl(url);
        setState("ready");
      } catch {
        if (!cancelled) {
          setErrorMsg("Could not create image.");
          setState("error");
        }
      }
    }
    generate();
    return () => { cancelled = true; };
  }, [person, bravos, avatarUrl]);

  useEffect(() => {
    return () => { if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current); };
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleNativeShare() {
    if (!blob) return;
    setState("sharing");
    try {
      const ts = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
      const file = new File([blob], `cubefeed-${person.personId}-${ts}.png`, { type: "image/png" });
      await navigator.share({ files: [file], title: `${person.personName} – new personal bests` });
    } catch {
      // cancelled by user
    } finally {
      setState("ready");
    }
  }

  async function handleCopy() {
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setState("copied");
      setTimeout(() => setState("ready"), 2500);
    } catch {
      setErrorMsg("Could not access clipboard.");
      setState("error");
    }
  }

  function handleDownload() {
    if (!imageUrl) return;
    const ts = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = `cubefeed-${person.personId}-${ts}.png`;
    a.click();
  }

  const canNativeShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    blob !== null &&
    navigator.canShare({ files: [new File([blob], "x.png", { type: "image/png" })] });

  const isLoading = state === "generating";
  const isReady = state === "ready" || state === "copied" || state === "sharing";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Share result</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 leading-none text-xl" aria-label="Close">×</button>
        </div>

        {/* Preview */}
        <div className="px-5 pt-4 pb-3">
          {isLoading && (
            <div className="flex flex-col items-center justify-center gap-2 h-36 text-gray-400">
              <svg className="w-6 h-6 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              <span className="text-sm">Creating image…</span>
            </div>
          )}
          {state === "error" && (
            <div className="flex flex-col items-center justify-center gap-2 h-36 text-red-500">
              <span className="text-sm">{errorMsg}</span>
            </div>
          )}
          {isReady && imageUrl && (
            <img src={imageUrl} alt="Preview" className="w-full rounded-lg border border-gray-200 object-contain" />
          )}
        </div>

        {/* Actions */}
        {isReady && (
          <div className="px-5 pb-5 flex flex-col gap-2">
            {canNativeShare && (
              <button
                type="button"
                onClick={handleNativeShare}
                disabled={state === "sharing"}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
              >
                <NativeShareIcon />
                {state === "sharing" ? "Sharing…" : "Share"}
              </button>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="flex-1 flex items-center justify-center gap-1.5 border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium py-2 rounded-xl text-sm transition-colors"
              >
                {state === "copied" ? <><CheckIcon /> Copied!</> : <><CopyIcon /> Copy image</>}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="flex-1 flex items-center justify-center gap-1.5 border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium py-2 rounded-xl text-sm transition-colors"
              >
                <DownloadIcon /> Download
              </button>
            </div>
            {!canNativeShare && (
              <p className="text-xs text-center text-gray-400 pt-1">
                To share on WhatsApp or Instagram, download the image and attach it manually — or open this page on your phone to use the native share button.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function NativeShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-green-600" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
