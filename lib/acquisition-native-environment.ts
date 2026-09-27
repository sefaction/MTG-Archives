// Native image parsers get only runtime configuration, never application
// database/session/backup credentials. Linux also drops the child's identity
// so it cannot inspect the root worker's environment through /proc.
export function acquisitionNativeEnvironment() {
  const allowed = new Set([
    "path",
    "systemroot",
    "windir",
    "tmp",
    "temp",
    "tmpdir",
    "lang",
    "lc_all",
    "omp_num_threads",
    "omp_thread_limit",
    "openblas_num_threads",
    "paddle_pdx_cache_home",
    "paddle_pdx_disable_model_source_check",
  ]);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      allowed.has(key.toLowerCase()),
    ),
  );
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    NODE_ENV: "production",
    HOME: "/tmp/mtg-acquisition-native",
    PYTHONUNBUFFERED: "1",
  };
  return {
    env: childEnv,
    ...(process.platform === "linux" && process.getuid?.() === 0
      ? { uid: 65534, gid: 65534 }
      : {}),
  };
}
