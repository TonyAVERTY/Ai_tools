import { readFileSync } from 'node:fs';

// Température CPU en °C (null hors Raspberry / Linux sans capteur) : simple information pour les admins
export function cpuTemp(path = '/sys/class/thermal/thermal_zone0/temp') {
  try { return Math.round(Number(readFileSync(path, 'utf8')) / 100) / 10; }
  catch { return null; }
}
