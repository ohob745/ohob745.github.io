/* Naafi3 — protected tester dashboard.
 *
 * The token lives in sessionStorage only (gone when the tab closes) and every
 * request is authorised again by the API. This file renders data and never
 * decides access: a forged page state still gets 401/403 from the server.
 */
(function () {
  "use strict";

  var TOKEN_KEY = "naafi3.admin.token";
  var PAGE_SIZE = 25;
  var AUTH_TIMEOUT = 90000;

  var STATUS_LABELS = {
    pending: "بانتظار المراجعة",
    invited: "أُرسلت الدعوة",
    joined: "انضم إلى الاختبار",
    completed: "أكمل الاختبار",
    withdrawn: "انسحب",
  };

  var STAT_LABELS = [
    ["total", "الإجمالي"],
    ["pending", "بانتظار المراجعة"],
    ["invited", "أُرسلت الدعوة"],
    ["joined", "انضم"],
    ["completed", "أكمل"],
    ["withdrawn", "انسحب"],
  ];

  var state = {
    token: "",
    profile: null,
    q: "",
    status: "",
    offset: 0,
    total: 0,
    items: [],
    editing: null,
    deleting: null,
    listSeq: 0,
  };

  function $(id) {
    return document.getElementById(id);
  }

  var loginPanel = $("login-panel");
  var dashboard = $("dashboard");
  var loginForm = $("login-form");
  var loginMessage = $("login-message");
  var loginButton = $("login-button");
  var loginLabel = $("login-label");
  var loginSpinner = $("login-spinner");
  var whoLabel = $("who");
  var logoutButton = $("logout-button");
  var dashboardMessage = $("dashboard-message");
  var statsGrid = $("stats-grid");
  var searchInput = $("search-input");
  var searchForm = $("search-form");
  var statusFilter = $("status-filter");
  var refreshButton = $("refresh-button");
  var tableBody = $("testers-body");
  var tableCaption = $("table-caption");
  var pagerInfo = $("pager-info");
  var prevButton = $("prev-button");
  var nextButton = $("next-button");
  var exportEmails = $("export-emails");
  var exportDetailed = $("export-detailed");
  var editDialog = $("edit-dialog");
  var editForm = $("edit-form");
  var editEmail = $("edit-email");
  var editStatus = $("edit-status");
  var editNotes = $("edit-notes");
  var editSave = $("edit-save");
  var editCancel = $("edit-cancel");
  var deleteDialog = $("delete-dialog");
  var deleteEmail = $("delete-email");
  var deleteConfirm = $("delete-confirm");
  var deleteCancel = $("delete-cancel");

  /* ---------------------------------------------------------------- helpers */

  function alertBox(element, text, kind) {
    element.textContent = text || "";
    element.className = text ? "alert alert-" + (kind || "info") : "alert";
    if (text) {
      element.setAttribute("role", kind === "error" ? "alert" : "status");
    } else {
      element.removeAttribute("role");
    }
  }

  function formatDate(value) {
    if (!value) {
      return "—";
    }
    var parsed = new Date(value);
    if (isNaN(parsed.getTime())) {
      return value;
    }
    try {
      return new Intl.DateTimeFormat("ar", {
        dateStyle: "medium",
        timeStyle: "short",
        numberingSystem: "latn",
        calendar: "gregory",
      }).format(parsed);
    } catch (error) {
      return parsed.toISOString().slice(0, 16).replace("T", " ");
    }
  }

  function messageFor(error) {
    if (!error) {
      return "حدث خطأ غير متوقع. حاول مرة أخرى.";
    }
    if (error.status === 0) {
      return (
        error.message +
        " قد يستغرق تشغيل الخادم أول مرة حتى دقيقة، أعد المحاولة بعد قليل."
      );
    }
    if (error.status === 401) {
      return "انتهت صلاحية الجلسة أو أنها غير صالحة. سجّل الدخول مرة أخرى.";
    }
    if (error.status === 403) {
      return "هذا الحساب لا يملك صلاحية الإدارة.";
    }
    if (error.status === 422) {
      return "البيانات غير صالحة. راجع القيم ثم أعد المحاولة.";
    }
    if (error.status === 429) {
      return "عدد المحاولات كبير جدًا. انتظر قليلًا ثم أعد المحاولة.";
    }
    if (error.status >= 500) {
      return "حدث خطأ في الخادم. حاول لاحقًا.";
    }
    return error.message || "تعذر إتمام الطلب. حاول مرة أخرى.";
  }

  function api(path, options) {
    var opts = options || {};
    opts.token = state.token;
    opts.timeout = opts.timeout || AUTH_TIMEOUT;
    return window.Naafi3Api.request(path, opts);
  }

  /* ------------------------------------------------------------------- auth */

  function setSession(token, profile) {
    state.token = token;
    state.profile = profile;
    try {
      window.sessionStorage.setItem(TOKEN_KEY, token);
    } catch (error) {
      /* Private mode with storage disabled: the session simply is not kept. */
    }
  }

  function clearSession() {
    state.token = "";
    state.profile = null;
    try {
      window.sessionStorage.removeItem(TOKEN_KEY);
    } catch (error) {
      /* ignore */
    }
  }

  function showLogin(text) {
    dashboard.hidden = true;
    loginPanel.hidden = false;
    if (text) {
      alertBox(loginMessage, text, "error");
    }
    var field = $("login-email");
    if (field) {
      field.focus();
    }
  }

  function logout(text) {
    clearSession();
    state.items = [];
    state.q = "";
    state.status = "";
    state.offset = 0;
    state.total = 0;
    state.editing = null;
    state.deleting = null;
    searchInput.value = "";
    statusFilter.value = "";
    tableBody.textContent = "";
    statsGrid.textContent = "";
    alertBox(dashboardMessage, "");
    setLoginLoading(false);
    showLogin(text || "");
  }

  function setLoginLoading(loading) {
    loginButton.disabled = loading;
    loginButton.setAttribute("aria-busy", loading ? "true" : "false");
    loginSpinner.hidden = !loading;
    loginLabel.textContent = loading ? "جارٍ الدخول…" : "دخول لوحة التحكم";
  }

  function enterDashboard(profile) {
    state.profile = profile;
    whoLabel.textContent = profile && profile.name ? profile.name : "مشرف";
    whoLabel.title = profile && profile.email ? profile.email : "";
    loginPanel.hidden = true;
    dashboard.hidden = false;
    alertBox(loginMessage, "");
    alertBox(dashboardMessage, "");
    refreshAll();
  }

  async function restoreSession() {
    var token = "";
    try {
      token = window.sessionStorage.getItem(TOKEN_KEY) || "";
    } catch (error) {
      token = "";
    }
    if (!token) {
      showLogin("");
      return;
    }

    state.token = token;
    setLoginLoading(true);
    try {
      var profile = await api("/auth/me");
      if (!profile || profile.role !== "admin") {
        logout("هذا الحساب لا يملك صلاحية الإدارة.");
        return;
      }
      setLoginLoading(false);
      enterDashboard(profile);
    } catch (error) {
      setLoginLoading(false);
      clearSession();
      showLogin(
        error && error.status === 401
          ? ""
          : "تعذر التحقق من الجلسة. " + messageFor(error)
      );
    }
  }

  loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    alertBox(loginMessage, "");

    var emailInput = $("login-email");
    var passwordInput = $("login-password");
    emailInput.setCustomValidity(
      emailInput.validity.valueMissing
        ? "أدخل بريدك الإلكتروني."
        : emailInput.validity.typeMismatch
          ? "أدخل بريدًا إلكترونيًا صحيحًا."
          : ""
    );
    passwordInput.setCustomValidity(
      passwordInput.validity.valueMissing ? "أدخل كلمة المرور." : ""
    );
    if (!loginForm.checkValidity()) {
      loginForm.reportValidity();
      return;
    }

    setLoginLoading(true);
    try {
      var result = await window.Naafi3Api.request("/auth/login", {
        method: "POST",
        body: {
          email: $("login-email").value.trim(),
          password: $("login-password").value,
        },
        timeout: AUTH_TIMEOUT,
      });

      if (!result || !result.access_token) {
        throw new Error("استجابة غير متوقعة من الخادم.");
      }
      if (!result.profile || result.profile.role !== "admin") {
        alertBox(loginMessage, "هذا الحساب لا يملك صلاحية الإدارة.", "error");
        setLoginLoading(false);
        return;
      }

      setSession(result.access_token, result.profile);
      loginForm.reset();
      setLoginLoading(false);
      enterDashboard(result.profile);
    } catch (error) {
      setLoginLoading(false);
      alertBox(
        loginMessage,
        error && error.status === 401
          ? "بيانات الدخول غير صحيحة."
          : messageFor(error),
        "error"
      );
    }
  });

  logoutButton.addEventListener("click", function () {
    logout("");
  });

  /* ------------------------------------------------------------------- data */

  function renderStats(stats) {
    statsGrid.textContent = "";
    STAT_LABELS.forEach(function (pair) {
      var key = pair[0];
      var card = document.createElement("div");
      card.className = "stat";

      var label = document.createElement("div");
      label.className = "stat-label";
      label.textContent = pair[1];

      var value = document.createElement("div");
      value.className = "stat-value";
      value.textContent = stats && typeof stats[key] === "number" ? stats[key] : "0";

      card.appendChild(label);
      card.appendChild(value);
      statsGrid.appendChild(card);
    });
  }

  function badge(status) {
    var span = document.createElement("span");
    span.className = "badge badge-" + (STATUS_LABELS[status] ? status : "pending");
    span.textContent = STATUS_LABELS[status] || status;
    return span;
  }

  function actionButton(label, kind, handler) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm " + kind;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function renderRows() {
    tableBody.textContent = "";

    if (!state.items.length) {
      var empty = document.createElement("tr");
      empty.className = "empty-row";
      var cell = document.createElement("td");
      cell.colSpan = 6;
      cell.textContent = state.q || state.status
        ? "لا توجد نتائج مطابقة للبحث أو التصفية."
        : "لا توجد تسجيلات بعد.";
      empty.appendChild(cell);
      tableBody.appendChild(empty);
      return;
    }

    state.items.forEach(function (item) {
      var row = document.createElement("tr");

      var email = document.createElement("td");
      email.className = "email";
      email.textContent = item.email;

      var name = document.createElement("td");
      name.textContent = item.tester_name || "—";

      var date = document.createElement("td");
      date.textContent = formatDate(item.registration_date);

      var status = document.createElement("td");
      status.appendChild(badge(item.status));

      var notes = document.createElement("td");
      var notesPreview = document.createElement("span");
      notesPreview.className = "notes-preview";
      notesPreview.textContent = item.notes || "—";
      if (item.notes) {
        notesPreview.title = item.notes;
      }
      notes.appendChild(notesPreview);

      var actions = document.createElement("td");
      var group = document.createElement("div");
      group.className = "row-actions";
      group.appendChild(
        actionButton("تعديل", "btn-ghost", function () {
          openEdit(item);
        })
      );
      group.appendChild(
        actionButton("حذف", "btn-ghost", function () {
          openDelete(item);
        })
      );
      actions.appendChild(group);

      row.appendChild(email);
      row.appendChild(name);
      row.appendChild(date);
      row.appendChild(status);
      row.appendChild(notes);
      row.appendChild(actions);
      tableBody.appendChild(row);
    });
  }

  function renderPager() {
    var from = state.total ? state.offset + 1 : 0;
    var to = Math.min(state.offset + PAGE_SIZE, state.total);
    pagerInfo.textContent =
      state.total === 0
        ? "لا توجد سجلات"
        : "عرض " + from + "–" + to + " من " + state.total;
    prevButton.disabled = state.offset <= 0;
    nextButton.disabled = state.offset + PAGE_SIZE >= state.total;
  }

  function renderCaption() {
    var bits = ["التوقيت المحلي لجهازك"];
    if (state.status) {
      bits.push("الحالة: " + (STATUS_LABELS[state.status] || state.status));
    }
    if (state.q) {
      bits.push("بحث: «" + state.q + "»");
    }
    tableCaption.textContent = bits.join(" · ");
  }

  function setDashboardBusy(busy) {
    dashboard.setAttribute("aria-busy", busy ? "true" : "false");
    refreshButton.disabled = busy;
    prevButton.disabled = busy || state.offset <= 0;
    nextButton.disabled =
      busy || state.offset + PAGE_SIZE >= state.total;
    exportEmails.disabled = busy;
    exportDetailed.disabled = busy;
  }

  async function loadStats() {
    try {
      var stats = await api("/admin/testers/stats");
      renderStats(stats);
    } catch (error) {
      if (error && (error.status === 401 || error.status === 403)) {
        logout(messageFor(error));
        return;
      }
      alertBox(dashboardMessage, messageFor(error), "error");
    }
  }

  async function loadList() {
    var seq = ++state.listSeq;
    var params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(state.offset));
    if (state.q) {
      params.set("q", state.q);
    }
    if (state.status) {
      params.set("status", state.status);
    }

    var data = await api("/admin/testers?" + params.toString());
    if (seq !== state.listSeq) {
      return;
    }
    state.items = (data && data.items) || [];
    state.total = (data && typeof data.total === "number") ? data.total : 0;

    // A page can become empty after a delete: step back to the last page.
    if (!state.items.length && state.offset > 0 && state.total > 0) {
      state.offset = Math.max(
        0,
        Math.floor((state.total - 1) / PAGE_SIZE) * PAGE_SIZE
      );
      return loadList();
    }

    renderRows();
    renderPager();
    renderCaption();
  }

  async function refreshAll() {
    setDashboardBusy(true);
    try {
      await loadList();
      await loadStats();
    } catch (error) {
      if (error && (error.status === 401 || error.status === 403)) {
        logout(messageFor(error));
        return;
      }
      alertBox(dashboardMessage, messageFor(error), "error");
    } finally {
      setDashboardBusy(false);
    }
  }

  refreshButton.addEventListener("click", function () {
    alertBox(dashboardMessage, "");
    refreshAll();
  });

  var searchTimer = 0;
  searchInput.addEventListener("input", function () {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(function () {
      state.q = searchInput.value.trim();
      state.offset = 0;
      refreshAll();
    }, 350);
  });

  searchForm.addEventListener("submit", function (event) {
    event.preventDefault();
    window.clearTimeout(searchTimer);
    state.q = searchInput.value.trim();
    state.offset = 0;
    refreshAll();
  });

  statusFilter.addEventListener("change", function () {
    state.status = statusFilter.value;
    state.offset = 0;
    refreshAll();
  });

  prevButton.addEventListener("click", function () {
    state.offset = Math.max(0, state.offset - PAGE_SIZE);
    refreshAll();
  });

  nextButton.addEventListener("click", function () {
    state.offset += PAGE_SIZE;
    refreshAll();
  });

  /* --------------------------------------------------------------- exporting */

  function exportPath(base) {
    return state.status
      ? base + "?status=" + encodeURIComponent(state.status)
      : base;
  }

  async function download(button, base, fallbackName) {
    var original = button.textContent;
    alertBox(dashboardMessage, "");
    button.disabled = true;
    button.textContent = "جارٍ التجهيز…";
    try {
      await window.Naafi3Api.downloadCsv(
        exportPath(base),
        state.token,
        fallbackName
      );
      alertBox(
        dashboardMessage,
        state.status
          ? "تم تنزيل ملف CSV للحالة المختارة."
          : "تم تنزيل ملف CSV لكل التسجيلات.",
        "success"
      );
    } catch (error) {
      if (error && (error.status === 401 || error.status === 403)) {
        logout(messageFor(error));
        return;
      }
      alertBox(dashboardMessage, messageFor(error), "error");
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  exportEmails.addEventListener("click", function () {
    download(exportEmails, "/admin/testers/export.csv", "naffi3-testers.csv");
  });

  exportDetailed.addEventListener("click", function () {
    download(
      exportDetailed,
      "/admin/testers/export-detailed.csv",
      "naffi3-testers-detailed.csv"
    );
  });

  /* ------------------------------------------------------------ edit dialog */

  function openEdit(item) {
    state.editing = item;
    editEmail.textContent = item.email;
    editStatus.value = item.status;
    editNotes.value = item.notes || "";
    if (typeof editDialog.showModal === "function") {
      editDialog.showModal();
    } else {
      editDialog.setAttribute("open", "");
    }
    editStatus.focus();
  }

  function closeEdit() {
    state.editing = null;
    if (typeof editDialog.close === "function") {
      editDialog.close();
    } else {
      editDialog.removeAttribute("open");
    }
  }

  editCancel.addEventListener("click", closeEdit);

  editDialog.addEventListener("close", function () {
    state.editing = null;
  });

  editForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    var item = state.editing;
    if (!item) {
      return;
    }

    editSave.disabled = true;
    editSave.setAttribute("aria-busy", "true");
    try {
      var updated = await api("/admin/testers/" + encodeURIComponent(item.id), {
        method: "PATCH",
        body: {
          status: editStatus.value,
          notes: editNotes.value,
        },
      });

      closeEdit();
      alertBox(
        dashboardMessage,
        "تم تحديث بيانات " + (updated && updated.email ? updated.email : item.email) + ".",
        "success"
      );
      await refreshAll();
    } catch (error) {
      if (error && (error.status === 401 || error.status === 403)) {
        closeEdit();
        logout(messageFor(error));
        return;
      }
      alertBox(dashboardMessage, messageFor(error), "error");
    } finally {
      editSave.disabled = false;
      editSave.setAttribute("aria-busy", "false");
    }
  });

  /* ---------------------------------------------------------- delete dialog */

  function openDelete(item) {
    state.deleting = item;
    deleteEmail.textContent = item.email;
    if (typeof deleteDialog.showModal === "function") {
      deleteDialog.showModal();
    } else {
      deleteDialog.setAttribute("open", "");
    }
    deleteCancel.focus();
  }

  function closeDelete() {
    state.deleting = null;
    if (typeof deleteDialog.close === "function") {
      deleteDialog.close();
    } else {
      deleteDialog.removeAttribute("open");
    }
  }

  deleteCancel.addEventListener("click", closeDelete);

  deleteDialog.addEventListener("close", function () {
    state.deleting = null;
  });

  deleteConfirm.addEventListener("click", async function () {
    var item = state.deleting;
    if (!item) {
      return;
    }

    deleteConfirm.disabled = true;
    deleteConfirm.setAttribute("aria-busy", "true");
    try {
      await api("/admin/testers/" + encodeURIComponent(item.id), {
        method: "DELETE",
      });
      closeDelete();
      alertBox(dashboardMessage, "تم حذف التسجيل.", "success");
      await refreshAll();
    } catch (error) {
      if (error && (error.status === 401 || error.status === 403)) {
        closeDelete();
        logout(messageFor(error));
        return;
      }
      alertBox(dashboardMessage, messageFor(error), "error");
    } finally {
      deleteConfirm.disabled = false;
      deleteConfirm.setAttribute("aria-busy", "false");
    }
  });

  /* ------------------------------------------------------------------ start */

  restoreSession();
})();
