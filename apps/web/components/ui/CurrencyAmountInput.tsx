"use client";

/**
 * Live Indian (en-IN) / locale-aware amount input.
 * Displays 1,00,000 while typing; parent receives raw numeric string (100000).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
} from "react";
import {
  countSignificantBefore,
  currencyLocale,
  currencySymbol,
  formatAmountInputLive,
  formatIndianNumber,
  parseAmount,
  restoreAmountCursor,
  type CurrencyCode,
} from "@/lib/currency";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "inputMode"
> & {
  /** Raw numeric value (no commas) — string or number from form state / API */
  value: string | number | null | undefined;
  /** Called with raw numeric string ("" | "100000" | "100000.5") safe for DB Number() */
  onValueChange: (raw: string) => void;
  /** Currency for symbol + grouping locale (default app / INR → en-IN) */
  currency?: string | null;
  /** Show currency symbol prefix */
  showSymbol?: boolean;
  /** Allow decimals (default true for finance; false for whole rupees) */
  allowDecimal?: boolean;
};

export function CurrencyAmountInput({
  value,
  onValueChange,
  currency,
  showSymbol = true,
  allowDecimal = true,
  className = "",
  onBlur,
  onFocus,
  disabled,
  placeholder,
  id,
  name,
  required,
  ...rest
}: Props) {
  const locale = currencyLocale(currency);
  const symbol = currencySymbol(currency);
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [display, setDisplay] = useState(() =>
    formatFromValue(value, locale, allowDecimal)
  );

  // Sync from parent when not focused (e.g. form reset, edit load)
  useEffect(() => {
    if (!focused) {
      setDisplay(formatFromValue(value, locale, allowDecimal));
    }
  }, [value, locale, allowDecimal, focused]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const el = e.target;
      let next = el.value;
      if (!allowDecimal) {
        next = next.replace(/\./g, "");
      }
      const caret = el.selectionStart ?? next.length;
      const sigBefore = countSignificantBefore(next, caret);
      const { display: formatted, raw } = formatAmountInputLive(next, locale);
      setDisplay(formatted);
      onValueChange(raw);

      requestAnimationFrame(() => {
        const node = inputRef.current;
        if (!node) return;
        const pos = restoreAmountCursor(formatted, sigBefore);
        try {
          node.setSelectionRange(pos, pos);
        } catch {
          /* ignore */
        }
      });
    },
    [allowDecimal, locale, onValueChange]
  );

  const handleFocus = useCallback(
    (e: FocusEvent<HTMLInputElement>) => {
      setFocused(true);
      onFocus?.(e);
    },
    [onFocus]
  );

  const handleBlur = useCallback(
    (e: FocusEvent<HTMLInputElement>) => {
      setFocused(false);
      // Normalize display from raw on blur
      const n = parseAmount(value);
      setDisplay(
        n == null
          ? ""
          : formatIndianNumber(n, {
              locale,
              maximumFractionDigits: allowDecimal ? 2 : 0,
              minimumFractionDigits: 0,
            })
      );
      onBlur?.(e);
    },
    [value, locale, allowDecimal, onBlur]
  );

  return (
    <div className="relative">
      {showSymbol && (
        <span
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm tabular-nums"
          aria-hidden
        >
          {symbol}
        </span>
      )}
      <input
        {...rest}
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        inputMode={allowDecimal ? "decimal" : "numeric"}
        autoComplete="off"
        disabled={disabled}
        required={required}
        placeholder={placeholder ?? "0"}
        value={display}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={`${className} ${showSymbol ? "pl-8" : ""} tabular-nums`.trim()}
        aria-label={rest["aria-label"] || "Amount"}
      />
    </div>
  );
}

function formatFromValue(
  value: string | number | null | undefined,
  locale: string,
  allowDecimal: boolean
): string {
  if (value == null || value === "") return "";
  // Already a partial raw while editing parent — format for display
  if (typeof value === "string" && /[^\d.-]/.test(value)) {
    return formatAmountInputLive(value, locale).display;
  }
  const n = parseAmount(value);
  if (n == null) {
    // Preserve in-progress raw like "" or incomplete
    if (typeof value === "string") {
      return formatAmountInputLive(value, locale).display;
    }
    return "";
  }
  return formatIndianNumber(n, {
    locale,
    maximumFractionDigits: allowDecimal ? 2 : 0,
    minimumFractionDigits: 0,
  });
}

export type { CurrencyCode };
