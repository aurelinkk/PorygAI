/**
 * Durcissement HTTP : en-têtes de sécurité (helmet), limitation de débit,
 * et protection CSRF par vérification d'origine.
 */
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { forbidden } from '../lib/http-errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  // En-têtes : CSP stricte (pas d'inline), pas de framing, pas de sniffing MIME…
  // La CSP ne compte qu'en production, quand l'API sert le front compilé.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false, // inutile ici, et bloquerait les polices externes
  });

  // Limite globale large ; la route de login a sa propre limite serrée (auth.routes.ts).
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

  // Anti-CSRF : les navigateurs envoient Sec-Fetch-Site et/ou Origin sur toute
  // requête mutante. Combiné au cookie SameSite=Strict, une page tierce ne peut
  // pas déclencher d'action avec la session de l'utilisateur.
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;

    const site = request.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') {
      throw forbidden('Requête inter-site refusée');
    }

    const origin = request.headers.origin;
    if (origin) {
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        throw forbidden('Origine invalide');
      }
      if (originHost !== request.headers.host) throw forbidden('Origine inattendue');
    }
  });
}
