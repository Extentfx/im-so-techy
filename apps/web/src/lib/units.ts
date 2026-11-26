import { kgToLb, lbToKg, type Units } from '@life/shared';

export const toDisplay = (kg: number, units: Units): number =>
  units === 'kg' ? Math.round(kg * 10) / 10 : kgToLb(kg);
export const fromDisplay = (v: number, units: Units): number => (units === 'kg' ? v : lbToKg(v));
export const unitLabel = (units: Units): string => (units === 'kg' ? 'kg' : 'lb');
export const fmtWeight = (kg: number, units: Units): string =>
  `${toDisplay(kg, units)} ${unitLabel(units)}`;
