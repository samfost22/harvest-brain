// Default decision thresholds. These are common cellar rules of thumb, not lab standards.
// Tune them to your own wines — every alert in the app reads from here.

export const RULES = {
  molecularSO2Target: { red: 0.5, white: 0.8, rose: 0.8 }, // mg/L

  // Primary fermentation
  capTempWatchF: 90,
  capTempActF: 95,
  capOverMustWatchF: 10,
  sluggishBrixPerDay: { red: 1.0, white: 0.5, rose: 0.5 }, // while Brix > 5
  stuckBrixPerDay: 0.3,                                     // over ~48 h, above dryness
  vsLastVintageWatchPct: 15,                                // behind the same block's prior vintage
  vsLastVintageActPct: 25,
  nutrientSecondAt: 1 / 3,                                  // fraction of sugar consumed
  nutrientCutoff: 1 / 2,
  staleReadingHours: 30,

  // Malolactic
  coInoculationBrix: 2, // ML bacteria added above this Brix is co-inoculation: the batch stays in primary
  mlfMinTempF: 64,
  mlfDoneMalic: 0.1,   // g/L
  mlfStallDays: 10,
  mlfStallDrop: 0.2,   // g/L over mlfStallDays

  // Aging
  so2CheckDays: 30,
  vaWatch: 0.6,        // g/L acetic
  vaAct: 0.9,
  brettPh: 3.65,
  brettWords: ['barnyard', 'band-aid', 'bandaid', 'band aid', 'horsey', 'horse blanket',
    'sweaty saddle', 'medicinal', 'mousy', 'mousiness', '4-ep', 'brett'],
};

export const SEVERITY_ORDER = { act: 0, watch: 1, info: 2 };
