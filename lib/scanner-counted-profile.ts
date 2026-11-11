// Identity of the explicit native route, not a generic image-count guarantee.
export const COUNTED_SCANNER_DEVICE = "CountedTwain:PaperStream IP fi-7160";
export const COUNTED_SCANNER_BACKEND = "fi7160-counted-twain-v1";
export const isCountedScannerDevice = (device: { id: string; backend: string }) =>
  device.id === COUNTED_SCANNER_DEVICE && device.backend === COUNTED_SCANNER_BACKEND;
const LEGACY_NATIVE_SCANNER_VERSION = "0.3.0-native";
export const COUNTED_RESOLUTION_SCANNER_VERSION = "0.4.0-native";
export const isNativeScannerVersion = (version: string | null) =>
  version === LEGACY_NATIVE_SCANNER_VERSION || version === COUNTED_RESOLUTION_SCANNER_VERSION;
export const supportsCountedResolution = (version: string | null, dpi: 300 | 600) =>
  dpi === 600 || version === COUNTED_RESOLUTION_SCANNER_VERSION;

export const countedScannerSettings = { dpi: 600 as const, widthInches: 2.7, heightInches: 3.6,
  horizontalPlacement: "Center" as const, duplex: false as const, color: "RGB" as const,
  autoCrop: false as const, deskew: false as const, removeBlank: false as const };
