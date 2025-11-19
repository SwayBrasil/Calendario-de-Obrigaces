#!/bin/bash

# Script para alterar senha do Flavio Arantes
# IMPORTANTE: O backend precisa estar online no Render

# Tente estas URLs (ajuste conforme necessário):
BACKEND_URL="https://calendario-backend.onrender.com"
# Se não funcionar, tente:
# BACKEND_URL="https://calendario-de-obrigacoes.onrender.com"

ADMIN_EMAIL="carvalhovini2002@gmail.com"
ADMIN_PASSWORD="26052002@Vc"
NOVA_SENHA="novaSenha123"  # ALTERE AQUI!

echo "🔍 Verificando se o backend está online..."
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/health")

if [ "$HEALTH" != "200" ]; then
  echo "❌ Backend não está respondendo em $BACKEND_URL"
  echo ""
  echo "Possíveis causas:"
  echo "1. Backend ainda está em deploy (aguarde alguns minutos)"
  echo "2. URL incorreta - verifique no painel do Render"
  echo "3. Backend está offline"
  echo ""
  echo "Verifique no painel do Render qual é a URL correta do serviço 'calendario-backend'"
  exit 1
fi

echo "✅ Backend está online!"
echo ""

echo "🔐 Fazendo login..."
LOGIN_RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$ADMIN_EMAIL\",
    \"password\": \"$ADMIN_PASSWORD\"
  }")

echo "Resposta do login: $LOGIN_RESPONSE"
echo ""

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Erro ao obter token. Verifique as credenciais."
  exit 1
fi

echo "✅ Token obtido!"
echo ""

echo "📋 Buscando usuário Flavio Arantes..."
USUARIOS_RESPONSE=$(curl -s -X GET "$BACKEND_URL/api/admin/usuarios" \
  -H "Authorization: Bearer $TOKEN")

echo "Resposta: $USUARIOS_RESPONSE"
echo ""

# Procurar pelo email
USER_ID=$(echo "$USUARIOS_RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for user in data:
        if user.get('email') == 'flavioarantes13@yahoo.com.br':
            print(user.get('uid'))
            break
except Exception as e:
    print('', end='')
" 2>/dev/null)

if [ -z "$USER_ID" ]; then
  echo "❌ Usuário não encontrado. Listando todos:"
  echo "$USUARIOS_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$USUARIOS_RESPONSE"
  exit 1
fi

echo "✅ Usuário encontrado! UID: $USER_ID"
echo ""

echo "🔑 Alterando senha para: $NOVA_SENHA"
RESPONSE=$(curl -s -X PUT "$BACKEND_URL/api/admin/usuarios/$USER_ID/senha" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"newPassword\": \"$NOVA_SENHA\"
  }")

echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
echo ""
echo "✅ Processo concluído!"

