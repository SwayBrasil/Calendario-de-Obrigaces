# ⚠️ IMPORTANTE: Backend precisa estar online

## Problema Atual

O backend está retornando "Not Found", o que significa que:
1. **O backend ainda não foi deployado** com as novas alterações
2. **O backend está offline** ou em processo de deploy
3. **A URL está incorreta**

## Solução

### 1. Verifique no Painel do Render

1. Acesse: https://dashboard.render.com
2. Encontre o serviço `calendario-backend`
3. Verifique:
   - Status (deve estar "Live")
   - URL do serviço (pode ser diferente de `calendario-backend.onrender.com`)
   - Se há algum erro no deploy

### 2. Aguarde o Deploy

Se você acabou de fazer push, o Render pode levar alguns minutos para:
- Detectar as mudanças
- Fazer o build
- Fazer o deploy

**Tempo estimado: 2-5 minutos**

### 3. Verifique se o Deploy Funcionou

Depois que o deploy terminar, teste:

```bash
curl https://SUA_URL_BACKEND.onrender.com/api/health
```

Deve retornar:
```json
{
  "status": "OK",
  "message": "Servidor funcionando corretamente",
  "timestamp": "..."
}
```

### 4. Use a URL Correta

Depois que identificar a URL correta do backend, use nos comandos:

```bash
# Exemplo com URL correta
BACKEND_URL="https://calendario-backend-xxxx.onrender.com"

# Login
TOKEN=$(curl -s -X POST "$BACKEND_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"carvalhovini2002@gmail.com","password":"26052002@Vc"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# Listar usuários
curl -X GET "$BACKEND_URL/api/admin/usuarios" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

## Comandos Prontos (quando backend estiver online)

Quando o backend estiver funcionando, use:

```bash
# 1. Login
TOKEN=$(curl -s -X POST https://SUA_URL_BACKEND.onrender.com/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"carvalhovini2002@gmail.com","password":"26052002@Vc"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# 2. Buscar Flavio
curl -s -X GET https://SUA_URL_BACKEND.onrender.com/api/admin/usuarios \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | grep -A 5 "flavioarantes13"

# 3. Alterar senha (substitua UID e senha)
curl -X PUT https://SUA_URL_BACKEND.onrender.com/api/admin/usuarios/UID_DO_FLAVIO/senha \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newPassword":"NOVA_SENHA_AQUI"}'
```

## Próximos Passos

1. ✅ Verifique o painel do Render
2. ✅ Aguarde o deploy terminar (se necessário)
3. ✅ Teste o endpoint `/api/health`
4. ✅ Use os comandos acima com a URL correta

