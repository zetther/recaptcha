(function () {
  "use strict";
  const script = document.currentScript;
  const base = new URL(script.src).origin;
  const widgets = new Map();
  window.ZettherCaptcha = {
    render(target, options) {
      const root =
        typeof target === "string" ? document.querySelector(target) : target;
      if (!root || !options || !options.sitekey)
        throw new Error("ZettherCaptcha requires a container and sitekey.");
      const id = crypto.randomUUID();
      const frame = document.createElement("iframe");
      frame.title = "Zetther CAPTCHA verification";
      frame.src =
        base +
        "/widget?" +
        new URLSearchParams({
          sitekey: options.sitekey,
          action: options.action || "submit",
          origin: location.origin,
          id,
        });
      frame.style.cssText =
        "border:0;width:100%;max-width:380px;height:92px;display:block;";
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
      root.appendChild(frame);
      const listener = (event) => {
        if (
          event.origin !== base ||
          event.source !== frame.contentWindow ||
          event.data?.id !== id ||
          event.data?.source !== "zetther-captcha"
        )
          return;
        if (event.data.type === "resize")
          frame.style.height =
            Math.max(92, Math.min(700, Number(event.data.height) || 92)) + "px";
        if (event.data.type === "success") options.callback?.(event.data.token);
        if (event.data.type === "expired") options.onExpire?.();
        if (event.data.type === "error") options.onError?.(event.data.error);
      };
      window.addEventListener("message", listener);
      widgets.set(id, { frame, listener });
      return id;
    },
    reset(id) {
      widgets
        .get(id)
        ?.frame.contentWindow.postMessage(
          { source: "zetther-captcha", type: "reset", id },
          base,
        );
    },
    remove(id) {
      const widget = widgets.get(id);
      if (widget) {
        window.removeEventListener("message", widget.listener);
        widget.frame.remove();
        widgets.delete(id);
      }
    },
  };
})();
