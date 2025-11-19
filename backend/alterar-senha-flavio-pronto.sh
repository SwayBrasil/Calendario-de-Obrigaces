#!/bin/bash

# Script para alterar senha do usuário Flavio Arantes
# Credenciais de admin já configuradas

ADMIN_EMAIL="carvalhovini2002@gmail.com"
ADMIN_PASSWORD="26052002@Vc"
BASE_URL="https://calendario-backend.onrender.com"
NOVA_SENHA="novaSenha123"  # ALTERE AQUI para a senha desejada

echo "🔐 Fazendo login como admin..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$ADMIN_EMAIL\",
    \"password\": \"$ADMIN_PASSWORD\"
  }")

TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Erro ao fazer login. Verifique as credenciais."
  echo "Resposta: $LOGIN_RESPONSE"
  exit 1
fi

echo "✅ Login realizado com sucesso!"
echo ""

echo "📋 Buscando usuário Flavio Arantes (flavioarantes13@yahoo.com.br)..."
USUARIOS_RESPONSE=$(curl -s -X GET "$BASE_URL/api/admin/usuarios" \
  -H "Authorization: Bearer $TOKEN")

# Procurar pelo email específico
USER_ID=$(echo "$USUARIOS_RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for user in data:
        if user.get('email') == 'flavioarantes13@yahoo.com.br':
            print(user.get('uid'))
            break
except:
    pass
" 2>/dev/null)

if [ -z "$USER_ID" ]; then
  echo "❌ Usuário não encontrado. Listando todos os usuários:"
  echo "$USUARIOS_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$USUARIOS_RESPONSE"
  exit 1
fi

echo "✅ Usuário encontrado! UID: $USER_ID"
echo ""

echo "🔑 Alterando senha para: $NOVA_SENHA"
ALTERAR_SENHA_RESPONSE=$(curl -s -X PUT "$BASE_URL/api/admin/usuarios/$USER_ID/senha" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"newPassword\": \"$NOVA_SENHA\"
  }")

echo "$ALTERAR_SENHA_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$ALTERAR_SENHA_RESPONSE"
echo ""
echo "✅ Processo concluído!"

