export class AgnoUiLaunchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AgnoUiLaunchError";
    this.code = code;
  }
}

export async function launchAgnoUi({
  ensureUi,
  openWindow = (url, target) => window.open(url, target),
  windowName = "ds4-agno-agent-ui"
}) {
  const popup = openWindow("about:blank", windowName);

  if (!popup) {
    throw new AgnoUiLaunchError(
      "POPUP_BLOCKED",
      "Il browser ha bloccato l'apertura di Agno-UI."
    );
  }

  try {
    popup.opener = null;

    try {
      popup.document.title = "Avvio Agno-UI…";
      popup.document.body.textContent =
        "Avvio dell'interfaccia nativa Agno…";
    } catch {
      // about:blank may not expose a writable document in every browser.
    }

    const result = await ensureUi();

    const parsed = new URL(result.url);

    if (
      parsed.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    ) {
      throw new AgnoUiLaunchError(
        "AGNO_UI_URL_REJECTED",
        "Il server ha restituito un URL Agno-UI non locale."
      );
    }

    popup.location.replace(result.url);

    return result;
  } catch (error) {
    try {
      popup.close();
    } catch {
      // ignore close failure
    }
    throw error;
  }
}
