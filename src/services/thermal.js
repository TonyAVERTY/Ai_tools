import { readFileSync } from 'node:fs';

// Température CPU en °C (null hors Raspberry / Linux sans capteur)
export function cpuTemp(path = '/sys/class/thermal/thermal_zone0/temp') {
  try { return Math.round(Number(readFileSync(path, 'utf8')) / 100) / 10; }
  catch { return null; }
}

// Attend que le CPU repasse sous le seuil (hystérésis de 5 °C pour éviter le yo-yo)
export async function waitCool(max, { read = cpuTemp, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onWait } = {}) {
  let t = read();
  if (t === null || t < max) return;
  while (t !== null && t >= max - 5) {
    await onWait?.(t);
    await sleep(30_000);
    t = read();
  }
}
