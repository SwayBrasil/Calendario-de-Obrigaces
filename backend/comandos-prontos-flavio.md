# Comandos cURL Prontos - Alterar Senha do Flavio Arantes

## ⚠️ IMPORTANTE: Altere a senha desejada no comando!

---

## Opção 1: Comandos Separados (Recomendado)

### Passo 1: Fazer login e obter token

```bash
curl -X POST https://calendario-backend.onrender.com/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "carvalhovini2002@gmail.com",
    "password": "26052002@Vc"
  }'
```

**Copie o `token` da resposta!**

---

### Passo 2: Listar usuários para encontrar o UID do Flavio

```bash
curl -X GET https://calendario-backend.onrender.com/api/admin/usuarios \
  -H "Authorization: Bearer SEU_TOKEN_AQUI"
```

**Procure por:**
- Nome: Flavio Arantes
- Email: flavioarantes13@yahoo.com.br
- **Copie o `uid`**

---

### Passo 3: Alterar a senha

**Substitua:**
- `SEU_TOKEN_AQUI` = token do Passo 1
- `UID_DO_FLAVIO` = uid encontrado no Passo 2
- `NOVA_SENHA_AQUI` = **senha desejada (mínimo 6 caracteres)**

```bash
curl -X PUT https://calendario-backend.onrender.com/api/admin/usuarios/UID_DO_FLAVIO/senha \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -H "Content-Type: application/json" \
  -d '{
    "newPassword": "NOVA_SENHA_AQUI"
  }'
```

---

## Opção 2: Tudo em um comando (Automático)

**⚠️ ALTERE `NOVA_SENHA_AQUI` para a senha desejada!**

```bash
# 1. Login e obter token
TOKEN=$(curl -s -X POST https://calendario-backend.onrender.com/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"carvalhovini2002@gmail.com","password":"26052002@Vc"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# 2. Buscar UID do Flavio
FLAVIO_UID=$(curl -s -X GET https://calendario-backend.onrender.com/api/admin/usuarios \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for user in data:
        if user.get('email') == 'flavioarantes13@yahoo.com.br':
            print(user.get('uid'))
            break
except:
    pass
")

# 3. Alterar senha (ALTERE A SENHA AQUI!)
curl -X PUT https://calendario-backend.onrender.com/api/admin/usuarios/$FLAVIO_UID/senha \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newPassword":"NOVA_SENHA_AQUI"}'
```

---

## Exemplo Prático Completo

```bash
# 1. Login
TOKEN=$(curl -s -X POST https://calendario-backend.onrender.com/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"carvalhovini2002@gmail.com","password":"26052002@Vc"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)

echo "Token obtido: $TOKEN"
echo ""

# 2. Listar todos os usuários (para ver o Flavio)
echo "Listando usuários..."
curl -s -X GET https://calendario-backend.onrender.com/api/admin/usuarios \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo ""
echo "Copie o UID do Flavio Arantes e use no próximo comando"
echo ""

# 3. Alterar senha (SUBSTITUA UID_DO_FLAVIO e NOVA_SENHA)
# curl -X PUT https://calendario-backend.onrender.com/api/admin/usuarios/UID_DO_FLAVIO/senha \
#   -H "Authorization: Bearer $TOKEN" \
#   -H "Content-Type: application/json" \
#   -d '{"newPassword":"NOVA_SENHA"}'
```

---

## Script Shell Pronto

Use o arquivo `alterar-senha-flavio-pronto.sh`:

1. Edite o arquivo e altere `NOVA_SENHA="novaSenha123"` para a senha desejada
2. Execute: `bash alterar-senha-flavio-pronto.sh`

