/* Naafi3 — public registration form. */
(function () {
  "use strict";

  var form = document.getElementById("register-form");
  var emailInput = document.getElementById("email");
  var consentInput = document.getElementById("consent");
  var submitButton = document.getElementById("submit-button");
  var submitLabel = document.getElementById("submit-label");
  var spinner = document.getElementById("submit-spinner");
  var message = document.getElementById("form-message");
  var formPanel = document.getElementById("form-panel");
  var successPanel = document.getElementById("success-panel");
  var successText = document.getElementById("success-text");

  var SUCCESS_FALLBACK =
    "تم تسجيل بريدك الإلكتروني بنجاح. ستصلك تعليمات المشاركة في الاختبار عند تجهيز رابط الانضمام.";

  // The browser's own validation bubble follows the browser language. Replace
  // it with Arabic text (and reset it once the value is valid again).
  function validateForm() {
    emailInput.setCustomValidity(
      emailInput.validity.valueMissing
        ? "أدخل بريدك الإلكتروني."
        : emailInput.validity.typeMismatch
          ? "أدخل بريدًا إلكترونيًا صحيحًا مثل name@example.com."
          : ""
    );
    consentInput.setCustomValidity(
      consentInput.checked ? "" : "يجب الموافقة على تخزين البريد قبل التسجيل."
    );
    return form.checkValidity();
  }

  function clearMessage() {
    message.textContent = "";
    message.className = "alert";
  }

  function showError(text) {
    message.textContent = text;
    message.className = "alert alert-error";
    message.setAttribute("role", "alert");
  }

  function setLoading(loading) {
    submitButton.disabled = loading;
    submitButton.setAttribute("aria-busy", loading ? "true" : "false");
    spinner.hidden = !loading;
    submitLabel.textContent = loading ? "جارٍ التسجيل…" : "التسجيل للاختبار";
  }

  function showSuccess(text) {
    successText.textContent = text || SUCCESS_FALLBACK;
    formPanel.hidden = true;
    successPanel.hidden = false;
    successPanel.focus();
  }

  function errorMessage(error) {
    if (!error) {
      return "حدث خطأ غير متوقع. حاول مرة أخرى.";
    }
    if (error.status === 0) {
      // Render's free tier sleeps; the first request can take a minute.
      return (
        error.message +
        " قد يستغرق تشغيل الخادم أول مرة حتى دقيقة، أعد المحاولة بعد قليل."
      );
    }
    if (error.status === 422) {
      return "تحقق من صحة البريد الإلكتروني ثم أعد المحاولة.";
    }
    if (error.status === 429) {
      return error.message || "عدد المحاولات كبير جدًا. انتظر قليلًا ثم أعد المحاولة.";
    }
    if (error.status === 413) {
      return "البيانات المرسلة كبيرة جدًا.";
    }
    if (error.status >= 500) {
      return "حدث خطأ في الخادم. حاول لاحقًا.";
    }
    return error.message || "تعذر إتمام التسجيل. حاول مرة أخرى.";
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    clearMessage();

    if (!validateForm()) {
      form.reportValidity();
      return;
    }

    var payload = {
      email: document.getElementById("email").value.trim(),
      tester_name: document.getElementById("tester-name").value.trim() || null,
      consent: document.getElementById("consent").checked,
      website: document.getElementById("website").value,
    };

    setLoading(true);
    try {
      var result = await window.Naafi3Api.request("/testers/register", {
        method: "POST",
        body: payload,
        timeout: 90000,
      });
      showSuccess(result && result.detail);
    } catch (error) {
      showError(errorMessage(error));
      setLoading(false);
      return;
    }
    setLoading(false);
  });
})();
