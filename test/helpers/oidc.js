// Faux fournisseur OIDC (Google / Apple) : clés RSA pour les id_token, clé EC pour le secret client Apple.
import { generateKeyPairSync, sign } from 'node:crypto';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

export function makeProvider() {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }); // clé d'un faussaire
  const jwk = { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });

  /** id_token signé. `claims` complète/écrase les valeurs par défaut ; `opts` choisit clé, kid et algorithme. */
  function idToken(claims, { key = rsa.privateKey, kid = 'k1', alg = 'RS256' } = {}) {
    const head = b64({ alg, kid, typ: 'JWT' });
    const body = b64(claims);
    if (alg === 'none') return `${head}.${body}.`;
    const sig = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key);
    return `${head}.${body}.${sig.toString('base64url')}`;
  }

  return {
    jwk, idToken, forgerKey: other.privateKey,
    apple: {
      teamId: 'TEAM123456', keyId: 'KEY1234567', clientId: 'dev.tony.aitools.web',
      privateKey: ec.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      publicKey: ec.publicKey,
    },
  };
}
