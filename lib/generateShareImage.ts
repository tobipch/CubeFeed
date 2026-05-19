export async function generateShareImage(element: HTMLElement): Promise<Blob> {
  const { default: html2canvas } = await import("html2canvas");

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: "#f9fafb",
    // scale is a valid option but missing from the @types/html2canvas declaration
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
