#!/bin/bash

echo "🔍 Testando URLs do backend..."
echo ""

# Testar diferentes URLs possíveis
URLS=(
  "https://calendario-backend.onrender.com"
  "https://calendario-de-obrigacoes.onrender.com"
)

for URL in "${URLS[@]}"; do
  echo "Testando: $URL/api/health"
  RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$URL/api/health")
  HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
  BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE")
  
  if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Backend encontrado em: $URL"
    echo "Resposta: $BODY"
    echo ""
    echo "Use esta URL para os comandos: $URL"
    break
  else
    echo "❌ Não respondeu (HTTP $HTTP_CODE)"
    echo ""
  fi
done

echo ""
echo "Se nenhuma URL funcionou, o backend pode estar:"
echo "1. Em processo de deploy (aguarde alguns minutos)"
echo "2. Offline ou com problemas"
echo "3. Em uma URL diferente (verifique no painel do Render)"

