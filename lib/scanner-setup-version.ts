// The site may still serve a legacy staged installer during a rollout.
export function hasFi7160SetupWizard(version: string | null): boolean {
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [major, minor, patch] = version.split(".").map(Number);
  return major > 0 || minor > 4 || (minor === 4 && patch >= 6);
}
