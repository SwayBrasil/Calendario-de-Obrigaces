# 🤖 Sistema Automatizado - Agenda Tributária RFB

Este sistema busca automaticamente as informações da **Agenda Tributária** diretamente do site oficial da **Receita Federal do Brasil**, mantendo seus dados sempre atualizados.

## 🆚 Diferença dos Scripts

| Script | Fonte de Dados | Atualização | Uso Recomendado |
|--------|---------------|-------------|-----------------|
| `agenda-tributaria.js` | Dados estáticos (hardcoded) | Manual | Ambiente de desenvolvimento |
| `agenda-tributaria-scraper.js` | Receita Federal (web scraping) | Automática | Produção |

## 🚀 Instalação das Dependências

Primeiro, instale as novas dependências necessárias:

```powershell
# Navegue até a pasta backend
cd backend

# Instale as dependências
npm install
```

As novas dependências incluem:
- **puppeteer**: Para web scraping
- **cheerio**: Para parsing de HTML
- **axios**: Para requisições HTTP

## 📋 Como Usar o Sistema Automatizado

### 1. Testar Conexão

Antes de usar, teste se consegue acessar o site da Receita Federal:

```powershell
node scripts/agenda-tributaria-scraper.js testar-conexao
```

### 2. Atualizar Dados

Busque os dados mais recentes da Receita Federal:

```powershell
node scripts/agenda-tributaria-scraper.js atualizar
```

### 3. Criar Tarefas com Dados Atualizados

```powershell
# Criar tarefas de março/2024 com dados atualizados
node scripts/agenda-tributaria-scraper.js criar-mes 2024 3

# Com responsável específico
node scripts/agenda-tributaria-scraper.js criar-mes 2024 3 admin@empresa.com
```

## 🔄 Sistema de Cache e Backup

### Cache Inteligente
- Os dados são armazenados em cache por **24 horas**
- Evita buscas desnecessárias na Receita Federal
- Cache é renovado automaticamente

### Backup Local
- Dados são salvos em `backup-agenda-tributaria.json`
- Usado como fallback se a Receita Federal estiver indisponível
- Backup expira em **7 dias**

### Dados de Fallback
- Se não conseguir acessar a RFB nem o backup, usa dados estáticos
- Garante que o sistema sempre funcione

## 🎯 Funcionalidades Avançadas

### 1. Ajuste Automático de Feriados
```javascript
// O sistema busca feriados nacionais via BrasilAPI
// Ajusta automaticamente as datas de vencimento
```

### 2. Detecção Inteligente de Obrigações
```javascript
// Busca por padrões como:
// "DCTF - 15/01"
// "DIRF: 31/01"
// E extrai automaticamente
```

### 3. Prevenção de Duplicatas
```javascript
// Evita criar obrigações duplicadas
// Compara títulos por similaridade
```

## 🛠️ Comandos Disponíveis

| Comando | Descrição | Exemplo |
|---------|-----------|---------|
| `atualizar` | Busca dados atualizados da RFB | `node ... atualizar` |
| `criar-mes` | Cria tarefas de um mês específico | `node ... criar-mes 2024 3` |
| `testar-conexao` | Testa acesso à RFB e APIs | `node ... testar-conexao` |
| `limpar-cache` | Limpa cache forçando nova busca | `node ... limpar-cache` |

## 📊 Exemplo de Output

```
🔍 Buscando informações atualizadas da Receita Federal...
📅 Acessando página de calendários...
📋 Acessando página de obrigações acessórias...
🔄 Tentando APIs alternativas...
✅ Encontrados 12 feriados nacionais
💾 Backup local salvo com sucesso
✅ Agenda tributária atualizada! 12 meses processados.

=== Criando tarefas com dados atualizados - 3/2024 ===
✅ Responsável definido: João Silva (admin@empresa.com)
✅ DCTF - Declaração de Débitos e Créditos Tributários Federais - Vencimento: 15/03/2024
✅ GPS - Guia da Previdência Social (INSS) - Vencimento: 20/03/2024
✅ ECF - Escrituração Contábil Fiscal - Vencimento: 31/03/2024

🎉 Concluído! 5 tarefas criadas para 3/2024
📧 Responsável: João Silva (admin@empresa.com)
🔄 Dados atualizados da Receita Federal
```

## 🔧 Automação com Task Scheduler

Para automatizar completamente, configure uma tarefa no Windows:

### 1. Criar Script de Automação

```powershell
# Criar arquivo: automatizar-agenda.ps1
cd C:\Users\mathe\prc\backend
node scripts/agenda-tributaria-scraper.js criar-mes 2024 $(Get-Date).Month
```

### 2. Configurar Task Scheduler

1. Abrir **Task Scheduler**
2. **Create Basic Task**
3. **Name**: "Agenda Tributária Automática"
4. **Trigger**: Monthly (todo dia 25)
5. **Action**: Start a Program
6. **Program**: `powershell.exe`
7. **Arguments**: `-File C:\Users\mathe\prc\automatizar-agenda.ps1`

## 🚨 Tratamento de Erros

### Cenários Previstos:

1. **Site da RFB indisponível** → Usa backup local
2. **Backup desatualizado** → Usa dados de fallback
3. **Sem internet** → Usa dados estáticos
4. **Parsing falhou** → Log de erro + fallback
5. **Database indisponível** → Erro detalhado

### Logs Detalhados:
```
✅ Sucesso
⚠️ Warning (continua funcionando)
❌ Erro (para execução)
🔍 Informativo
🔄 Em progresso
```

## 📝 Personalização

### Adicionar Novas Fontes:
```javascript
const RFB_URLS = {
  calendarioFiscal: 'https://...',
  novaFonte: 'https://...'  // Adicionar aqui
};
```

### Modificar Padrões de Busca:
```javascript
// Em buscarAgendaTributariaRFB()
const matches = texto.match(/SEU_NOVO_PADRAO/g);
```

## 🔐 Segurança

- **Rate Limiting**: Delay entre requests
- **User Agent**: Simula navegador real
- **Timeout**: Evita travamento
- **Sanitização**: Limpa dados extraídos

## 📞 Troubleshooting

### Erro: "Cannot find module 'puppeteer'"
```powershell
npm install puppeteer cheerio axios
```

### Erro: "Connection timeout"
```powershell
node scripts/agenda-tributaria-scraper.js testar-conexao
```

### Dados não encontrados:
```powershell
# Força nova busca
node scripts/agenda-tributaria-scraper.js limpar-cache
node scripts/agenda-tributaria-scraper.js atualizar
```

## 🚀 Próximos Passos

1. **Integrar com API REST** do seu sistema
2. **Notificações por email** quando dados forem atualizados
3. **Dashboard** mostrando status das atualizações
4. **Webhooks** para sistemas externos
5. **Machine Learning** para detectar novos padrões

---

## 💡 Dicas Importantes

- **Execute primeiro** em ambiente de teste
- **Verifique logs** regularmente
- **Mantenha backup** dos dados estáticos
- **Monitor conexão** com RFB
- **Teste após mudanças** no site da RFB

**🎯 O sistema está pronto para produção, mas sempre teste primeiro!**
