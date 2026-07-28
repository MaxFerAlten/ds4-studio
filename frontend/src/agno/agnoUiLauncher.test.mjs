import test from "node:test";
import assert from "node:assert/strict";
import { launchAgnoUi, AgnoUiLaunchError } from "./agnoUiLauncher.mjs";

test("launchAgnoUi opens about:blank before await", async () => {
  const events = [];
  const fakePopup = {
    opener: "parent",
    document: { title: "", body: { textContent: "" } },
    location: { replace(url) { events.push(`location.replace:${url}`); } },
    close() { events.push("close"); }
  };

  const result = await launchAgnoUi({
    ensureUi: async () => {
      events.push("ensure.start");
      await Promise.resolve();
      events.push("ensure.end");
      return { url: "http://127.0.0.1:3000" };
    },
    openWindow: (url, target) => {
      events.push(`window.open:${url}:${target}`);
      return fakePopup;
    },
    windowName: "test-window"
  });

  assert.deepEqual(events, [
    "window.open:about:blank:test-window",
    "ensure.start",
    "ensure.end",
    "location.replace:http://127.0.0.1:3000"
  ]);
  assert.equal(result.url, "http://127.0.0.1:3000");
});

test("uses stable window name", async () => {
  let called = false;
  await launchAgnoUi({
    ensureUi: async () => ({ url: "http://127.0.0.1:3000" }),
    openWindow: (url, target) => {
      called = true;
      assert.equal(target, "ds4-agno-agent-ui");
      return { opener: "parent", document: { title: "", body: { textContent: "" } }, location: { replace() {} }, close() {} };
    }
  });
  assert.equal(called, true);
});

test("nullifies opener", async () => {
  const popup = { opener: "parent", document: { title: "", body: { textContent: "" } }, location: { replace() {} }, close() {} };
  await launchAgnoUi({
    ensureUi: async () => ({ url: "http://127.0.0.1:3000" }),
    openWindow: () => popup
  });
  assert.equal(popup.opener, null);
});

test("closes popup if ensure fails", async () => {
  let closed = false;
  const fakePopup = {
    opener: "parent",
    document: { title: "", body: { textContent: "" } },
    location: { replace() {} },
    close() { closed = true; }
  };

  await assert.rejects(
    () => launchAgnoUi({
      ensureUi: async () => { throw new Error("server error"); },
      openWindow: () => fakePopup
    }),
    { message: "server error" }
  );
  assert.equal(closed, true);
});

test("closes popup if URL is remote", async () => {
  let closed = false;
  const fakePopup = {
    opener: "parent",
    document: { title: "", body: { textContent: "" } },
    location: { replace() {} },
    close() { closed = true; }
  };

  await assert.rejects(
    () => launchAgnoUi({
      ensureUi: async () => ({ url: "https://remote.example" }),
      openWindow: () => fakePopup
    }),
    { code: "AGNO_UI_URL_REJECTED" }
  );
  assert.equal(closed, true);
});

test("throws POPUP_BLOCKED if window.open returns null", async () => {
  let ensureCalled = false;
  await assert.rejects(
    () => launchAgnoUi({
      ensureUi: async () => {
        ensureCalled = true;
        return { url: "http://127.0.0.1:3000" };
      },
      openWindow: () => null
    }),
    { code: "POPUP_BLOCKED" }
  );
  assert.equal(ensureCalled, false);
});

test("propagates POPUP_BLOCKED error", async () => {
  let caught;
  try {
    await launchAgnoUi({
      ensureUi: async () => ({ url: "http://127.0.0.1:3000" }),
      openWindow: () => null
    });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof AgnoUiLaunchError);
  assert.equal(caught.code, "POPUP_BLOCKED");
});

test("accepts localhost URL", async () => {
  const result = await launchAgnoUi({
    ensureUi: async () => ({ url: "http://localhost:3000" }),
    openWindow: () => ({
      opener: "parent",
      document: { title: "", body: { textContent: "" } },
      location: { replace() {} },
      close() {}
    })
  });
  assert.equal(result.url, "http://localhost:3000");
});

test("accepts 127.0.0.1 URL", async () => {
  const result = await launchAgnoUi({
    ensureUi: async () => ({ url: "http://127.0.0.1:3000" }),
    openWindow: () => ({
      opener: "parent",
      document: { title: "", body: { textContent: "" } },
      location: { replace() {} },
      close() {}
    })
  });
  assert.equal(result.url, "http://127.0.0.1:3000");
});

test("rejects https URL", async () => {
  const fakePopup = {
    opener: "parent",
    document: { title: "", body: { textContent: "" } },
    location: { replace() {} },
    close() {}
  };
  await assert.rejects(
    () => launchAgnoUi({
      ensureUi: async () => ({ url: "https://127.0.0.1:3000" }),
      openWindow: () => fakePopup
    }),
    { code: "AGNO_UI_URL_REJECTED" }
  );
});

test("rejects non-loopback IP URL", async () => {
  const fakePopup = {
    opener: "parent",
    document: { title: "", body: { textContent: "" } },
    location: { replace() {} },
    close() {}
  };
  await assert.rejects(
    () => launchAgnoUi({
      ensureUi: async () => ({ url: "http://192.168.1.10:3000" }),
      openWindow: () => fakePopup
    }),
    { code: "AGNO_UI_URL_REJECTED" }
  );
});
