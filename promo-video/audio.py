"""Bande son 100 % originale (synthèse), aucune licence tierce : lit bas, bruitages calés sur le montage.
Usage : python3 promo-video/audio.py   ->  promo-video/out/audio.wav (48 kHz, stéréo)"""
import os, wave
import numpy as np

SR, DUR = 48000, 27.0
BPM = 120
out = np.zeros((int(SR * DUR), 2))
rng = np.random.default_rng(7)

def add(t0, sig, gain=1.0, pan=0.0):
    i = int(t0 * SR)
    if i >= len(out): return
    sig = sig[: len(out) - i] * gain
    out[i:i + len(sig), 0] += sig * (1 - max(0, pan))
    out[i:i + len(sig), 1] += sig * (1 + min(0, pan))

def env(n, a=0.005, d=0.2):
    t = np.arange(n) / SR
    return np.minimum(1, t / a) * np.exp(-t / d)

def tone(f, dur, a=0.005, d=0.2, harm=(1, .35, .15)):
    n = int(SR * dur); t = np.arange(n) / SR
    s = sum(h * np.sin(2 * np.pi * f * (k + 1) * t) for k, h in enumerate(harm))
    return s * env(n, a, d)

def thunk(): # tampon qui claque
    n = int(SR * .35); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * (140 * np.exp(-t * 18) + 45) * t) * np.exp(-t / .09) + rng.normal(0, .15, n) * np.exp(-t / .02))

def whoosh(dur=.3):
    n = int(SR * dur); t = np.arange(n) / SR
    x = rng.normal(0, 1, n)
    k = np.ones(40) / 40
    x = np.convolve(x, k, 'same') * np.sin(np.pi * t / dur) ** 2
    return x * .5

def pop(f=880): return tone(f, .25, .002, .07, (1, .2))
def ding(f): return tone(f, 1.0, .003, .35, (1, .5, .25))

# lit : pouls doux à 120 BPM + accords en notes de gamme majeure (do, mi, sol, la)
beat = 60 / BPM
notes = [261.63, 329.63, 392.0, 440.0, 392.0, 329.63]
t = 0.0; k = 0
while t < DUR - .2:
    add(t, tone(notes[k % len(notes)] / 2, beat * .9, .01, .25, (1, .3)), .09, pan=(-.2 if k % 2 else .2))
    if k % 2 == 0: add(t, tone(65.41, beat * 1.8, .01, .5, (1, .4)), .12)
    add(t + beat / 2, pop(notes[(k + 2) % len(notes)] * 2), .05)
    t += beat; k += 1

cuts = [2.4, 5.8, 9.6, 13.4, 17.4, 20.6, 23.4]
for c in cuts: add(c - .05, whoosh(.3), .35)
add(1.0, thunk(), .9)                       # +1 tampon
for t0 in (3.4, 4.2, 5.0): add(t0, thunk(), .5)   # Oubliée / Perdue / Jamais pleine
for t0 in (7.7,): add(t0, pop(1320), .35)   # Aucune appli
add(11.3, pop(1046), .4)                    # la carte arrive
for t0 in (14.7, 15.7): add(t0, pop(988), .4)     # scan, montant
add(16.0, ding(1318), .35)                  # Crédité
for t0, f in ((17.85, 784), (18.3, 880), (18.75, 988)): add(t0, thunk(), .5); add(t0, pop(f), .35)
add(18.75, ding(1568), .4); add(18.75, ding(1046), .3)   # 10e tampon
add(24.8, ding(1318), .35)                  # CTA

m = np.max(np.abs(out)); out = out / m * .85
fade = np.minimum(1, (DUR - np.arange(len(out)) / SR) / 0.6)[:, None]
out = out * fade
os.makedirs(os.path.join(os.path.dirname(__file__), 'out'), exist_ok=True)
with wave.open(os.path.join(os.path.dirname(__file__), 'out', 'audio.wav'), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((out * 32767).astype('<i2').tobytes())
print('ok')
