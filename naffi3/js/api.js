/* Naafi3 — tiny fetch wrapper shared by the registration and admin pages. */
(function () {
  "use strict";

  var LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];
  var isLocal = LOCAL_HOSTS.indexOf(window.location.hostname) !== -1;
  var defaultBase = isLocal
    ? "http://127.0.0.1:8000/api/v1"
    : "https://naafi3-api.onrender.com/api/v1";

  // Set window.NAAFI3_API_BASE before this script to point at another backend.
  var base = (window.NAAFI3_API_BASE || defaultBase).replace(/\/+$/, "");

  function parseDetail(payload, fallback) {
    if (!payload) {
      return fallback;
    }
    if (typeof payload.detail === "string") {
      return payload.detail;
    }
    if (Array.isArray(payload.detail) && payload.detail.length) {
      var first = payload.detail[0];
      if (typeof first === "string") {
        return first;
      }
      if (first && typeof first.msg === "string") {
        return first.msg;
      }
    }
    if (typeof payload.message === "string") {
      return payload.message;
    }
    return fallback;
  }

  function networkError(error) {
    var aborted = error && error.name === "AbortError";
    var failure = new Error(
      aborted
        ? "انتهت مهلة الاتصال بالخادم. حاول مرة أخرى."
        : "تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت ثم أعد المحاولة."
    );
    failure.status = 0;
    return failure;
  }

  function httpError(response, payload) {
    var failure = new Error(parseDetail(payload, "حدث خطأ غير متوقع. حاول مرة أخرى."));
    failure.status = response.status;
    failure.payload = payload;
    return failure;
  }

  async function readJson(response) {
    var text = await response.text();
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  }

  /**
   * Perform an API request.
   *
   * @param {string} path      Path below /api/v1, e.g. "/testers/register".
   * @param {object} [options] method, body, token, timeout, raw.
   * @returns {Promise<object|null|Response>} Parsed JSON, or the Response when raw.
   */
  async function request(path, options) {
    var opts = options || {};
    var controller = new AbortController();
    var timer = window.setTimeout(function () {
      controller.abort();
    }, opts.timeout || 60000);

    var headers = { Accept: opts.raw ? "*/*" : "application/json" };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (opts.token) {
      headers.Authorization = "Bearer " + opts.token;
    }

    var response;
    try {
      response = await fetch(base + path, {
        method: opts.method || "GET",
        headers: headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });
    } catch (error) {
      throw networkError(error);
    } finally {
      window.clearTimeout(timer);
    }

    if (opts.raw) {
      if (!response.ok) {
        throw httpError(response, await readJson(response));
      }
      return response;
    }

    var payload = await readJson(response);
    if (!response.ok) {
      throw httpError(response, payload);
    }
    return payload;
  }

  function downloadName(response, fallback) {
    var disposition = response.headers.get("content-disposition") || "";
    var match = /filename="?([^";]+)"?/i.exec(disposition);
    return match ? match[1] : fallback;
  }

  async function downloadCsv(path, token, fallbackName) {
    var response = await request(path, { raw: true, token: token, timeout: 60000 });
    var blob = await response.blob();
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = downloadName(response, fallbackName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 2000);
  }

  window.Naafi3Api = {
    base: base,
    request: request,
    downloadCsv: downloadCsv,
  };
})();
