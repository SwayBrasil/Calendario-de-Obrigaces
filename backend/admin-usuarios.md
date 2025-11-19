# Guia de Gerenciamento de Usuários no Render

## Endpoints de Admin Criados

Todos os endpoints requerem autenticação como administrador.

### 1. Listar todos os usuários
```bash
GET /api/admin/usuarios
Authorization: Bearer <seu-token-admin>
```

**Resposta:**
```json
[
  {
    "uid": "uuid-do-usuario",
    "nomeCompleto": "Nome do Usuário",
    "email": "email@exemplo.com",
    "cargo": "admin",
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-01T00:00:00.000Z"
  }
]
```

### 2. Alterar senha de um usuário
```bash
PUT /api/admin/usuarios/:id/senha
Authorization: Bearer <seu-token-admin>
Content-Type: application/json

{
  "newPassword": "novaSenha123"
}
```

### 3. Alterar cargo de um usuário
```bash
PUT /api/admin/usuarios/:id/cargo
Authorization: Bearer <seu-token-admin>
Content-Type: application/json

{
  "cargo": "admin"  // ou "usuario"
}
```

### 4. Alterar email de um usuário
```bash
PUT /api/admin/usuarios/:id/email
Authorization: Bearer <seu-token-admin>
Content-Type: application/json

{
  "email": "novoemail@exemplo.com"
}
```

## Como usar via cURL

### 1. Primeiro, faça login para obter o token:
```bash
curl -X POST https://calendario-backend.onrender.com/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "seu-email-admin@exemplo.com",
    "password": "sua-senha"
  }'
```

### 2. Use o token retornado para acessar os endpoints:

**Listar usuários:**
```bash
curl -X GET https://calendario-backend.onrender.com/api/admin/usuarios \
  -H "Authorization: Bearer SEU_TOKEN_AQUI"
```

**Alterar senha:**
```bash
curl -X PUT https://calendario-backend.onrender.com/api/admin/usuarios/USER_ID_AQUI/senha \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -H "Content-Type: application/json" \
  -d '{"newPassword": "novaSenha123"}'
```

**Alterar cargo:**
```bash
curl -X PUT https://calendario-backend.onrender.com/api/admin/usuarios/USER_ID_AQUI/cargo \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -H "Content-Type: application/json" \
  -d '{"cargo": "admin"}'
```

**Alterar email:**
```bash
curl -X PUT https://calendario-backend.onrender.com/api/admin/usuarios/USER_ID_AQUI/email \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -H "Content-Type: application/json" \
  -d '{"email": "novoemail@exemplo.com"}'
```

## Usando Postman ou Insomnia

1. Faça login em `/api/login` para obter o token
2. Configure o header `Authorization: Bearer <token>` em todas as requisições
3. Use os endpoints acima

## Exemplo de Script Node.js

```javascript
const axios = require('axios');

const BASE_URL = 'https://calendario-backend.onrender.com';
let adminToken = '';

// 1. Login
async function login(email, password) {
  const response = await axios.post(`${BASE_URL}/api/login`, {
    email,
    password
  });
  adminToken = response.data.token;
  console.log('Login realizado! Token:', adminToken);
  return adminToken;
}

// 2. Listar usuários
async function listarUsuarios() {
  const response = await axios.get(`${BASE_URL}/api/admin/usuarios`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  return response.data;
}

// 3. Alterar senha
async function alterarSenha(userId, newPassword) {
  const response = await axios.put(
    `${BASE_URL}/api/admin/usuarios/${userId}/senha`,
    { newPassword },
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );
  return response.data;
}

// Exemplo de uso
(async () => {
  await login('admin@exemplo.com', 'senha123');
  const usuarios = await listarUsuarios();
  console.log('Usuários:', usuarios);
  
  // Alterar senha do primeiro usuário
  if (usuarios.length > 0) {
    await alterarSenha(usuarios[0].uid, 'novaSenha123');
    console.log('Senha alterada!');
  }
})();
```

## Notas Importantes

- Todos os endpoints requerem autenticação como administrador
- O token expira quando você faz logout
- As alterações são feitas diretamente no banco SQLite em `/var/data/pcp.db`
- O banco está em um volume persistente no Render, então as alterações são mantidas

