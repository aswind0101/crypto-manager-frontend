import * as React from "react";

type Options<T> = {
  serialize?: (value: T) => string;
  deserialize?: (raw: string) => T;
};

/**
 * SSR-safe localStorage state:
 * - Reads once on init (client only).
 * - Writes on change (client only).
 * - Never throws if storage is blocked/unavailable.
 */
export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
  options?: Options<T>
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const serialize = options?.serialize ?? ((v: T) => JSON.stringify(v));
  const deserialize =
    options?.deserialize ??
    ((raw: string) => {
      try {
        return JSON.parse(raw) as T;
      } catch {
        return defaultValue;
      }
    });

  const [value, setValue] = React.useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) return defaultValue;
      return deserialize(raw);
    } catch {
      return defaultValue;
    }
  });

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, serialize(value));
    } catch {
      // ignore
    }
  }, [key, value, serialize]);

  return [value, setValue];
}
