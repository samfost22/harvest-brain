// Wine chemistry helpers. Pure functions, shared by the server and the browser.

export const SO2_PKA1 = 1.81;           // pKa1 of SO2 in wine at ~20 °C
export const KMBS_SO2_FRACTION = 0.576; // potassium metabisulfite is 57.6% SO2 by weight (fresh powder)
export const LITERS_PER_GALLON = 3.78541;
export const DRY_BRIX = -1.5;           // hydrometer Brix of a dry wine, roughly

export function molecularSO2(freeSO2, pH) {
  if (freeSO2 == null || pH == null) return null;
  return freeSO2 / (1 + 10 ** (pH - SO2_PKA1));
}

export function freeSO2ForMolecular(targetMolecular, pH) {
  return targetMolecular * (1 + 10 ** (pH - SO2_PKA1));
}

/**
 * SO2 needed to reach a molecular target. Assumes the added SO2 stays free at first,
 * so re-test 24 h after adding: some of it binds, more so in reds.
 */
export function so2Plan({ freeSO2 = 0, pH, volumeL, targetMolecular }) {
  if (pH == null || !targetMolecular) return null;
  const needFree = freeSO2ForMolecular(targetMolecular, pH);
  const addPpm = Math.max(0, needFree - (freeSO2 || 0));
  const so2Grams = volumeL ? (addPpm * volumeL) / 1000 : null;
  return {
    molecular: molecularSO2(freeSO2, pH),
    needFree,
    addPpm,
    so2Grams,
    kmbsGrams: so2Grams == null ? null : so2Grams / KMBS_SO2_FRACTION,
  };
}

/** Potential alcohol (% v/v) from Brix. 0.55–0.62 depending on yeast; 0.59 is a middle value. */
export const potentialAlcohol = (brix, factor = 0.59) => (brix == null ? null : brix * factor);

/** Rule-of-thumb yeast-assimilable nitrogen need (mg N/L): ~150 at 21 °Bx, +25 per °Bx above. */
export const yanTarget = brix => (brix == null ? 200 : Math.max(150, Math.round(150 + (brix - 21) * 25)));

/** Fraction of fermentable sugar consumed, 0..1. */
export function sugarDepletion(startBrix, brixNow) {
  if (startBrix == null || brixNow == null) return null;
  return Math.min(1, Math.max(0, (startBrix - brixNow) / (startBrix - DRY_BRIX)));
}

export const fToC = f => (f == null ? null : ((f - 32) * 5) / 9);
