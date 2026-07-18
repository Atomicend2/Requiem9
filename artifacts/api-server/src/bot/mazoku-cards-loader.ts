/**
 * mazoku-cards-loader.ts
 * All cards are now unified in unified_cards.jsonl.
 * This file re-exports loadCardsFromRepo as loadMazokuCards so callers
 * that still import from here continue to work without changes.
 */
export { loadCardsFromRepo as loadMazokuCards } from "./cards-loader.js";
