"use client";

import {
  useCallback,
  useId,
  useRef,
  type ChangeEvent,
  type InputHTMLAttributes,
  type Ref,
} from "react";
import { useState } from "react";

export type PasswordInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "className"
> & {
  /** Classes applied to the input element (padding-right is enforced for the icon). */
  className?: string;
  /** Optional wrapper class for the relative container. */
  wrapperClassName?: string;
  /** Forward ref to the underlying input. */
  inputRef?: Ref<HTMLInputElement>;
};

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    // Eye-off (password visible → click to hide)
    return (
      <svg
        className="w-5 h-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.75}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
        />
      </svg>
    );
  }
  // Eye (password hidden → click to show)
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

/**
 * Accessible password field with show/hide toggle.
 * - UI only: never logs or stores plaintext beyond controlled value
 * - Preserves selection/cursor when toggling type
 */
export function PasswordInput({
  className = "",
  wrapperClassName = "",
  inputRef,
  id,
  onChange,
  ...rest
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const autoId = useId();
  const inputId = id || autoId;
  const localRef = useRef<HTMLInputElement | null>(null);

  const setRefs = useCallback(
    (node: HTMLInputElement | null) => {
      localRef.current = node;
      if (typeof inputRef === "function") inputRef(node);
      else if (inputRef && typeof inputRef === "object") {
        (inputRef as { current: HTMLInputElement | null }).current = node;
      }
    },
    [inputRef]
  );

  const toggle = () => {
    const el = localRef.current;
    const start = el?.selectionStart ?? null;
    const end = el?.selectionEnd ?? null;
    setVisible((v) => !v);
    // Restore cursor after React commits type change
    requestAnimationFrame(() => {
      const input = localRef.current;
      if (input && start != null && end != null) {
        try {
          input.setSelectionRange(start, end);
        } catch {
          /* some browsers ignore on type=password */
        }
        input.focus();
      }
    });
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    // Never log password values
    onChange?.(e);
  };

  // Ensure room for the icon on the right
  const inputClass = [
    className,
    "pr-11",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`relative ${wrapperClassName}`.trim()}>
      <input
        {...rest}
        id={inputId}
        ref={setRefs}
        type={visible ? "text" : "password"}
        className={inputClass}
        onChange={handleChange}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      <button
        type="button"
        tabIndex={0}
        onClick={toggle}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center min-w-10 min-h-10 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25 touch-manipulation"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        aria-controls={inputId}
        title={visible ? "Hide password" : "Show password"}
      >
        <EyeIcon open={visible} />
      </button>
    </div>
  );
}
