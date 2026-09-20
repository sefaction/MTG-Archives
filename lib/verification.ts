export function verificationSteps(coreOnly = false) {
  return [
    "prisma:generate",
    "typecheck",
    "test",
    "build",
    ...(coreOnly ? [] : ["ui:test"]),
  ];
}

/** Fail immediately; never report later stages as checked after an earlier failure. */
export function runVerification(run: (step: string) => void, coreOnly = false) {
  for (const step of verificationSteps(coreOnly)) run(step);
}
