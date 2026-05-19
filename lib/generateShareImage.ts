async function waitForImages(el: HTMLElement): Promise<void> {
  const imgs = Array.from(el.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalHeight !== 0) {
            resolve();
            return;
          }
          const done = () => resolve();
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
          // Hard timeout so we never block forever
          setTimeout(resolve, 4000);
        }),
    ),
  );
}

export async function generateShareImage(element: HTMLElement): Promise<Blob> {
  const { default: html2canvas } = await import("html2canvas");

  await waitForImages(element);

  // Extra tick for layout / font rendering to settle
  await new Promise((r) => setTimeout(r, 80));

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    allowTaint: false,
    logging: false,
    backgroundColor: "#f9fafb",
    // scale/allowTaint are valid options but missing from @types/html2canvas
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
