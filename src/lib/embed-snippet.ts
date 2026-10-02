// The WordPress embed code: the form iframe plus the small script that passes
// ad ids into the form, forwards Meta Pixel events, reports each browser
// Purchase back to Protohub (Tracking Hub, 2 Oct 2026), and redirects to the
// thank-you page. Shared by Embed Form and Tracking Hub so both produce the
// same code. Lifted from App.tsx unchanged apart from the report.

const API_BASE = ((import.meta as any).env?.VITE_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

export function buildEmbedSnippet(url: string, title: string, beaconUrl: string = `${API_BASE}/api/public/tracking/browser-event`) {
  return `<iframe
  id="ordo-order-embed"
  src="${url}"
  width="100%"
  height="800"
  frameborder="0"
  scrolling="no"
  style="border: none; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;"
  title="${title}"
></iframe>
<script>
  (function() {
    var iframe = document.getElementById("ordo-order-embed");
    if (!iframe) return;

    // Forward ad/UTM params from this page into the iframe so orders
    // are correctly attributed to Facebook / TikTok / etc. Use set()
    // instead of appending so the landing page's creative/ad id wins.
    var trackingKeys = ["utm_source","utm_medium","utm_campaign","utm_content","utm_term","utm_id","ad_id","adset_id","campaign_id","creative_id","fbclid","gclid","gbraid","wbraid","ttclid","msclkid","tracking_mode","meta_pixel_id","meta_tracking_key","meta_test","meta_test_mode","meta_test_event_code","test_event_code"];
    var pageParams = new URLSearchParams(window.location.search);
    var src = iframe.getAttribute("src") || iframe.src;
    var hashIndex = src.indexOf("#");
    var beforeHash = hashIndex >= 0 ? src.slice(0, hashIndex) : src;
    var hash = hashIndex >= 0 ? src.slice(hashIndex) : "";
    var queryIndex = hash.indexOf("?");
    var hashPath = queryIndex >= 0 ? hash.slice(0, queryIndex) : hash;
    var embedParams = new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : "");
    var changed = false;
    trackingKeys.forEach(function(k) {
      var v = pageParams.get(k);
      if (v) {
        embedParams.set(k, v);
        changed = true;
      }
    });
    function readCookie(name) {
      var specials = "\\\\^$*+?.()|{}[]";
      var escaped = "";
      for (var i = 0; i < name.length; i++) {
        var ch = name.charAt(i);
        escaped += specials.indexOf(ch) >= 0 ? "\\\\" + ch : ch;
      }
      var match = document.cookie.match(new RegExp("(?:^|; )" + escaped + "=([^;]*)"));
      return match ? decodeURIComponent(match[1]) : "";
    }
    // Tracking Hub ad link: ?ph_link=<key> on the landing page picks the link.
    var phLink = pageParams.get("ph_link");
    if (phLink) { embedParams.set("meta_tracking_key", phLink); changed = true; }
    // The page the form sits on, so orders and page views show their landing page.
    if (!embedParams.get("landing_page_url")) { embedParams.set("landing_page_url", window.location.origin + window.location.pathname); changed = true; }
    var fbp = pageParams.get("_fbp") || pageParams.get("fbp") || readCookie("_fbp");
    var fbc = pageParams.get("_fbc") || pageParams.get("fbc") || readCookie("_fbc");
    if (fbp) { embedParams.set("fbp", fbp); changed = true; }
    if (fbc) { embedParams.set("fbc", fbc); changed = true; }
    if (changed) iframe.src = beforeHash + hashPath + "?" + embedParams.toString();
    function truthy(value) {
      return /^(1|true|yes|on|test|dry_run|dry-run)$/i.test(String(value || "").trim());
    }
    var metaTestEventCode = embedParams.get("meta_test_event_code") || embedParams.get("test_event_code") || "";
    var metaTestMode = truthy(embedParams.get("meta_test")) || truthy(embedParams.get("meta_test_mode")) || !!metaTestEventCode;
    var metaTrackingMode = String(embedParams.get("tracking_mode") || embedParams.get("trackingMode") || "").toLowerCase().replace(/-/g, "_");
    var appendMetaEventIdToRedirect = metaTrackingMode === "hybrid";

    // Grow to the form's content so it reads as one natural Elementor section,
    // rather than showing a second scrollbar inside the frame.
    var sentMetaEvents = {};
    var trackingBeaconUrl = ${JSON.stringify(beaconUrl)};
    var lastPurchaseEventId = "";
    function requestResize() {
      try {
        iframe.contentWindow && iframe.contentWindow.postMessage({ type: "ordo-request-resize" }, "*");
      } catch (_) {}
    }
    iframe.addEventListener("load", function() {
      requestResize();
      setTimeout(requestResize, 250);
      setTimeout(requestResize, 800);
      setTimeout(requestResize, 1800);
    });
    function redirectWithEventId(url) {
      try {
        var target = new URL(url, window.location.href);
        if (target.protocol === "http:" || target.protocol === "https:") {
          if (appendMetaEventIdToRedirect && lastPurchaseEventId) {
            target.searchParams.set("ordo_event_id", lastPurchaseEventId);
          }
          window.location.href = target.toString();
        }
      } catch (_) {}
    }
    window.addEventListener("message", function(e) {
      if (e.data && e.data.type === "ordo-resize") {
        var nextHeight = Math.max(800, Number(e.data.height || 0) + 40);
        if (nextHeight) {
          iframe.setAttribute("height", String(nextHeight));
          iframe.style.height = nextHeight + "px";
          iframe.style.minHeight = nextHeight + "px";
        }
      }
      if (e.data && e.data.type === "ordo-meta-event" && e.data.eventName && e.data.eventId) {
        var metaKey = e.data.eventName + ":" + e.data.eventId;
        if (sentMetaEvents[metaKey]) {
          if (window.console && console.warn) console.warn("[Protohub Meta] duplicate browser event blocked", metaKey);
          return;
        }
        sentMetaEvents[metaKey] = true;
        if (metaTestMode || e.data.testMode) {
          if (window.console && console.info) {
            console.info("[Protohub Meta Test] would send browser event", {
              eventName: e.data.eventName,
              eventId: e.data.eventId,
              pixelId: e.data.pixelId || null,
              testEventCode: e.data.testEventCode || metaTestEventCode || null,
              customData: e.data.customData || {}
            });
          }
        } else if (typeof window.fbq === "function") {
          var payload = e.data.customData || {};
          var options = { eventID: e.data.eventId };
          if (e.data.pixelId && typeof window.fbq === "function") {
            // A Pixel the page has not loaded would drop the event silently: load it first.
            var ensurePixel = function(id) {
              try {
                var state = window.fbq.getState && window.fbq.getState();
                var known = ((state && state.pixels) || []).some(function(p) { return p && String(p.id) === String(id); });
                if (!known) window.fbq("init", id);
              } catch (_) {}
            };
            ensurePixel(e.data.pixelId);
            window.fbq("trackSingle", e.data.pixelId, e.data.eventName, payload, options);
            // Tracking Hub "Also send to" Pixels: same event, same id, so each Pixel counts it once.
            (e.data.extraPixelIds || []).forEach(function(extraId) {
              if (!extraId || extraId === e.data.pixelId) return;
              ensurePixel(extraId);
              window.fbq("trackSingle", extraId, e.data.eventName, payload, options);
            });
          } else {
            window.fbq("track", e.data.eventName, payload, options);
          }
        }
        if (e.data.eventName === "Purchase") {
          lastPurchaseEventId = e.data.eventId;
          // Tell Protohub this browser Purchase fired (Tracking Hub), with the
          // Pixel ids this page has loaded, so a missing or doubled Pixel shows.
          if (!(metaTestMode || e.data.testMode) && typeof window.fbq === "function" && trackingBeaconUrl) {
            var loadedPixels = [];
            try {
              var fbState = window.fbq.getState && window.fbq.getState();
              ((fbState && fbState.pixels) || []).forEach(function(p) { if (p && p.id) loadedPixels.push(String(p.id)); });
            } catch (_) {}
            var beacon = JSON.stringify({
              orderId: String((e.data.customData || {}).order_id || ""),
              eventId: e.data.eventId,
              eventName: "Purchase",
              pixelId: e.data.pixelId || null,
              pageUrl: window.location.href,
              pixelsOnPage: loadedPixels
            });
            try {
              if (navigator.sendBeacon) navigator.sendBeacon(trackingBeaconUrl, new Blob([beacon], { type: "text/plain" }));
              else fetch(trackingBeaconUrl, { method: "POST", body: beacon, keepalive: true, headers: { "Content-Type": "text/plain" } });
            } catch (_) {}
          }
        }
      }
      if (e.data && e.data.type === "ordo-redirect" && e.data.url) {
        redirectWithEventId(e.data.url);
      }
    });
    setTimeout(requestResize, 400);
    setTimeout(requestResize, 1200);
    setTimeout(requestResize, 2500);
  })();
</script>`;
}
