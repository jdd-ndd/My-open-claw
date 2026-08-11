export interface GatewayAttachment {
  type: 'file';
  name: string;
  url: string;
  size: number;
  mimeType: string;
}

export async function fileToGatewayAttachment(file: File): Promise<GatewayAttachment> {
  const dataUrl = await readFileAsDataUrl(file);

  return {
    type: 'file',
    name: file.name,
    url: dataUrl,
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(String(reader.result ?? ''));
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error(`Failed to read file: ${file.name}`));
    };

    reader.readAsDataURL(file);
  });
}
