var brapi = browser;

(function() {
  if (window.top !== window) return;
  if (!document.documentElement || !/^(https?|file):$/.test(location.protocol)) return;

  const ROOT_ID = "read-aloud-floating-widget-root";
  const STORAGE_KEY = "floatingWidgetState";
  const EDGE_MARGIN = 16;
  const BALL_SIZE = 56;
  const MIN_PANEL_WIDTH = 320;
  const MIN_PANEL_HEIGHT = 280;
  const DEFAULT_STATE = {
    side: "right",
    top: 120,
    width: 420,
    height: 560,
    panelTop: 80,
    panelLeft: null,
    open: false
  };

  let tabId;
  let state = Object.assign({}, DEFAULT_STATE);
  let root;
  let shadow;
  let ball;
  let panel;
  let iframe;
  let saveTimer = null;
  let suppressBallClick = false;

  init().catch(function(err) {
    console.error("Read Aloud floating widget failed to initialize", err);
  });

  async function init() {
    tabId = await getSenderTabId();
    if (typeof tabId !== "number") return;

    const stored = await brapi.storage.local.get([STORAGE_KEY]);
    state = normalizeState(stored[STORAGE_KEY]);

    mount();
    bindEvents();
    applyState();
    window.addEventListener("resize", onViewportResize, {passive: true});
  }

  function getSenderTabId() {
    return new Promise(function(fulfill, reject) {
      brapi.runtime.sendMessage({method: "getSenderTabId", args: []}, function(res) {
        if (brapi.runtime.lastError) reject(new Error(brapi.runtime.lastError.message));
        else if (res && res.error) reject(new Error(res.error));
        else fulfill(res);
      });
    });
  }

  function normalizeState(items) {
    const nextState = Object.assign({}, DEFAULT_STATE, items || {});
    nextState.side = nextState.side == "left" ? "left" : "right";
    nextState.top = numberOr(nextState.top, DEFAULT_STATE.top);
    nextState.width = numberOr(nextState.width, DEFAULT_STATE.width);
    nextState.height = numberOr(nextState.height, DEFAULT_STATE.height);
    nextState.panelTop = numberOr(nextState.panelTop, DEFAULT_STATE.panelTop);
    nextState.panelLeft = nextState.panelLeft == null ? null : numberOr(nextState.panelLeft, DEFAULT_STATE.panelLeft);
    nextState.open = Boolean(nextState.open);
    return nextState;
  }

  function numberOr(value, fallback) {
    return typeof value == "number" && !Number.isNaN(value) ? value : fallback;
  }

  function mount() {
    if (document.getElementById(ROOT_ID)) return;

    root = document.createElement("div");
    root.id = ROOT_ID;
    root.style.all = "initial";
    root.style.position = "fixed";
    root.style.top = "0";
    root.style.left = "0";
    root.style.zIndex = "2147483647";

    shadow = root.attachShadow({mode: "open"});

    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = brapi.runtime.getURL("css/floating-widget.css");
    shadow.appendChild(stylesheet);

    const wrapper = document.createElement("div");
    wrapper.className = "ra-widget";
    wrapper.innerHTML = [
      '<button class="ra-ball" type="button" title="Read Aloud">',
      '  <img class="ra-ball-icon" alt="Read Aloud" src="' + brapi.runtime.getURL("img/icon-48.png") + '"/>',
      "</button>",
      '<section class="ra-panel" aria-label="Read Aloud floating panel">',
      '  <header class="ra-panel-header">',
      '    <span class="ra-panel-title">Read Aloud</span>',
      '    <div class="ra-panel-actions">',
      '      <button class="ra-panel-button" type="button" data-action="minimize" aria-label="Minimize">-</button>',
      '      <button class="ra-panel-button" type="button" data-action="close" aria-label="Close">x</button>',
      "    </div>",
      "  </header>",
      '  <div class="ra-panel-body">',
      "    <iframe class=\"ra-panel-frame\" allow=\"clipboard-read; clipboard-write\"></iframe>",
      "  </div>",
      '  <div class="ra-resize-handle ra-resize-n" data-resize="n"></div>',
      '  <div class="ra-resize-handle ra-resize-e" data-resize="e"></div>',
      '  <div class="ra-resize-handle ra-resize-s" data-resize="s"></div>',
      '  <div class="ra-resize-handle ra-resize-w" data-resize="w"></div>',
      '  <div class="ra-resize-handle ra-resize-ne" data-resize="ne"></div>',
      '  <div class="ra-resize-handle ra-resize-se" data-resize="se"></div>',
      '  <div class="ra-resize-handle ra-resize-sw" data-resize="sw"></div>',
      '  <div class="ra-resize-handle ra-resize-nw" data-resize="nw"></div>',
      "</section>"
    ].join("");
    shadow.appendChild(wrapper);

    ball = shadow.querySelector(".ra-ball");
    panel = shadow.querySelector(".ra-panel");
    iframe = shadow.querySelector(".ra-panel-frame");
    iframe.src = brapi.runtime.getURL("popup.html?embedded=1&tab=" + encodeURIComponent(String(tabId)));

    document.documentElement.appendChild(root);
  }

  function bindEvents() {
    ball.addEventListener("click", function() {
      if (suppressBallClick) return;
      state.open = !state.open;
      if (state.open && state.panelLeft == null) setDefaultPanelPosition();
      applyState();
      saveState();
    });

    shadow.querySelectorAll(".ra-panel-button").forEach(function(button) {
      button.addEventListener("click", function() {
        state.open = false;
        applyState();
        saveState();
      });
    });

    enableBallDragging(ball);
    enablePanelDragging(shadow.querySelector(".ra-panel-header"));
    shadow.querySelectorAll(".ra-resize-handle").forEach(function(handle) {
      enablePanelResize(handle, handle.dataset.resize);
    });
  }

  function applyState() {
    constrainState();

    ball.style.top = state.top + "px";
    ball.style.left = state.side == "left" ? EDGE_MARGIN + "px" : "";
    ball.style.right = state.side == "right" ? EDGE_MARGIN + "px" : "";

    panel.hidden = !state.open;
    panel.classList.toggle("is-open", state.open);
    if (!state.open) return;

    if (state.panelLeft == null) setDefaultPanelPosition();
    constrainState();

    panel.style.width = state.width + "px";
    panel.style.height = state.height + "px";
    panel.style.top = state.panelTop + "px";
    panel.style.left = state.panelLeft + "px";
  }

  function setDefaultPanelPosition() {
    state.width = clamp(state.width, MIN_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, window.innerWidth - EDGE_MARGIN * 2));
    state.height = clamp(state.height, MIN_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, window.innerHeight - EDGE_MARGIN * 2));
    state.panelTop = clamp(state.top - 24, EDGE_MARGIN, window.innerHeight - state.height - EDGE_MARGIN);
    state.panelLeft = state.side == "left"
      ? EDGE_MARGIN
      : window.innerWidth - state.width - EDGE_MARGIN;
  }

  function constrainState() {
    state.top = clamp(state.top, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerHeight - BALL_SIZE - EDGE_MARGIN));
    state.width = clamp(state.width, MIN_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, window.innerWidth - EDGE_MARGIN * 2));
    state.height = clamp(state.height, MIN_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, window.innerHeight - EDGE_MARGIN * 2));

    if (state.panelLeft != null) {
      state.panelLeft = clamp(state.panelLeft, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerWidth - state.width - EDGE_MARGIN));
    }
    state.panelTop = clamp(state.panelTop, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerHeight - state.height - EDGE_MARGIN));
  }

  function onViewportResize() {
    applyState();
    saveState();
  }

  function enableBallDragging(handle) {
    handle.addEventListener("mousedown", function(event) {
      if (event.button !== 0) return;
      event.preventDefault();

      const startY = event.clientY;
      const startTop = state.top;
      let moved = false;

      const onMove = function(moveEvent) {
        const dy = moveEvent.clientY - startY;
        if (Math.abs(dy) > 3 || moveEvent.clientX < window.innerWidth / 3 || moveEvent.clientX > window.innerWidth * 2 / 3) {
          moved = true;
        }
        state.top = clamp(startTop + dy, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerHeight - BALL_SIZE - EDGE_MARGIN));
        state.side = moveEvent.clientX < window.innerWidth / 2 ? "left" : "right";
        applyState();
      };

      const onUp = function() {
        teardown();
        if (moved) {
          suppressBallClick = true;
          setTimeout(function() {
            suppressBallClick = false;
          }, 0);
          if (state.open && state.panelLeft != null) {
            state.panelLeft = state.side == "left"
              ? Math.min(state.panelLeft, EDGE_MARGIN)
              : Math.max(state.panelLeft, window.innerWidth - state.width - EDGE_MARGIN);
          }
          applyState();
          saveState();
        }
      };

      const teardown = bindPointerSession(onMove, onUp);
    });
  }

  function enablePanelDragging(handle) {
    handle.addEventListener("mousedown", function(event) {
      if (event.button !== 0) return;
      if (event.target.closest(".ra-panel-button")) return;
      event.preventDefault();

      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = state.panelLeft;
      const startTop = state.panelTop;

      const onMove = function(moveEvent) {
        state.panelLeft = startLeft + (moveEvent.clientX - startX);
        state.panelTop = startTop + (moveEvent.clientY - startY);
        constrainState();
        applyState();
      };

      const onUp = function() {
        teardown();
        snapPanelToEdge();
        applyState();
        saveState();
      };

      const teardown = bindPointerSession(onMove, onUp);
    });
  }

  function enablePanelResize(handle, direction) {
    handle.addEventListener("mousedown", function(event) {
      if (event.button !== 0) return;
      event.preventDefault();

      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = state.width;
      const startHeight = state.height;
      const startLeft = state.panelLeft;
      const startTop = state.panelTop;

      const onMove = function(moveEvent) {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        let width = startWidth;
        let height = startHeight;
        let left = startLeft;
        let top = startTop;

        if (direction.indexOf("e") >= 0) {
          width = startWidth + dx;
        }
        if (direction.indexOf("s") >= 0) {
          height = startHeight + dy;
        }
        if (direction.indexOf("w") >= 0) {
          left = startLeft + dx;
          width = startWidth - dx;
        }
        if (direction.indexOf("n") >= 0) {
          top = startTop + dy;
          height = startHeight - dy;
        }

        if (width < MIN_PANEL_WIDTH) {
          if (direction.indexOf("w") >= 0) left -= MIN_PANEL_WIDTH - width;
          width = MIN_PANEL_WIDTH;
        }
        if (height < MIN_PANEL_HEIGHT) {
          if (direction.indexOf("n") >= 0) top -= MIN_PANEL_HEIGHT - height;
          height = MIN_PANEL_HEIGHT;
        }

        width = Math.min(width, window.innerWidth - EDGE_MARGIN * 2);
        height = Math.min(height, window.innerHeight - EDGE_MARGIN * 2);
        left = clamp(left, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN));
        top = clamp(top, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN));

        state.width = width;
        state.height = height;
        state.panelLeft = left;
        state.panelTop = top;
        applyState();
      };

      const onUp = function() {
        teardown();
        snapPanelToEdge();
        applyState();
        saveState();
      };

      const teardown = bindPointerSession(onMove, onUp);
    });
  }

  function bindPointerSession(onMove, onUp) {
    const handleMove = function(event) {
      onMove(event);
    };
    const handleUp = function() {
      document.removeEventListener("mousemove", handleMove, true);
      document.removeEventListener("mouseup", handleUp, true);
      onUp();
    };

    document.addEventListener("mousemove", handleMove, true);
    document.addEventListener("mouseup", handleUp, true);

    return function teardown() {
      document.removeEventListener("mousemove", handleMove, true);
      document.removeEventListener("mouseup", handleUp, true);
    };
  }

  function snapPanelToEdge() {
    const distanceToLeft = Math.abs(state.panelLeft - EDGE_MARGIN);
    const distanceToRight = Math.abs((window.innerWidth - EDGE_MARGIN) - (state.panelLeft + state.width));
    if (distanceToLeft <= 32 || distanceToRight <= 32) {
      if (distanceToLeft <= distanceToRight) {
        state.side = "left";
        state.panelLeft = EDGE_MARGIN;
      } else {
        state.side = "right";
        state.panelLeft = window.innerWidth - state.width - EDGE_MARGIN;
      }
    } else {
      state.side = state.panelLeft + state.width / 2 < window.innerWidth / 2 ? "left" : "right";
    }
  }

  function saveState() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function() {
      saveTimer = null;
      brapi.storage.local.set({
        floatingWidgetState: {
          side: state.side,
          top: state.top,
          width: state.width,
          height: state.height,
          panelTop: state.panelTop,
          panelLeft: state.panelLeft,
          open: state.open
        }
      });
    }, 120);
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
})();
