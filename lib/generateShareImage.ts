async function waitForImages(el: HTMLElement): Promise<void> {
  const imgs = Array.from(el.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) { resolve(); return; }
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
          setTimeout(resolve, 5000);
        }),
    ),
  );
}

export async function generateShareImage(element: HTMLElement): Promise<Blob> {
  const { default: html2canvas } = await import("html2canvas");

  // Ensure all web fonts (Geist, DM Mono, cubing icons) are fully loaded
  if (typeof document !== "undefined" && document.fonts?.ready) {
    await document.fonts.ready;
  }

  await waitForImages(element);

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    allowTaint: false,
    logging: false,
    backgroundColor: "#f3f4f6",
    // scale/allowTaint are valid options missing from @types/html2canvas
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas toBlob returned null"));
      },
      "image/png",
    );
  });
}
