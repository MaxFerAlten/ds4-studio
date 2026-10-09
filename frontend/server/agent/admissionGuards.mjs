// WP2 of piano.esecutivo.integrazione.opendots.v2.md (§7): Express adapters
// that put the ingresses inventoried in docs/integration-opendots/WP2.md
// under the shared admission lease.
//
//   route(label, handler)      the handler runs under the lease and the lease
//                              is released when the handler has settled
//                              (structured/model calls: chunked analysis,
//                              web search).  A handler may return
//                              { background: promise } to keep the lease
//                              until a job started by the request ends
//                              (research).
//   childRoute(label, handler) like route(), but a callback from the local
//                              runtime joins the active run instead of
//                              competing with it (native agent ->
//                              /api/sage/exec).
//   control(label)             middleware for model/session/profile
//                              controls: busy 409 while a run is active,
//                              lease held until the response is closed.
//
// Busy and Origin refusals are answered before any byte of the route.

import { AgentAdmissionError } from "../agentAdmission.mjs";

export function createAdmissionGuards({ admission, identity }) {
  function refuse(res, error) {
    if (!res.headersSent) return res.status(error.status).json({ error: error.message, code: error.code });
    return undefined;
  }

  async function run(req, res, label, operation, { child = false } = {}) {
    identity.requireOrigin(req);
    const ownerId = identity.ownerOf(req, res);
    if (child && identity.isLocalRuntimeCallback(req)) return admission.joinActive(label, operation, { ownerId });
    return admission.exclusive(label, operation, { ownerId });
  }

  function wrap(label, handler, options) {
    if (typeof handler !== "function") throw new TypeError(`${label}: handler must be a function`);
    return async function guardedRoute(req, res, next) {
      try {
        await run(req, res, label, async (ctx) => {
          const result = await handler(req, res, next, ctx);
          if (result && typeof result === "object" && result.background) {
            await Promise.resolve(result.background).catch(() => {});
          }
          return result;
        }, options);
      } catch (error) {
        if (error instanceof AgentAdmissionError) return refuse(res, error);
        throw error;
      }
    };
  }

  return Object.freeze({
    route: (label, handler) => wrap(label, handler, { child: false }),
    childRoute: (label, handler) => wrap(label, handler, { child: true }),
    control(label) {
      return function admissionControl(req, res, next) {
        let entered = false;
        run(req, res, label, () => new Promise((resolve) => {
          entered = true;
          res.once("close", resolve);
          next();
        })).catch((error) => {
          if (error instanceof AgentAdmissionError) return refuse(res, error);
          if (!entered) return next(error);
          return undefined;
        });
      };
    },
    refuse
  });
}
