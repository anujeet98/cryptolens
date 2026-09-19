import { binance } from "./binance";
import { bybit } from "./bybit";
import type { ExchangeConnector } from "./types";
import type { ExchangeId } from "@/types/market";

// Register new connectors (okx next) here.
export const connectors: Partial<Record<ExchangeId, ExchangeConnector>> = { binance, bybit };

export function getConnector(id: ExchangeId): ExchangeConnector {
  const c = connectors[id];
  if (!c) throw new Error(`Unsupported exchange: ${id}`);
  return c;
}
