"use client";

import { useEffect, useRef, useState } from "react";
import type { PersonPRs } from "@/lib/queries";
import ShareCard from "./ShareCard";
import { generateShareImage } from "@/lib/generateShareImage";

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
  const shareCardRef = useRef<HTMLDivElement>(null);
  const blobUrlRef = useRef<string | null>(null);

  const avatarProxyUrl = avatarUrl
    ? `/api/proxy-image?url=${encodeURIComponent(avatarUrl)}`
    : undefined;

  // Generate image once the hidden ShareCard has rendered
  useEffect(() => {
    const el = shareCardRef.current;
    if (!el) return;

    // Small delay so the card is fully painted before capture
    const timeout = setTimeout(async () => {
      try {
        const result = await generateShareImage(el);
        const url = URL.createObjectURL(result);
        blobUrlRef.current = url;
        setBlob(result);
        setImageUrl(url);
        setState("ready");
      } catch {
        setErrorMsg("Could not create image.");
        setState("error");
      }
    }, 150);

    return () => clearTimeout(timeout);
  }, []);

  // Revoke object URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  // Escape to close
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleNativeShare() {
    if (!blob) return;
    setState("sharing");
    try {
      const file = new File([blob], "cubefeed-pr.png", { type: "image/png" });
      await navigator.share({
        files: [file],
        title: `${person.personName} – new personal bests`,
      });
    } catch {
      // User cancelled or share failed — not an error
    } finally {
      setState("ready");
    }
  }

  async function handleCopy() {
    if (!blob) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      setState("copied");
      setTimeout(() => setState("ready"), 2500);
    } catch {
      setErrorMsg("Clipboard-Zugriff fehlgeschlagen.");
      setState("error");
    }
  }

  function handleDownload() {
    if (!imageUrl) return;
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = `cubefeed-${person.personId}.png`;
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
    <>
      {/* Hidden ShareCard for screenshot */}
      <div
        aria-hidden="true"
        style={{ position: "absolute", left: -9999, top: -9999, pointerEvents: "none" }}
      >
        <div ref={shareCardRef}>
          <ShareCard person={person} bravos={bravos} avatarProxyUrl={avatarProxyUrl} />
        </div>
      </div>

      {/* Backdrop + modal */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
          {/* Modal header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="text-base font-semibold text-gray-900">Share result</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 leading-none text-xl"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {/* Preview area */}
          <div className="px-5 pt-4 pb-3">
            {isLoading && (
              <div className="flex flex-col items-center justify-center gap-2 h-36 text-gray-400">
                <svg
                  className="w-6 h-6 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
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
              <img
                src={imageUrl}
                alt="Preview"
                className="w-full rounded-lg border border-gray-200 object-contain"
              />
            )}
          </div>

          {/* Action buttons */}
          {isReady && (
            <div className="px-5 pb-5 flex flex-col gap-2">
              {canNativeShare && (
                <button
                  type="button"
                  onClick={handleNativeShare}
                  disabled={state === "sharing"}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
                >
                  <ShareIcon />
                  {state === "sharing" ? "Sharing…" : "Share"}
                </button>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex-1 flex items-center justify-center gap-1.5 border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium py-2 rounded-xl text-sm transition-colors"
                >
                  {state === "copied" ? (
                    <>
                      <CheckIcon />
                      Copied!
                    </>
                  ) : (
                    <>
                      <CopyIcon />
                      Copy image
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleDownload}
                  className="flex-1 flex items-center justify-center gap-1.5 border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium py-2 rounded-xl text-sm transition-colors"
                >
                  <DownloadIcon />
                  Download
                </button>
              </div>

              {/* Desktop social links (only if native share not available) */}
              {!canNativeShare && (
                <div className="flex gap-2 pt-1">
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(`${person.personName} set new personal bests! 🎉`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 border border-gray-200 hover:bg-green-50 hover:border-green-200 text-gray-600 hover:text-green-700 py-2 rounded-xl text-sm transition-colors"
                  >
                    <WhatsAppIcon />
                    WhatsApp
                  </a>
                  <a
                    href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent("https://cubefeed.tobip.ch")}&quote=${encodeURIComponent(`${person.personName} set new personal bests!`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 border border-gray-200 hover:bg-blue-50 hover:border-blue-200 text-gray-600 hover:text-blue-700 py-2 rounded-xl text-sm transition-colors"
                  >
                    <FacebookIcon />
                    Facebook
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
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
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}
