/**
 * 本地存储封装
 */

const PREFIX = 'smarttavern_';

export const storage = {
  get(key, defaultValue = null) {
    try {
      const value = localStorage.getItem(PREFIX + key);
      return value ? JSON.parse(value) : defaultValue;
    } catch {
      return defaultValue;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  remove(key) {
    localStorage.removeItem(PREFIX + key);
  },

  clear() {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  },
};

export default storage;
