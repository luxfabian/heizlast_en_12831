import climateData from './plz_temperatures.json';

const FALLBACK_TEMP = -12;

const prefixes = climateData.prefixes as Record<string, number>;

export function getDesignTemperature(plz: string): { temp: number; warning: boolean } {
  if (!plz || plz.length < 2) return { temp: FALLBACK_TEMP, warning: true };
  const prefix = plz.substring(0, 2);
  const temp = prefixes[prefix];
  if (temp === undefined) return { temp: FALLBACK_TEMP, warning: true };
  return { temp, warning: false };
}

export function validatePlz(plz: string): boolean {
  return /^\d{5}$/.test(plz);
}
