// Stateful synthetic feedback endpoint for the Android journey. It accepts
// only the fixture bearer and the three existing client wire operations.
// No rating list is exposed: the app can read only its own target state.
const METHODS = new Map([
  ['/functions/v1/feedback', 'PUT'],
  ['/functions/v1/feedback/delete', 'POST'],
  ['/functions/v1/feedback/read', 'POST'],
]);
const SECRET = 'Bearer kudy-synthetic-feedback-secret';

export function createFeedbackHandler() {
  const ratings = new Map();
  const mutations = new Map();
  const reply = (response, status, body) => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  const targetKey = (target) => {
    if (target?.kind === 'guide' && typeof target.route_id === 'string' &&
        typeof target.version === 'string' && typeof target.locale === 'string') {
      return `guide:${target.route_id}:${target.version}:${target.locale}`;
    }
    if (target?.kind === 'place' && typeof target.place_id === 'string' &&
        typeof target.content_version === 'string' && typeof target.locale === 'string') {
      return `place:${target.place_id}:${target.content_version}:${target.locale}`;
    }
    return null;
  };
  return (request, response, path) => {
    if (!METHODS.has(path)) return false;
    if (request.method !== METHODS.get(path)) {
      reply(response, 404, { error: 'not_found' });
      return true;
    }
    if (request.headers.authorization !== SECRET) {
      reply(response, 401, { error: 'unknown_device' });
      return true;
    }
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      if (size > 16_384) return;
      size += chunk.length;
      if (size > 16_384) {
        reply(response, 413, { error: 'body_too_large' });
      } else chunks.push(chunk);
    });
    request.on('end', () => {
      if (size > 16_384) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { reply(response, 422, { error: 'invalid_request' }); return; }
      const key = targetKey(body?.target);
      if (key === null) { reply(response, 422, { error: 'invalid_target' }); return; }
      const current = ratings.get(key) ?? { revision: 0, score: null, reason_codes: [], deleted: true };
      if (path.endsWith('/read')) {
        reply(response, 200, current);
        return;
      }
      if (typeof body.mutation_id !== 'string' || !Number.isInteger(body.expected_revision)) {
        reply(response, 422, { error: 'invalid_request' }); return;
      }
      const prior = mutations.get(body.mutation_id);
      if (prior) { reply(response, 200, prior); return; }
      if (body.expected_revision !== current.revision) {
        reply(response, 409, { error: 'revision_conflict' }); return;
      }
      const revision = current.revision + 1;
      if (path.endsWith('/delete')) {
        const result = { revision, deleted: true };
        ratings.set(key, { revision, score: null, reason_codes: [], deleted: true });
        mutations.set(body.mutation_id, result);
        reply(response, 200, result);
        return;
      }
      if (!Number.isInteger(body.score) || body.score < 1 || body.score > 5 ||
          !Array.isArray(body.reason_codes) || typeof body.disclosure_version !== 'string') {
        reply(response, 422, { error: 'invalid_request' }); return;
      }
      const result = { revision, saved: true };
      ratings.set(key, { revision, score: body.score, reason_codes: body.reason_codes, deleted: false });
      mutations.set(body.mutation_id, result);
      reply(response, 200, result);
    });
    return true;
  };
}
