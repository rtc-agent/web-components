/**
 * Set document direction and language based on browser locale
 * This script runs early to prevent layout flash
 */
(function () {
  try {
    var lang = navigator.language || navigator.languages[0] || 'zh-CN';
    var rtlLocales = ['fa', 'ar', 'he', 'ur'];
    var isRTL = rtlLocales.some(function (rtl) {
      return lang.startsWith(rtl);
    });
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  } catch (e) {
    document.documentElement.dir = 'ltr';
  }
})();
