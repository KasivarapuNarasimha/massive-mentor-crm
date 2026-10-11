/** Fail closed until backup/restore safety remediation is complete. No runtime bypass. */
export const RESTORE_DISABLED_CODE = "RESTORE_TEMPORARILY_DISABLED";
export const RESTORE_DISABLED_MESSAGE =
  "Restore is temporarily disabled pending backup/restore safety remediation.";

export class RestoreDisabledError extends Error {
  readonly code = RESTORE_DISABLED_CODE;

  constructor() {
    super(RESTORE_DISABLED_MESSAGE);
    this.name = "RestoreDisabledError";
  }
}

export function assertRestoreEnabled(): void {
  throw new RestoreDisabledError();
}
