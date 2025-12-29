// /lib/price-analyzer-v3/snapshot-validate.js
import { get, pushMissing } from "./paths";

export const SPEC_FLAG = "v3.3-full-ai-core";
const REQUIRED_SCHEMA_NAME = "price_analyzer_full_snapshot";
const REQUIRED_SCHEMA_VERSION = "3.3-full";

export function validateSnapshot(snapshot) {
  const missing = [];
  const errors = [];

  const schemaName = get(snapshot, "schema.name");
  const schemaVersion = get(snapshot, "schema.version");

  if (schemaName == null) pushMissing(missing, "schema.name");
  if (schemaVersion == null) pushMissing(missing, "schema.version");

  if (schemaName && schemaName !== REQUIRED_SCHEMA_NAME) {
    errors.push(
      `SCHEMA_MISMATCH: schema.name=${schemaName} (expected ${REQUIRED_SCHEMA_NAME})`
    );
  }
  if (schemaVersion && schemaVersion !== REQUIRED_SCHEMA_VERSION) {
    errors.push(
      `SCHEMA_MISMATCH: schema.version=${schemaVersion} (expected ${REQUIRED_SCHEMA_VERSION})`
    );
  }

  const generatedAt = get(snapshot, "generated_at");
  if (generatedAt == null) pushMissing(missing, "generated_at");

  if (get(snapshot, "per_exchange.bybit.symbols") == null) {
    pushMissing(missing, "per_exchange.bybit.symbols");
  }
  if (get(snapshot, "per_exchange_ltf.bybit.symbols") == null) {
    pushMissing(missing, "per_exchange_ltf.bybit.symbols");
  }

  return {
    ok: errors.length === 0,
    spec: SPEC_FLAG,
    missing,
    errors,
    schema: { name: schemaName, version: schemaVersion },
    generated_at: generatedAt,
  };
}
