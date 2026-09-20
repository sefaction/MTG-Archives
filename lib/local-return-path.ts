const LOCAL_ORIGIN = "https://mtg-return.invalid";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Accept application-relative destinations only, including after URL normalization. */
export function safeLocalReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    CONTROL_CHARACTERS.test(value)
  )
    return "/dashboard";
  try {
    const url = new URL(value, LOCAL_ORIGIN);
    const decodedPath = decodeURIComponent(url.pathname);
    if (
      url.origin !== LOCAL_ORIGIN ||
      decodedPath.startsWith("//") ||
      decodedPath.includes("\\") ||
      CONTROL_CHARACTERS.test(decodedPath)
    )
      return "/dashboard";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/dashboard";
  }
}
