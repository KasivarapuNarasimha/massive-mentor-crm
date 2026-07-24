"use client";

/** Shared production password policy (Customer + Super Admin reset) */

export type PasswordRule = {
  id: string;
  label: string;
  test: (password: string) => boolean;
};

export const PASSWORD_RULES: PasswordRule[] = [
  { id: "len", label: "At least 8 characters", test: (p) => p.length >= 8 },
  { id: "upper", label: "One uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { id: "lower", label: "One lowercase letter", test: (p) => /[a-z]/.test(p) },
  { id: "num", label: "One number", test: (p) => /[0-9]/.test(p) },
  { id: "special", label: "One special character", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export function passwordMeetsPolicy(password: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(password));
}

export function PasswordRulesChecklist({ password }: { password: string }) {
  return (
    <ul className="space-y-1.5 mt-2">
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(password);
        return (
          <li
            key={r.id}
            className={`text-xs flex items-center gap-2 ${ok ? "text-emerald-400" : "text-muted-foreground"}`}
          >
            <span className="w-3.5 text-center">{ok ? "✓" : "○"}</span>
            {r.label}
          </li>
        );
      })}
    </ul>
  );
}
