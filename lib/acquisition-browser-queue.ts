export type PendingPhoto = {
  key: string;
  userId: string;
  sessionId: string;
  slotId: string;
  generation: number;
  replacePending?: boolean;
  blob: Blob;
};
function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("mtg-acquisition-photos-v1", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("pending", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("Browser photo storage is unavailable"));
  });
}
export async function savePendingPhoto(photo: PendingPhoto) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("pending", "readwrite");
      tx.objectStore("pending").put(photo);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () =>
        reject(
          new Error("Browser storage is full; keep this page open and retry"),
        );
    });
  } finally {
    db.close();
  }
}
export async function removePendingPhoto(key: string) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("pending", "readwrite");
      tx.objectStore("pending").delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () =>
        reject(new Error("Could not clear the local upload receipt"));
    });
  } finally {
    db.close();
  }
}
export async function loadPendingPhotos(userId: string, sessionId: string) {
  const db = await database();
  try {
    return await new Promise<PendingPhoto[]>((resolve, reject) => {
      const request = db.transaction("pending").objectStore("pending").getAll();
      request.onsuccess = () =>
        resolve(
          (request.result as PendingPhoto[]).filter(
            (p) => p.userId === userId && p.sessionId === sessionId,
          ),
        );
      request.onerror = () =>
        reject(new Error("Could not restore pending photos"));
    });
  } finally {
    db.close();
  }
}
export function captureUuid() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
