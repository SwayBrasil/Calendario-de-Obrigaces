// Utilitário para gerenciar tokens em desenvolvimento
export const createMockToken = (uid) => {
  return `mock-token-${uid}`;
};

export const isMockToken = (token) => {
  return token && token.startsWith('mock-token-');
};

export const extractUidFromMockToken = (token) => {
  if (isMockToken(token)) {
    return token.split('-')[2];
  }
  return null;
};

export const validateToken = (token) => {
  if (!token) return false;
  
  // Aceita tokens mock ou tokens Firebase
  return isMockToken(token) || token.length > 20;
};
