export const windowSessionStorage = (function () {
  // Use window.name as the unique identifier for the current window
  if (!window.name) {
    window.name = Math.random().toString(36).substring(2, 11);
  }

  return {
    setItem: function (key: string, value: string) {
      sessionStorage.setItem(window.name + key, value);
    },
    getItem: function (key: string) {
      return sessionStorage.getItem(window.name + key);
    },
    removeItem: function (key: string) {
      sessionStorage.removeItem(window.name + key);
    },
    clear: function () {
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith(window.name))
        .forEach((k) => sessionStorage.removeItem(k));
    },
  };
})();
