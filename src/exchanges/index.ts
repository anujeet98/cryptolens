import { binance } from "./binance";
import type { ExchangeConnector } from "./types";
import type { ExchangeId } from "@/types/market";

// Register new connectors (bybit, okx) here.
export const connectors: Partial<Record<ExchangeId, ExchangeConnector>> = { binance };

export function getConnector(id: ExchangeId): ExchangeConnector {
  const c = connectors[id];
  if (!c) throw new Error(`Unsupported exchange: ${id}`);
  return c;
}
