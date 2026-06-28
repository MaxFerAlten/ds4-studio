function headroomMessage(enabled) {
  return `Headroom compression ${enabled ? "enabled" : "disabled"}.`;
}

export function headroomStatusPayload(config = {}) {
  const enabled = Boolean(config?.toolBlobs?.compressEnabled);
  return {
    ok: true,
    enabled,
    message: headroomMessage(enabled)
  };
}

export function createHeadroomHandlers({ getConfig, saveConfig }) {
  if (typeof getConfig !== "function") {
    throw new TypeError("getConfig is required");
  }
  if (typeof saveConfig !== "function") {
    throw new TypeError("saveConfig is required");
  }

  return {
    status(_req, res) {
      res.json(headroomStatusPayload(getConfig()));
    },

    async set(req, res) {
      const enabled = req.body?.enabled;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ ok: false, error: "enabled must be boolean" });
      }

      const current = getConfig() || {};
      const next = {
        ...current,
        toolBlobs: {
          ...(current.toolBlobs || {}),
          compressEnabled: enabled
        }
      };
      const saved = await saveConfig(next);
      res.json(headroomStatusPayload(saved));
    }
  };
}
