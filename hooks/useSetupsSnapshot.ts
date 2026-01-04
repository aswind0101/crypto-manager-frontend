import { useMemo } from "react";
import { useFeaturesSnapshot } from "./useFeaturesSnapshot";
import { buildSetups } from "../lib/feeds/setups/engine";

export function useSetupsSnapshot(symbol: string) {
  const { snap, features } = useFeaturesSnapshot(symbol);

  const setups = useMemo(() => {
    if (!snap || !features) return null;
    return buildSetups({ snap, features });
  }, [snap, features]);

  return { snap, features, setups };
}
