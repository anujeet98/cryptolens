import { binance } from "./binance";
import { bitget } from "./bitget";
import { bybit } from "./bybit";
import type { ExchangeConnector } from "./types";
import type { ExchangeId } from "@/types/market";

// Register new connectors here. OKX is unreachable from the dev network (India), see README.
export const connectors: Partial<Record<ExchangeId, ExchangeConnector>> = { binance, bybit, bitget };

export function getConnector(id: ExchangeId): ExchangeConnector {
  const c = connectors[id];
  if (!c) throw new Error(`Unsupported exchange: ${id}`);
  return c;
}
