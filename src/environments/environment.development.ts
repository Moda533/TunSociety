const useDirectLocalApi =
  typeof window !== 'undefined' &&
  window.location.hostname === 'localhost';

export const environment = {
  production: false,
  apiBaseUrl: useDirectLocalApi ? 'http://localhost:5000/api' : '/api'
};
