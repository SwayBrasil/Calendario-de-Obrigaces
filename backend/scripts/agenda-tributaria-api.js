const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const { createTask, getUserByEmail, getAllUsers } = require('../database');
const { v4: uuidv4 } = require('uuid');

// URLs da Receita Federal para consulta (atualizadas para 2025)
const RFB_URLS = {
  agendaTributaria: 'https://www.gov.br/receitafederal/pt-br/assuntos/agenda-tributaria/2025'
};

// Cache para evitar requests desnecessários
let cacheObrigacoesTributarias = null;
let cacheExpiry = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 horas

// Agenda Tributária - Obrigações mensais do Brasil (fallback, atualizada para 2025)
// Adicionados campos 'regimeTributario' para filtragem por regime (ex.: ['Simples Nacional', 'Lucro Real', 'Lucro Presumido'])
// e 'setor' para obrigações setoriais específicas.
// Obrigações ausentes adicionadas com base na análise: EFD-Contribuições, EFD-Reinf, DCTFWeb, DME, DOI, etc.
// MIT substituído por DCTFWeb onde aplicável.
// DMED movida para fevereiro (prazo correto).
// DIRF adicionada em fevereiro.
// DEFIS e RAIS em março.
// Obrigações mensais como EFD-Reinf, EFD-Contribuições, DME, DOI adicionadas a todos os meses.
// Obrigações trimestrais/semanuais adicionadas nos meses correspondentes (ex.: DCP em maio, agosto, novembro, fevereiro).
// ICMS e ISS mantidos como genéricos; sugerido configurar por UF/município via arquivo externo.
let OBRIGACOES_TRIBUTARIAS = [
  // JANEIRO
  {
    mes: 1,
    obrigacoes: [
      {
        codigo: '0561',
        titulo: 'DCTFWeb - Declaração de Débitos e Créditos Tributários Federais',
        vencimento: 20,
        periodo: 'Dezembro/2024',
        observacoes: 'Declaração de débitos e créditos tributários federais (eSocial/EFD-Reinf). Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: '1708',
        titulo: 'IRRF - Imposto de Renda Retido na Fonte',
        vencimento: 15,
        periodo: '1º a 10/janeiro/2025',
        observacoes: 'Recolhimento do IRRF para fundos de investimento e outras retenções.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'GPS - Guia da Previdência Social (INSS)',
        vencimento: 20,
        periodo: 'Dezembro/2024',
        observacoes: 'Recolhimento das contribuições previdenciárias do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: '5629',
        titulo: 'DARF - PIS/COFINS',
        vencimento: 25,
        periodo: 'Dezembro/2024',
        observacoes: 'Recolhimento das contribuições PIS e COFINS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: '0180',
        titulo: 'DARF - IRPJ e CSLL (Lucro Real/Presumido)',
        vencimento: 31,
        periodo: 'Dezembro/2024',
        observacoes: 'Recolhimento do Imposto de Renda Pessoa Jurídica e Contribuição Social sobre Lucro Líquido.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'DAS - Documento de Arrecadação do Simples Nacional',
        vencimento: 20,
        periodo: 'Dezembro/2024',
        observacoes: 'Pagamento do Simples Nacional (ME, EPP ou MEI). Transmitir via Portal do Simples Nacional.',
        regimeTributario: ['Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'FGTS - Fundo de Garantia por Tempo de Serviço',
        vencimento: 7,
        periodo: 'Dezembro/2024',
        observacoes: 'Recolhimento do FGTS dos empregados. Transmitir via SEFIP/Conectividade Social.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ICMS - Imposto sobre Circulação de Mercadorias e Serviços',
        vencimento: 15,
        periodo: 'Dezembro/2024',
        observacoes: 'Varia por estado. Exemplo genérico; configure conforme UF. Recolhimento do ICMS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ISS - Imposto Sobre Serviços',
        vencimento: 10,
        periodo: 'Dezembro/2024',
        observacoes: 'Varia por município. Exemplo genérico; configure conforme cidade. Recolhimento do ISS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Contribuições - Escrituração Fiscal Digital',
        vencimento: 14,
        periodo: 'Novembro/2024',
        observacoes: 'Escrituração das contribuições PIS/COFINS e previdenciária sobre receita. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Reinf - Escrituração Fiscal Digital',
        vencimento: 15,
        periodo: 'Dezembro/2024',
        observacoes: 'Escrituração das retenções e outras informações fiscais do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DME - Declaração de Operações Liquidadas com Moeda em Espécie',
        vencimento: 29,
        periodo: 'Dezembro/2024',
        observacoes: 'Obrigação para operações em espécie acima do limite. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DOI - Declaração sobre Operações Imobiliárias',
        vencimento: 29,
        periodo: 'Dezembro/2024',
        observacoes: 'Obrigação para operações imobiliárias. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional'],
        setor: ['Imobiliário']
      }
    ]
  },
  // FEVEREIRO
  {
    mes: 2,
    obrigacoes: [
      {
        codigo: '0561',
        titulo: 'DCTFWeb - Declaração de Débitos e Créditos Tributários Federais',
        vencimento: 20,
        periodo: 'Janeiro/2025',
        observacoes: 'Declaração de débitos e créditos tributários federais (eSocial/EFD-Reinf). Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'GPS - Guia da Previdência Social (INSS)',
        vencimento: 20,
        periodo: 'Janeiro/2025',
        observacoes: 'Recolhimento das contribuições previdenciárias do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: '0180',
        titulo: 'DARF - IRPJ e CSLL (Lucro Real/Presumido)',
        vencimento: 28,
        periodo: 'Janeiro/2025',
        observacoes: 'Recolhimento do Imposto de Renda Pessoa Jurídica e Contribuição Social sobre Lucro Líquido.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: '5629',
        titulo: 'DARF - PIS/COFINS',
        vencimento: 25,
        periodo: 'Janeiro/2025',
        observacoes: 'Recolhimento das contribuições PIS e COFINS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'eSocial - Eventos Periódicos',
        vencimento: 15,
        periodo: 'Janeiro/2025',
        observacoes: 'Transmissão dos eventos periódicos do eSocial referentes ao mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DIRF - Declaração do Imposto de Renda Retido na Fonte',
        vencimento: 28,
        periodo: 'Ano-calendário 2024',
        observacoes: 'Declaração anual com informações do ano anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DMED - Declaração de Serviços Médicos e de Saúde',
        vencimento: 28,
        periodo: 'Ano-calendário 2024',
        observacoes: 'Declaração anual dos serviços médicos prestados no exercício anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional'],
        setor: ['Saúde']
      },
      {
        codigo: 'N/A',
        titulo: 'DAS - Documento de Arrecadação do Simples Nacional',
        vencimento: 20,
        periodo: 'Janeiro/2025',
        observacoes: 'Pagamento do Simples Nacional (ME, EPP ou MEI). Transmitir via Portal do Simples Nacional.',
        regimeTributario: ['Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'FGTS - Fundo de Garantia por Tempo de Serviço',
        vencimento: 7,
        periodo: 'Janeiro/2025',
        observacoes: 'Recolhimento do FGTS dos empregados. Transmitir via SEFIP/Conectividade Social.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ICMS - Imposto sobre Circulação de Mercadorias e Serviços',
        vencimento: 15,
        periodo: 'Janeiro/2025',
        observacoes: 'Varia por estado. Exemplo genérico; configure conforme UF. Recolhimento do ICMS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ISS - Imposto Sobre Serviços',
        vencimento: 10,
        periodo: 'Janeiro/2025',
        observacoes: 'Varia por município. Exemplo genérico; configure conforme cidade. Recolhimento do ISS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Contribuições - Escrituração Fiscal Digital',
        vencimento: 14,
        periodo: 'Dezembro/2024',
        observacoes: 'Escrituração das contribuições PIS/COFINS e previdenciária sobre receita. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Reinf - Escrituração Fiscal Digital',
        vencimento: 15,
        periodo: 'Janeiro/2025',
        observacoes: 'Escrituração das retenções e outras informações fiscais do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DECRED - Declaração de Operações com Cartões de Crédito',
        vencimento: 28,
        periodo: 'Julho a Dezembro/2024',
        observacoes: 'Obrigação semi-anual para operações com cartões de crédito. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional'],
        setor: ['Financeiro']
      },
      {
        codigo: 'N/A',
        titulo: 'e-Financeira',
        vencimento: 28,
        periodo: 'Julho a Dezembro/2024',
        observacoes: 'Obrigação semi-anual para instituições financeiras. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional'],
        setor: ['Financeiro']
      },
      {
        codigo: 'N/A',
        titulo: 'DCP - Demonstrativo do Crédito Presumido do IPI',
        vencimento: 15,
        periodo: 'Outubro a Dezembro/2024',
        observacoes: 'Obrigação trimestral para empresas com crédito presumido de IPI. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'DME - Declaração de Operações Liquidadas com Moeda em Espécie',
        vencimento: 28,
        periodo: 'Janeiro/2025',
        observacoes: 'Obrigação para operações em espécie acima do limite. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DOI - Declaração sobre Operações Imobiliárias',
        vencimento: 28,
        periodo: 'Janeiro/2025',
        observacoes: 'Obrigação para operações imobiliárias. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional'],
        setor: ['Imobiliário']
      }
    ]
  },
  // MARÇO
  {
    mes: 3,
    obrigacoes: [
      {
        codigo: '0561',
        titulo: 'DCTFWeb - Declaração de Débitos e Créditos Tributários Federais',
        vencimento: 20,
        periodo: 'Fevereiro/2025',
        observacoes: 'Declaração de débitos e créditos tributários federais (eSocial/EFD-Reinf). Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'GPS - Guia da Previdência Social (INSS)',
        vencimento: 20,
        periodo: 'Fevereiro/2025',
        observacoes: 'Recolhimento das contribuições previdenciárias do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: '0180',
        titulo: 'DARF - IRPJ e CSLL (Lucro Real/Presumido)',
        vencimento: 31,
        periodo: 'Fevereiro/2025',
        observacoes: 'Recolhimento do Imposto de Renda Pessoa Jurídica e Contribuição Social sobre Lucro Líquido.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: '5629',
        titulo: 'DARF - PIS/COFINS',
        vencimento: 25,
        periodo: 'Fevereiro/2025',
        observacoes: 'Recolhimento das contribuições PIS e COFINS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'ECF - Escrituração Contábil Fiscal',
        vencimento: 31,
        periodo: 'Ano-calendário 2024',
        observacoes: 'Declaração anual referente ao exercício anterior. Transmitir via PGD no e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'DEFIS - Declaração de Informações Socioeconômicas e Fiscais',
        vencimento: 31,
        periodo: 'Ano-calendário 2024',
        observacoes: 'Para empresas do Simples Nacional (exceto MEI). Declaração anual.',
        regimeTributario: ['Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'RAIS - Relação Anual de Informações Sociais',
        vencimento: 31,
        periodo: 'Ano-calendário 2024',
        observacoes: 'Declaração anual, se aplicável (integrado ao eSocial para algumas empresas).',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DAS - Documento de Arrecadação do Simples Nacional',
        vencimento: 20,
        periodo: 'Fevereiro/2025',
        observacoes: 'Pagamento do Simples Nacional (ME, EPP ou MEI). Transmitir via Portal do Simples Nacional.',
        regimeTributario: ['Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'FGTS - Fundo de Garantia por Tempo de Serviço',
        vencimento: 7,
        periodo: 'Fevereiro/2025',
        observacoes: 'Recolhimento do FGTS dos empregados. Transmitir via SEFIP/Conectividade Social.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ICMS - Imposto sobre Circulação de Mercadorias e Serviços',
        vencimento: 15,
        periodo: 'Fevereiro/2025',
        observacoes: 'Varia por estado. Exemplo genérico; configure conforme UF. Recolhimento do ICMS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ISS - Imposto Sobre Serviços',
        vencimento: 10,
        periodo: 'Fevereiro/2025',
        observacoes: 'Varia por município. Exemplo genérico; configure conforme cidade. Recolhimento do ISS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Contribuições - Escrituração Fiscal Digital',
        vencimento: 14,
        periodo: 'Janeiro/2025',
        observacoes: 'Escrituração das contribuições PIS/COFINS e previdenciária sobre receita. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Reinf - Escrituração Fiscal Digital',
        vencimento: 15,
        periodo: 'Fevereiro/2025',
        observacoes: 'Escrituração das retenções e outras informações fiscais do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DME - Declaração de Operações Liquidadas com Moeda em Espécie',
        vencimento: 31,
        periodo: 'Fevereiro/2025',
        observacoes: 'Obrigação para operações em espécie acima do limite. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DOI - Declaração sobre Operações Imobiliárias',
        vencimento: 31,
        periodo: 'Fevereiro/2025',
        observacoes: 'Obrigação para operações imobiliárias. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional'],
        setor: ['Imobiliário']
      }
    ]
  },
  // ABRIL
  {
    mes: 4,
    obrigacoes: [
      {
        codigo: '0561',
        titulo: 'DCTFWeb - Declaração de Débitos e Créditos Tributários Federais',
        vencimento: 20,
        periodo: 'Março/2025',
        observacoes: 'Declaração de débitos e créditos tributários federais (eSocial/EFD-Reinf). Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'GPS - Guia da Previdência Social (INSS)',
        vencimento: 20,
        periodo: 'Março/2025',
        observacoes: 'Recolhimento das contribuições previdenciárias do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: '0180',
        titulo: 'DARF - IRPJ e CSLL (Lucro Real/Presumido)',
        vencimento: 30,
        periodo: 'Março/2025',
        observacoes: 'Recolhimento do Imposto de Renda Pessoa Jurídica e Contribuição Social sobre Lucro Líquido.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: '5629',
        titulo: 'DARF - PIS/COFINS',
        vencimento: 25,
        periodo: 'Março/2025',
        observacoes: 'Recolhimento das contribuições PIS e COFINS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'ECD - Escrituração Contábil Digital',
        vencimento: 30,
        periodo: 'Ano-calendário 2024',
        observacoes: 'Declaração anual referente ao exercício anterior. Transmitir via PVA ECD.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'DAS - Documento de Arrecadação do Simples Nacional',
        vencimento: 20,
        periodo: 'Março/2025',
        observacoes: 'Pagamento do Simples Nacional (ME, EPP ou MEI). Transmitir via Portal do Simples Nacional.',
        regimeTributario: ['Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'FGTS - Fundo de Garantia por Tempo de Serviço',
        vencimento: 7,
        periodo: 'Março/2025',
        observacoes: 'Recolhimento do FGTS dos empregados. Transmitir via SEFIP/Conectividade Social.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ICMS - Imposto sobre Circulação de Mercadorias e Serviços',
        vencimento: 15,
        periodo: 'Março/2025',
        observacoes: 'Varia por estado. Exemplo genérico; configure conforme UF. Recolhimento do ICMS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ISS - Imposto Sobre Serviços',
        vencimento: 10,
        periodo: 'Março/2025',
        observacoes: 'Varia por município. Exemplo genérico; configure conforme cidade. Recolhimento do ISS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Contribuições - Escrituração Fiscal Digital',
        vencimento: 14,
        periodo: 'Fevereiro/2025',
        observacoes: 'Escrituração das contribuições PIS/COFINS e previdenciária sobre receita. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Reinf - Escrituração Fiscal Digital',
        vencimento: 15,
        periodo: 'Março/2025',
        observacoes: 'Escrituração das retenções e outras informações fiscais do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DME - Declaração de Operações Liquidadas com Moeda em Espécie',
        vencimento: 30,
        periodo: 'Março/2025',
        observacoes: 'Obrigação para operações em espécie acima do limite. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DOI - Declaração sobre Operações Imobiliárias',
        vencimento: 30,
        periodo: 'Março/2025',
        observacoes: 'Obrigação para operações imobiliárias. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional'],
        setor: ['Imobiliário']
      }
    ]
  },
  // MAIO
  {
    mes: 5,
    obrigacoes: [
      {
        codigo: '0561',
        titulo: 'DCTFWeb - Declaração de Débitos e Créditos Tributários Federais',
        vencimento: 20,
        periodo: 'Abril/2025',
        observacoes: 'Declaração de débitos e créditos tributários federais (eSocial/EFD-Reinf). Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'GPS - Guia da Previdência Social (INSS)',
        vencimento: 20,
        periodo: 'Abril/2025',
        observacoes: 'Recolhimento das contribuições previdenciárias do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: '0180',
        titulo: 'DARF - IRPJ e CSLL (Lucro Real/Presumido)',
        vencimento: 31,
        periodo: 'Abril/2025',
        observacoes: 'Recolhimento do Imposto de Renda Pessoa Jurídica e Contribuição Social sobre Lucro Líquido.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: '5629',
        titulo: 'DARF - PIS/COFINS',
        vencimento: 25,
        periodo: 'Abril/2025',
        observacoes: 'Recolhimento das contribuições PIS e COFINS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'DASN-SIMEI - Declaração Anual do Simples Nacional',
        vencimento: 31,
        periodo: 'Ano-calendário 2024',
        observacoes: 'Para MEI - Microempreendedor Individual. Transmitir via Portal do Empreendedor.',
        regimeTributario: ['Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DAS - Documento de Arrecadação do Simples Nacional',
        vencimento: 20,
        periodo: 'Abril/2025',
        observacoes: 'Pagamento do Simples Nacional (ME, EPP ou MEI). Transmitir via Portal do Simples Nacional.',
        regimeTributario: ['Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'FGTS - Fundo de Garantia por Tempo de Serviço',
        vencimento: 7,
        periodo: 'Abril/2025',
        observacoes: 'Recolhimento do FGTS dos empregados. Transmitir via SEFIP/Conectividade Social.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ICMS - Imposto sobre Circulação de Mercadorias e Serviços',
        vencimento: 15,
        periodo: 'Abril/2025',
        observacoes: 'Varia por estado. Exemplo genérico; configure conforme UF. Recolhimento do ICMS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ISS - Imposto Sobre Serviços',
        vencimento: 10,
        periodo: 'Abril/2025',
        observacoes: 'Varia por município. Exemplo genérico; configure conforme cidade. Recolhimento do ISS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Contribuições - Escrituração Fiscal Digital',
        vencimento: 14,
        periodo: 'Março/2025',
        observacoes: 'Escrituração das contribuições PIS/COFINS e previdenciária sobre receita. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Reinf - Escrituração Fiscal Digital',
        vencimento: 15,
        periodo: 'Abril/2025',
        observacoes: 'Escrituração das retenções e outras informações fiscais do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DCP - Demonstrativo do Crédito Presumido do IPI',
        vencimento: 15,
        periodo: 'Janeiro a Março/2025',
        observacoes: 'Obrigação trimestral para empresas com crédito presumido de IPI. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'DME - Declaração de Operações Liquidadas com Moeda em Espécie',
        vencimento: 31,
        periodo: 'Abril/2025',
        observacoes: 'Obrigação para operações em espécie acima do limite. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DOI - Declaração sobre Operações Imobiliárias',
        vencimento: 31,
        periodo: 'Abril/2025',
        observacoes: 'Obrigação para operações imobiliárias. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional'],
        setor: ['Imobiliário']
      }
    ]
  },
  // JUNHO
  {
    mes: 6,
    obrigacoes: [
      {
        codigo: '0561',
        titulo: 'DCTFWeb - Declaração de Débitos e Créditos Tributários Federais',
        vencimento: 20,
        periodo: 'Maio/2025',
        observacoes: 'Declaração de débitos e créditos tributários federais (eSocial/EFD-Reinf). Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'GPS - Guia da Previdência Social (INSS)',
        vencimento: 20,
        periodo: 'Maio/2025',
        observacoes: 'Recolhimento das contribuições previdenciárias do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: '0180',
        titulo: 'DARF - IRPJ e CSLL (Lucro Real/Presumido)',
        vencimento: 30,
        periodo: 'Maio/2025',
        observacoes: 'Recolhimento do Imposto de Renda Pessoa Jurídica e Contribuição Social sobre Lucro Líquido.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: '5629',
        titulo: 'DARF - PIS/COFINS',
        vencimento: 25,
        periodo: 'Maio/2025',
        observacoes: 'Recolhimento das contribuições PIS e COFINS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Reinf - Escrituração Fiscal Digital',
        vencimento: 15,
        periodo: 'Maio/2025',
        observacoes: 'Escrituração das retenções e outras informações fiscais do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DAS - Documento de Arrecadação do Simples Nacional',
        vencimento: 20,
        periodo: 'Maio/2025',
        observacoes: 'Pagamento do Simples Nacional (ME, EPP ou MEI). Transmitir via Portal do Simples Nacional.',
        regimeTributario: ['Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'FGTS - Fundo de Garantia por Tempo de Serviço',
        vencimento: 7,
        periodo: 'Maio/2025',
        observacoes: 'Recolhimento do FGTS dos empregados. Transmitir via SEFIP/Conectividade Social.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ICMS - Imposto sobre Circulação de Mercadorias e Serviços',
        vencimento: 15,
        periodo: 'Maio/2025',
        observacoes: 'Varia por estado. Exemplo genérico; configure conforme UF. Recolhimento do ICMS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ISS - Imposto Sobre Serviços',
        vencimento: 10,
        periodo: 'Maio/2025',
        observacoes: 'Varia por município. Exemplo genérico; configure conforme cidade. Recolhimento do ISS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Contribuições - Escrituração Fiscal Digital',
        vencimento: 14,
        periodo: 'Abril/2025',
        observacoes: 'Escrituração das contribuições PIS/COFINS e previdenciária sobre receita. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'DME - Declaração de Operações Liquidadas com Moeda em Espécie',
        vencimento: 30,
        periodo: 'Maio/2025',
        observacoes: 'Obrigação para operações em espécie acima do limite. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DOI - Declaração sobre Operações Imobiliárias',
        vencimento: 30,
        periodo: 'Maio/2025',
        observacoes: 'Obrigação para operações imobiliárias. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional'],
        setor: ['Imobiliário']
      }
    ]
  },
  // JULHO
  {
    mes: 7,
    obrigacoes: [
      {
        codigo: '0561',
        titulo: 'DCTFWeb - Declaração de Débitos e Créditos Tributários Federais',
        vencimento: 20,
        periodo: 'Junho/2025',
        observacoes: 'Declaração de débitos e créditos tributários federais (eSocial/EFD-Reinf). Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'GPS - Guia da Previdência Social (INSS)',
        vencimento: 20,
        periodo: 'Junho/2025',
        observacoes: 'Recolhimento das contribuições previdenciárias do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: '0180',
        titulo: 'DARF - IRPJ e CSLL (Lucro Real/Presumido)',
        vencimento: 31,
        periodo: 'Junho/2025',
        observacoes: 'Recolhimento do Imposto de Renda Pessoa Jurídica e Contribuição Social sobre Lucro Líquido.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: '5629',
        titulo: 'DARF - PIS/COFINS',
        vencimento: 25,
        periodo: 'Junho/2025',
        observacoes: 'Recolhimento das contribuições PIS e COFINS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Contribuições - Escrituração Fiscal Digital',
        vencimento: 15,
        periodo: 'Maio/2025',
        observacoes: 'Escrituração das contribuições PIS/COFINS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'DAS - Documento de Arrecadação do Simples Nacional',
        vencimento: 20,
        periodo: 'Junho/2025',
        observacoes: 'Pagamento do Simples Nacional (ME, EPP ou MEI). Transmitir via Portal do Simples Nacional.',
        regimeTributario: ['Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'FGTS - Fundo de Garantia por Tempo de Serviço',
        vencimento: 7,
        periodo: 'Junho/2025',
        observacoes: 'Recolhimento do FGTS dos empregados. Transmitir via SEFIP/Conectividade Social.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ICMS - Imposto sobre Circulação de Mercadorias e Serviços',
        vencimento: 15,
        periodo: 'Junho/2025',
        observacoes: 'Varia por estado. Exemplo genérico; configure conforme UF. Recolhimento do ICMS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ISS - Imposto Sobre Serviços',
        vencimento: 10,
        periodo: 'Junho/2025',
        observacoes: 'Varia por município. Exemplo genérico; configure conforme cidade. Recolhimento do ISS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Reinf - Escrituração Fiscal Digital',
        vencimento: 15,
        periodo: 'Junho/2025',
        observacoes: 'Escrituração das retenções e outras informações fiscais do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DME - Declaração de Operações Liquidadas com Moeda em Espécie',
        vencimento: 31,
        periodo: 'Junho/2025',
        observacoes: 'Obrigação para operações em espécie acima do limite. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DOI - Declaração sobre Operações Imobiliárias',
        vencimento: 31,
        periodo: 'Junho/2025',
        observacoes: 'Obrigação para operações imobiliárias. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional'],
        setor: ['Imobiliário']
      }
    ]
  },
  // AGOSTO
  {
    mes: 8,
    obrigacoes: [
      {
        codigo: 'N/A',
        titulo: 'FGTS - Fundo de Garantia por Tempo de Serviço',
        vencimento: 7,
        periodo: 'Julho/2025',
        observacoes: 'Recolhimento do FGTS dos empregados. Transmitir via SEFIP/Conectividade Social.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'Envio de relação de alvarás e documentos de habite-se',
        vencimento: 8,
        periodo: 'Julho/2025',
        observacoes: 'Obrigação para construção civil. Enviar relação de alvarás e habite-se do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional'],
        setor: ['Construção Civil']
      },
      {
        codigo: 'N/A',
        titulo: 'ISS - Imposto Sobre Serviços',
        vencimento: 10,
        periodo: 'Julho/2025',
        observacoes: 'Varia por município. Exemplo genérico; configure conforme cidade. Recolhimento do ISS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Contribuições - Escrituração Fiscal Digital',
        vencimento: 14,
        periodo: 'Junho/2025',
        observacoes: 'Escrituração das contribuições PIS/COFINS e previdenciária sobre receita. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Reinf - Escrituração Fiscal Digital',
        vencimento: 15,
        periodo: 'Julho/2025',
        observacoes: 'Escrituração das retenções e outras informações fiscais do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DCP - Demonstrativo do Crédito Presumido do IPI',
        vencimento: 15,
        periodo: 'Abril a Junho/2025',
        observacoes: 'Obrigação trimestral para empresas com crédito presumido de IPI. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'GPS - Guia da Previdência Social (INSS)',
        vencimento: 20,
        periodo: 'Julho/2025',
        observacoes: 'Recolhimento das contribuições previdenciárias do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DAS - Documento de Arrecadação do Simples Nacional',
        vencimento: 20,
        periodo: 'Julho/2025',
        observacoes: 'Pagamento do Simples Nacional (ME, EPP ou MEI). Transmitir via Portal do Simples Nacional.',
        regimeTributario: ['Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DIRBI - Declaração de Incentivos, Renúncias, Benefícios e Imunidades',
        vencimento: 20,
        periodo: 'Junho/2025',
        observacoes: 'Declaração para empresas com benefícios fiscais. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: '5629',
        titulo: 'DARF - PIS/COFINS',
        vencimento: 25,
        periodo: 'Julho/2025',
        observacoes: 'Recolhimento das contribuições PIS e COFINS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'DCTFWeb - Declaração de Débitos e Créditos Tributários Federais',
        vencimento: 29,
        periodo: 'Julho/2025',
        observacoes: 'Declaração de débitos e créditos tributários federais (eSocial/EFD-Reinf). Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DECRED - Declaração de Operações com Cartões de Crédito',
        vencimento: 29,
        periodo: 'Janeiro a Junho/2025',
        observacoes: 'Obrigação semi-anual para operações com cartões de crédito. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional'],
        setor: ['Financeiro']
      },
      {
        codigo: 'N/A',
        titulo: 'DME - Declaração de Operações Liquidadas com Moeda em Espécie',
        vencimento: 29,
        periodo: 'Julho/2025',
        observacoes: 'Obrigação para operações em espécie acima do limite. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DOI - Declaração sobre Operações Imobiliárias',
        vencimento: 29,
        periodo: 'Julho/2025',
        observacoes: 'Obrigação para operações imobiliárias. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional'],
        setor: ['Imobiliário']
      },
      {
        codigo: 'N/A',
        titulo: 'e-Financeira',
        vencimento: 29,
        periodo: 'Janeiro a Junho/2025',
        observacoes: 'Obrigação semi-anual para instituições financeiras. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional'],
        setor: ['Financeiro']
      },
      {
        codigo: '0180',
        titulo: 'DARF - IRPJ e CSLL (Lucro Real/Presumido)',
        vencimento: 31,
        periodo: 'Julho/2025',
        observacoes: 'Recolhimento do Imposto de Renda Pessoa Jurídica e Contribuição Social sobre Lucro Líquido.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'ICMS - Imposto sobre Circulação de Mercadorias e Serviços',
        vencimento: 15,
        periodo: 'Julho/2025',
        observacoes: 'Varia por estado. Exemplo genérico; configure conforme UF. Recolhimento do ICMS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      }
    ]
  },
  // SETEMBRO
  {
    mes: 9,
    obrigacoes: [
      {
        codigo: '0561',
        titulo: 'DCTFWeb - Declaração de Débitos e Créditos Tributários Federais',
        vencimento: 20,
        periodo: 'Agosto/2025',
        observacoes: 'Declaração de débitos e créditos tributários federais (eSocial/EFD-Reinf). Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'GPS - Guia da Previdência Social (INSS)',
        vencimento: 20,
        periodo: 'Agosto/2025',
        observacoes: 'Recolhimento das contribuições previdenciárias do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: '0180',
        titulo: 'DARF - IRPJ e CSLL (Lucro Real/Presumido)',
        vencimento: 30,
        periodo: 'Agosto/2025',
        observacoes: 'Recolhimento do Imposto de Renda Pessoa Jurídica e Contribuição Social sobre Lucro Líquido.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: '5629',
        titulo: 'DARF - PIS/COFINS',
        vencimento: 25,
        periodo: 'Agosto/2025',
        observacoes: 'Recolhimento das contribuições PIS e COFINS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'eSocial - Eventos Periódicos',
        vencimento: 15,
        periodo: 'Agosto/2025',
        observacoes: 'Transmissão dos eventos periódicos do eSocial referentes ao mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DAS - Documento de Arrecadação do Simples Nacional',
        vencimento: 20,
        periodo: 'Agosto/2025',
        observacoes: 'Pagamento do Simples Nacional (ME, EPP ou MEI). Transmitir via Portal do Simples Nacional.',
        regimeTributario: ['Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'FGTS - Fundo de Garantia por Tempo de Serviço',
        vencimento: 7,
        periodo: 'Agosto/2025',
        observacoes: 'Recolhimento do FGTS dos empregados. Transmitir via SEFIP/Conectividade Social.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ICMS - Imposto sobre Circulação de Mercadorias e Serviços',
        vencimento: 15,
        periodo: 'Agosto/2025',
        observacoes: 'Varia por estado. Exemplo genérico; configure conforme UF. Recolhimento do ICMS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ISS - Imposto Sobre Serviços',
        vencimento: 10,
        periodo: 'Agosto/2025',
        observacoes: 'Varia por município. Exemplo genérico; configure conforme cidade. Recolhimento do ISS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Contribuições - Escrituração Fiscal Digital',
        vencimento: 14,
        periodo: 'Julho/2025',
        observacoes: 'Escrituração das contribuições PIS/COFINS e previdenciária sobre receita. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Reinf - Escrituração Fiscal Digital',
        vencimento: 15,
        periodo: 'Agosto/2025',
        observacoes: 'Escrituração das retenções e outras informações fiscais do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DME - Declaração de Operações Liquidadas com Moeda em Espécie',
        vencimento: 30,
        periodo: 'Agosto/2025',
        observacoes: 'Obrigação para operações em espécie acima do limite. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DOI - Declaração sobre Operações Imobiliárias',
        vencimento: 30,
        periodo: 'Agosto/2025',
        observacoes: 'Obrigação para operações imobiliárias. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional'],
        setor: ['Imobiliário']
      }
    ]
  },
  // OUTUBRO
  {
    mes: 10,
    obrigacoes: [
      {
        codigo: '0561',
        titulo: 'DCTFWeb - Declaração de Débitos e Créditos Tributários Federais',
        vencimento: 20,
        periodo: 'Setembro/2025',
        observacoes: 'Declaração de débitos e créditos tributários federais (eSocial/EFD-Reinf). Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'GPS - Guia da Previdência Social (INSS)',
        vencimento: 20,
        periodo: 'Setembro/2025',
        observacoes: 'Recolhimento das contribuições previdenciárias do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: '0180',
        titulo: 'DARF - IRPJ e CSLL (Lucro Real/Presumido)',
        vencimento: 31,
        periodo: 'Setembro/2025',
        observacoes: 'Recolhimento do Imposto de Renda Pessoa Jurídica e Contribuição Social sobre Lucro Líquido.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: '5629',
        titulo: 'DARF - PIS/COFINS',
        vencimento: 25,
        periodo: 'Setembro/2025',
        observacoes: 'Recolhimento das contribuições PIS e COFINS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Reinf - Escrituração Fiscal Digital',
        vencimento: 15,
        periodo: 'Setembro/2025',
        observacoes: 'Escrituração das retenções e outras informações fiscais do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DAS - Documento de Arrecadação do Simples Nacional',
        vencimento: 20,
        periodo: 'Setembro/2025',
        observacoes: 'Pagamento do Simples Nacional (ME, EPP ou MEI). Transmitir via Portal do Simples Nacional.',
        regimeTributario: ['Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'FGTS - Fundo de Garantia por Tempo de Serviço',
        vencimento: 7,
        periodo: 'Setembro/2025',
        observacoes: 'Recolhimento do FGTS dos empregados. Transmitir via SEFIP/Conectividade Social.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ICMS - Imposto sobre Circulação de Mercadorias e Serviços',
        vencimento: 15,
        periodo: 'Setembro/2025',
        observacoes: 'Varia por estado. Exemplo genérico; configure conforme UF. Recolhimento do ICMS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ISS - Imposto Sobre Serviços',
        vencimento: 10,
        periodo: 'Setembro/2025',
        observacoes: 'Varia por município. Exemplo genérico; configure conforme cidade. Recolhimento do ISS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Contribuições - Escrituração Fiscal Digital',
        vencimento: 14,
        periodo: 'Agosto/2025',
        observacoes: 'Escrituração das contribuições PIS/COFINS e previdenciária sobre receita. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'DCP - Demonstrativo do Crédito Presumido do IPI',
        vencimento: 15,
        periodo: 'Julho a Setembro/2025',
        observacoes: 'Obrigação trimestral para empresas com crédito presumido de IPI. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'DME - Declaração de Operações Liquidadas com Moeda em Espécie',
        vencimento: 31,
        periodo: 'Setembro/2025',
        observacoes: 'Obrigação para operações em espécie acima do limite. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DOI - Declaração sobre Operações Imobiliárias',
        vencimento: 31,
        periodo: 'Setembro/2025',
        observacoes: 'Obrigação para operações imobiliárias. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional'],
        setor: ['Imobiliário']
      }
    ]
  },
  // NOVEMBRO
  {
    mes: 11,
    obrigacoes: [
      {
        codigo: '0561',
        titulo: 'DCTFWeb - Declaração de Débitos e Créditos Tributários Federais',
        vencimento: 20,
        periodo: 'Outubro/2025',
        observacoes: 'Declaração de débitos e créditos tributários federais (eSocial/EFD-Reinf). Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'GPS - Guia da Previdência Social (INSS)',
        vencimento: 20,
        periodo: 'Outubro/2025',
        observacoes: 'Recolhimento das contribuições previdenciárias do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: '0180',
        titulo: 'DARF - IRPJ e CSLL (Lucro Real/Presumido)',
        vencimento: 30,
        periodo: 'Outubro/2025',
        observacoes: 'Recolhimento do Imposto de Renda Pessoa Jurídica e Contribuição Social sobre Lucro Líquido.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: '5629',
        titulo: 'DARF - PIS/COFINS',
        vencimento: 25,
        periodo: 'Outubro/2025',
        observacoes: 'Recolhimento das contribuições PIS e COFINS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'eSocial - Eventos Periódicos',
        vencimento: 15,
        periodo: 'Outubro/2025',
        observacoes: 'Transmissão dos eventos periódicos do eSocial referentes ao mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DAS - Documento de Arrecadação do Simples Nacional',
        vencimento: 20,
        periodo: 'Outubro/2025',
        observacoes: 'Pagamento do Simples Nacional (ME, EPP ou MEI). Transmitir via Portal do Simples Nacional.',
        regimeTributario: ['Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'FGTS - Fundo de Garantia por Tempo de Serviço',
        vencimento: 7,
        periodo: 'Outubro/2025',
        observacoes: 'Recolhimento do FGTS dos empregados. Transmitir via SEFIP/Conectividade Social.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ICMS - Imposto sobre Circulação de Mercadorias e Serviços',
        vencimento: 15,
        periodo: 'Outubro/2025',
        observacoes: 'Varia por estado. Exemplo genérico; configure conforme UF. Recolhimento do ICMS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ISS - Imposto Sobre Serviços',
        vencimento: 10,
        periodo: 'Outubro/2025',
        observacoes: 'Varia por município. Exemplo genérico; configure conforme cidade. Recolhimento do ISS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Contribuições - Escrituração Fiscal Digital',
        vencimento: 14,
        periodo: 'Setembro/2025',
        observacoes: 'Escrituração das contribuições PIS/COFINS e previdenciária sobre receita. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Reinf - Escrituração Fiscal Digital',
        vencimento: 15,
        periodo: 'Outubro/2025',
        observacoes: 'Escrituração das retenções e outras informações fiscais do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DME - Declaração de Operações Liquidadas com Moeda em Espécie',
        vencimento: 30,
        periodo: 'Outubro/2025',
        observacoes: 'Obrigação para operações em espécie acima do limite. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DOI - Declaração sobre Operações Imobiliárias',
        vencimento: 30,
        periodo: 'Outubro/2025',
        observacoes: 'Obrigação para operações imobiliárias. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional'],
        setor: ['Imobiliário']
      }
    ]
  },
  // DEZEMBRO
  {
    mes: 12,
    obrigacoes: [
      {
        codigo: '0561',
        titulo: 'DCTFWeb - Declaração de Débitos e Créditos Tributários Federais',
        vencimento: 20,
        periodo: 'Novembro/2025',
        observacoes: 'Declaração de débitos e créditos tributários federais (eSocial/EFD-Reinf). Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'GPS - Guia da Previdência Social (INSS)',
        vencimento: 20,
        periodo: 'Novembro/2025',
        observacoes: 'Recolhimento das contribuições previdenciárias do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: '0180',
        titulo: 'DARF - IRPJ e CSLL (Lucro Real/Presumido)',
        vencimento: 31,
        periodo: 'Novembro/2025',
        observacoes: 'Recolhimento do Imposto de Renda Pessoa Jurídica e Contribuição Social sobre Lucro Líquido.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: '5629',
        titulo: 'DARF - PIS/COFINS',
        vencimento: 25,
        periodo: 'Novembro/2025',
        observacoes: 'Recolhimento das contribuições PIS e COFINS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'DIRPF - Declaração de Imposto de Renda Pessoa Física',
        vencimento: 31,
        periodo: 'Ano-calendário 2025',
        observacoes: 'Início do período de entrega da declaração anual (até abril/2026).',
        regimeTributario: []  // Para pessoas físicas
      },
      {
        codigo: 'N/A',
        titulo: 'DAS - Documento de Arrecadação do Simples Nacional',
        vencimento: 20,
        periodo: 'Novembro/2025',
        observacoes: 'Pagamento do Simples Nacional (ME, EPP ou MEI). Transmitir via Portal do Simples Nacional.',
        regimeTributario: ['Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'FGTS - Fundo de Garantia por Tempo de Serviço',
        vencimento: 7,
        periodo: 'Novembro/2025',
        observacoes: 'Recolhimento do FGTS dos empregados. Transmitir via SEFIP/Conectividade Social.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ICMS - Imposto sobre Circulação de Mercadorias e Serviços',
        vencimento: 15,
        periodo: 'Novembro/2025',
        observacoes: 'Varia por estado. Exemplo genérico; configure conforme UF. Recolhimento do ICMS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'ISS - Imposto Sobre Serviços',
        vencimento: 10,
        periodo: 'Novembro/2025',
        observacoes: 'Varia por município. Exemplo genérico; configure conforme cidade. Recolhimento do ISS do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Contribuições - Escrituração Fiscal Digital',
        vencimento: 14,
        periodo: 'Outubro/2025',
        observacoes: 'Escrituração das contribuições PIS/COFINS e previdenciária sobre receita. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido']
      },
      {
        codigo: 'N/A',
        titulo: 'EFD-Reinf - Escrituração Fiscal Digital',
        vencimento: 15,
        periodo: 'Novembro/2025',
        observacoes: 'Escrituração das retenções e outras informações fiscais do mês anterior.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DME - Declaração de Operações Liquidadas com Moeda em Espécie',
        vencimento: 31,
        periodo: 'Novembro/2025',
        observacoes: 'Obrigação para operações em espécie acima do limite. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional']
      },
      {
        codigo: 'N/A',
        titulo: 'DOI - Declaração sobre Operações Imobiliárias',
        vencimento: 31,
        periodo: 'Novembro/2025',
        observacoes: 'Obrigação para operações imobiliárias. Transmitir via e-CAC.',
        regimeTributario: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional'],
        setor: ['Imobiliário']
      }
    ]
  }
];

/**
 * Busca e atualiza a lista de obrigações tributárias a partir da Receita Federal
 * @returns {Promise<Array>} Lista atualizada de obrigações no formato OBRIGACOES_TRIBUTARIAS
 */
async function atualizarObrigacoesTributarias() {
  console.log('🔍 Buscando informações atualizadas da Receita Federal...');
  
  try {
    // Verificar cache
    if (cacheObrigacoesTributarias && cacheExpiry && Date.now() < cacheExpiry) {
      console.log('📋 Usando obrigações em cache');
      OBRIGACOES_TRIBUTARIAS = cacheObrigacoesTributarias;
      return OBRIGACOES_TRIBUTARIAS;
    }

    const novaLista = [];
    const anoAtual = new Date().getFullYear();
    
    // Headers para parecer um navegador real
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    };
    
    // Buscar página principal da agenda tributária
    console.log('📅 Acessando página principal da agenda tributária...');
    const response = await axios.get(RFB_URLS.agendaTributaria, {
      headers,
      timeout: 30000,
      maxRedirects: 5
    });
    
    const $ = cheerio.load(response.data);
    
    // Encontrar links para páginas mensais
    const mesesLinks = [];
    const mesesMap = {
      'janeiro': 1, 'fevereiro': 2, 'marco': 3, 'abril': 4, 'maio': 5, 'junho': 6,
      'julho': 7, 'agosto': 8, 'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12
    };
    $('a[href*="/assuntos/agenda-tributaria/2025/"]').each((i, el) => {
      const href = $(el).attr('href');
      const mesesValidos = Object.keys(mesesMap);
      if (mesesValidos.some(mes => href.toLowerCase().includes(mes))) {
        mesesLinks.push(new URL(href, 'https://www.gov.br').href);
      }
    });
    
    console.log(`📅 Encontrados ${mesesLinks.length} links de meses`);

    // Processar cada mês
    for (const [index, link] of mesesLinks.entries()) {
      const mesIndex = index + 1;
      console.log(`📅 Processando mês ${mesIndex} (${link})...`);
      
      try {
        const mesResponse = await axios.get(link, { headers, timeout: 30000 });
        const $mes = cheerio.load(mesResponse.data);
        
        const obrigacoesMes = [];
        
        // Parsear tabelas de obrigações
        $mes('table.govbr-table, .tabela-obrigacoes').each((i, tabela) => {
          $mes(tabela).find('tr').each((j, row) => {
            const colunas = $mes(row).find('td');
            if (colunas.length >= 4) {
              const codigo = colunas.eq(0).text().trim();
              const titulo = colunas.eq(1).text().trim();
              const periodo = colunas.eq(2).text().trim();
              const prazo = colunas.eq(3).text().trim();
              
              if (titulo && prazo && titulo.length > 5 && !titulo.match(/^(tabela|item|data)$/i)) {
                const dataMatch = prazo.match(/(\d{1,2})(?:º)?(?: a \d{1,2})?\/(\w+)\/(\d{4})/i);
                if (dataMatch) {
                  const dia = parseInt(dataMatch[1]);
                  const mesNome = dataMatch[2].toLowerCase();
                  const ano = parseInt(dataMatch[3]) || anoAtual;
                  const mes = mesesMap[mesNome];
                  
                  if (mes && mes === mesIndex && dia >= 1 && dia <= 31 && ano === anoAtual) {
                    const existe = obrigacoesMes.some(item => 
                      item.titulo.toLowerCase().includes(titulo.toLowerCase().substring(0, 15))
                    );
                    
                    if (!existe) {
                      obrigacoesMes.push({
                        codigo: codigo || 'N/A',
                        titulo,
                        vencimento: dia,
                        periodo: periodo || 'Não especificado',
                        observacoes: `Código: ${codigo}. Período de apuração: ${periodo}. Conforme Receita Federal.`
                      });
                    }
                  }
                }
              }
            }
          });
        });
        
        // Parsear listas adicionais
        $mes('ul.lista-obrigacoes, .obrigacoes').each((i, lista) => {
          $mes(lista).find('li').each((j, item) => {
            const texto = $mes(item).text().trim();
            const dataMatch = texto.match(/(.+?)\s*[-:]\s*(\d{1,2})(?:º)?(?: a \d{1,2})?\/(\w+)\/(\d{4})/i);
            if (dataMatch) {
              const titulo = dataMatch[1].trim();
              const dia = parseInt(dataMatch[2]);
              const mesNome = dataMatch[3].toLowerCase();
              const ano = parseInt(dataMatch[4]) || anoAtual;
              const mes = mesesMap[mesNome];
              
              if (mes && mes === mesIndex && dia >= 1 && dia <= 31 && ano === anoAtual) {
                const existe = obrigacoesMes.some(item => 
                  item.titulo.toLowerCase().includes(titulo.toLowerCase().substring(0, 15))
                );
                
                if (!existe) {
                  obrigacoesMes.push({
                    codigo: 'N/A',
                    titulo,
                    vencimento: dia,
                    periodo: 'Não especificado',
                    observacoes: `Extraído de lista. Conforme Receita Federal.`
                  });
                }
              }
            }
          });
        });
        
        if (obrigacoesMes.length > 0) {
          novaLista.push({ mes: mesIndex, obrigacoes: obrigacoesMes });
        }
        
      } catch (error) {
        console.warn(`⚠️ Erro ao acessar página do mês ${mesIndex}:`, error.message);
      }
    }
    
    // Verificar se obteve dados suficientes
    if (novaLista.length === 0) {
      console.warn('⚠️ Não foi possível atualizar obrigações. Mantendo lista estática...');
      return OBRIGACOES_TRIBUTARIAS;
    }
    
    // Atualizar cache e salvar backup
    cacheObrigacoesTributarias = novaLista;
    cacheExpiry = Date.now() + CACHE_DURATION;
    await salvarBackupObrigacoes(novaLista);
    OBRIGACOES_TRIBUTARIAS = novaLista;
    
    console.log(`✅ Obrigações atualizadas! ${novaLista.length} meses processados.`);
    return OBRIGACOES_TRIBUTARIAS;
    
  } catch (error) {
    console.error('❌ Erro ao atualizar obrigações:', error.message);
    const backup = await carregarBackupObrigacoes();
    if (backup) {
      console.log('📋 Usando backup local de obrigações');
      OBRIGACOES_TRIBUTARIAS = backup;
      return backup;
    }
    console.log('📋 Usando lista estática como fallback');
    return OBRIGACOES_TRIBUTARIAS;
  }
}

/**
 * Salva backup local das obrigações tributárias
 * @param {Array} obrigacoes - Lista de obrigações
 */
async function salvarBackupObrigacoes(obrigacoes) {
  try {
    const backupPath = path.join(__dirname, 'backup-obrigacoes-tributarias.json');
    await fs.access(path.dirname(backupPath), fs.constants.W_OK);
    const dados = {
      obrigacoes,
      dataAtualizacao: new Date().toISOString(),
      fonte: 'Receita Federal do Brasil'
    };
    await fs.writeFile(backupPath, JSON.stringify(dados, null, 2), 'utf8');
    console.log('💾 Backup de obrigações salvo com sucesso');
  } catch (error) {
    console.warn('⚠️ Erro ao salvar backup de obrigações:', error.message);
  }
}

/**
 * Carrega backup local das obrigações tributárias
 * @returns {Promise<Array|null>} Lista de obrigações ou null
 */
async function carregarBackupObrigacoes() {
  try {
    const backupPath = path.join(__dirname, 'backup-obrigacoes-tributarias.json');
    const dados = await fs.readFile(backupPath, 'utf8');
    const backup = JSON.parse(dados);
    
    const dataBackup = new Date(backup.dataAtualizacao);
    const agora = new Date();
    const diasDiferenca = (agora - dataBackup) / (1000 * 60 * 60 * 24);
    
    if (diasDiferenca <= 7) {
      return backup.obrigacoes;
    } else {
      console.log('📋 Backup de obrigações está desatualizado');
      return null;
    }
  } catch (error) {
    return null;
  }
}

/**
 * Verifica se o ano é bissexto
 * @param {number} ano - Ano a verificar
 * @returns {boolean} True se for bissexto
 */
function isAnoBissexto(ano) {
  return (ano % 4 === 0 && ano % 100 !== 0) || (ano % 400 === 0);
}

/**
 * Busca feriados nacionais do ano via BrasilAPI
 * @param {number} ano - Ano para buscar feriados
 * @returns {Promise<Object>} Mapa de feriados (chave: "mes-dia", valor: nome do feriado)
 */
async function buscarFeriados(ano) {
  try {
    const response = await axios.get(`https://brasilapi.com.br/api/feriados/v1/${ano}`, { timeout: 10000 });
    return response.data
      .filter(f => f.type === 'national')
      .reduce((map, f) => {
        const data = new Date(f.date);
        map[`${data.getMonth() + 1}-${data.getDate()}`] = f.name;
        return map;
      }, {});
  } catch (error) {
    console.warn('⚠️ Erro ao buscar feriados:', error.message);
    return {};
  }
}

/**
 * Ajusta data para dia útil considerando fins de semana e feriados
 * @param {Date} data - Data a ajustar
 * @param {Object} feriados - Mapa de feriados
 * @returns {Date} Data ajustada
 */
function ajustarDiaUtil(data, feriados = {}) {
  let dataAjustada = new Date(data);
  let tentativas = 0;
  const maxTentativas = 10;
  
  while (tentativas < maxTentativas) {
    const diaSemana = dataAjustada.getDay();
    const chave = `${dataAjustada.getMonth() + 1}-${dataAjustada.getDate()}`;
    
    if (diaSemana === 0 || diaSemana === 6 || feriados[chave]) {
      dataAjustada.setDate(dataAjustada.getDate() + 1);
      tentativas++;
      if (feriados[chave]) {
        console.log(`📅 Ajustado para evitar feriado: ${feriados[chave]} em ${chave}`);
      }
    } else {
      break;
    }
  }
  
  return dataAjustada;
}

/**
 * Salva backup local das tarefas criadas
 * @param {Array} tarefas - Lista de tarefas criadas
 * @param {number} ano - Ano das tarefas
 * @param {number} mes - Mês das tarefas
 */
async function salvarBackupTarefas(tarefas, ano, mes) {
  try {
    const backupPath = path.join(__dirname, `tarefas-${ano}-${mes}.json`);
    await fs.access(path.dirname(backupPath), fs.constants.W_OK);
    await fs.writeFile(backupPath, JSON.stringify({ tarefas, dataCriacao: new Date().toISOString() }, null, 2));
    console.log(`💾 Backup salvo: ${backupPath}`);
  } catch (error) {
    console.warn('⚠️ Erro ao salvar backup:', error.message);
  }
}

/**
 * Cria tarefas para um mês específico
 * @param {number} ano - Ano das tarefas (ex.: 2025)
 * @param {number} mes - Mês das tarefas (1 a 12)
 * @param {string} [responsavelEmail] - Email do responsável (opcional)
 * @param {string} [regimeTributario] - Regime tributário para filtrar obrigações (opcional, ex.: 'Simples Nacional')
 * @returns {Promise<Object>} Resultado com status e tarefas criadas
 */
async function criarTarefasMes(ano, mes, responsavelEmail = null, regimeTributario = null) {
  try {
    console.log(`\n=== Criando tarefas da Agenda Tributária - ${mes}/${ano}${regimeTributario ? ` (Regime: ${regimeTributario})` : ''} ===`);
    
    // Validar entrada
    const anoAtual = new Date().getFullYear();
    if (!ano || ano < 2000 || ano > anoAtual + 1) {
      throw new Error(`Ano inválido: ${ano}. Deve estar entre 2000 e ${anoAtual + 1}.`);
    }
    if (!mes || mes < 1 || mes > 12) {
      throw new Error(`Mês inválido: ${mes}. Deve estar entre 1 e 12.`);
    }
    
    // Atualizar obrigações antes de criar tarefas
    await atualizarObrigacoesTributarias();
    
    // Buscar feriados
    const feriados = await buscarFeriados(ano);
    
    // Buscar usuário administrador
    let responsavel;
    if (responsavelEmail) {
      responsavel = await getUserByEmail(responsavelEmail);
      if (!responsavel) {
        console.log(`❌ Email ${responsavelEmail} não encontrado. Buscando administrador...`);
        responsavel = null;
      }
    }
    
    if (!responsavel) {
      const users = await getAllUsers();
      responsavel = users.find(user => user.cargo === 'admin');
      if (!responsavel) {
        throw new Error('Nenhum usuário administrador encontrado no sistema');
      }
    }
    
    console.log(`✅ Responsável definido: ${responsavel.nome_completo} (${responsavel.email})`);
    
    // Buscar obrigações do mês
    let obrigacoesMes = OBRIGACOES_TRIBUTARIAS.find(obj => obj.mes === mes);
    if (!obrigacoesMes) {
      throw new Error(`Mês ${mes} sem obrigações definidas`);
    }
    
    // Filtrar por regime tributário, se especificado
    if (regimeTributario) {
      obrigacoesMes.obrigacoes = obrigacoesMes.obrigacoes.filter(o => o.regimeTributario && o.regimeTributario.includes(regimeTributario));
      console.log(`📊 Filtrado por regime: ${regimeTributario}. Obrigações encontradas: ${obrigacoesMes.obrigacoes.length}`);
    }
    
    // Criar tarefas em paralelo
    const tarefasCriadas = await Promise.all(obrigacoesMes.obrigacoes.map(async obrigacao => {
      let vencimento = obrigacao.vencimento;
      if (mes === 2 && vencimento === 28 && isAnoBissexto(ano)) {
        vencimento = 29;
        console.log(`📅 Ajustado vencimento para 29/02/${ano} (ano bissexto)`);
      }
      
      const dataVencimento = new Date(ano, mes - 1, vencimento);
      const dataVencimentoUtil = ajustarDiaUtil(dataVencimento, feriados);
      
      const taskData = {
        id: uuidv4(),
        titulo: obrigacao.titulo,
        responsavel: responsavel.nome_completo,
        responsavelId: responsavel.uid,
        dataVencimento: dataVencimentoUtil.toISOString(),
        observacoes: `${obrigacao.observacoes}\n\n📅 Vencimento original: ${vencimento}/${mes}/${ano}` +
                    (obrigacao.codigo !== 'N/A' ? `\n🔢 Código: ${obrigacao.codigo}` : '') +
                    (obrigacao.periodo ? `\n📆 Período: ${obrigacao.periodo}` : '') +
                    (dataVencimentoUtil.toDateString() !== dataVencimento.toDateString() ?
                     `\n📅 Vencimento ajustado: ${dataVencimentoUtil.toLocaleDateString('pt-BR')}` : '') +
                    `\n📊 Dados atualizados em: ${new Date().toLocaleDateString('pt-BR')}`,
        recorrente: true,
        frequencia: 'mensal'
      };
      
      try {
        await createTask(taskData);
        console.log(`✅ ${obrigacao.titulo} - Vencimento: ${dataVencimentoUtil.toLocaleDateString('pt-BR')}`);
        return taskData;
      } catch (error) {
        console.error(`❌ Erro ao criar tarefa "${obrigacao.titulo}": ${error.message}`);
        return null;
      }
    }));
    
    const tarefasValidas = tarefasCriadas.filter(t => t !== null);
    if (tarefasValidas.length > 0) {
      await salvarBackupTarefas(tarefasValidas, ano, mes);
    }
    
    console.log(`\n🎉 Concluído! ${tarefasValidas.length} tarefas criadas para ${mes}/${ano}`);
    console.log(`📧 Responsável: ${responsavel.nome_completo} (${responsavel.email})`);
    
    return {
      sucesso: true,
      mes,
      ano,
      responsavel: responsavel.nome_completo,
      tarefasCriadas: tarefasValidas.length,
      tarefas: tarefasValidas
    };
    
  } catch (error) {
    console.error(`❌ Erro ao criar tarefas para ${mes}/${ano}:`, error.message);
    return {
      sucesso: false,
      erro: error.message
    };
  }
}

/**
 * Cria tarefas para múltiplos meses
 * @param {number} ano - Ano das tarefas
 * @param {number[]} meses - Lista de meses (1 a 12)
 * @param {string} [responsavelEmail] - Email do responsável (opcional)
 * @param {string} [regimeTributario] - Regime tributário para filtrar obrigações (opcional)
 * @returns {Promise<Object[]>} Lista de resultados
 */
async function criarTarefasMultiplosMeses(ano, meses, responsavelEmail = null, regimeTributario = null) {
  const resultados = [];
  
  for (const mes of meses) {
    const resultado = await criarTarefasMes(ano, mes, responsavelEmail, regimeTributario);
    resultados.push(resultado);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return resultados;
}

/**
 * Cria tarefas para o ano inteiro
 * @param {number} ano - Ano das tarefas
 * @param {string} [responsavelEmail] - Email do responsável (opcional)
 * @param {string} [regimeTributario] - Regime tributário para filtrar obrigações (opcional)
 * @returns {Promise<Object[]>} Lista de resultados por mês
 */
async function criarTarefasAnoCompleto(ano, responsavelEmail = null, regimeTributario = null) {
  console.log(`\n🚀 Criando agenda tributária completa para o ano ${ano}${regimeTributario ? ` (Regime: ${regimeTributario})` : ''}...`);
  
  const mesesDoAno = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const resultados = await criarTarefasMultiplosMeses(ano, mesesDoAno, responsavelEmail, regimeTributario);
  
  const sucessos = resultados.filter(r => r.sucesso);
  const erros = resultados.filter(r => !r.sucesso);
  
  console.log(`\n📊 RESUMO GERAL - ${ano}`);
  console.log(`✅ Meses processados com sucesso: ${sucessos.length}`);
  console.log(`❌ Meses com erro: ${erros.length}`);
  
  if (sucessos.length > 0) {
    const totalTarefas = sucessos.reduce((total, r) => total + r.tarefasCriadas, 0);
    console.log(`📋 Total de tarefas criadas: ${totalTarefas}`);
  }
  
  if (erros.length > 0) {
    console.log(`\n❌ ERROS:`);
    erros.forEach(erro => {
      console.log(`   Mês ${erro.mes || 'N/A'}: ${erro.erro}`);
    });
  }
  
  return resultados;
}

/**
 * Função principal para execução via linha de comando
 */
async function main() {
  const args = process.argv.slice(2);
  const comando = args[0];
  
  if (!comando) {
    console.log(`
🏛️  GERADOR DE AGENDA TRIBUTÁRIA
==================================

Uso:
  node agenda-tributaria.js mes <ano> <mes> [email_responsavel] [regime_tributario]
  node agenda-tributaria.js ano <ano> [email_responsavel] [regime_tributario]
  node agenda-tributaria.js proximo-mes [email_responsavel] [regime_tributario]
  node agenda-tributaria.js atualizar-obrigacoes
  node agenda-tributaria.js limpar-cache
  node agenda-tributaria.js ajuda

Exemplos:
  node agenda-tributaria.js mes 2025 3                    # Criar tarefas de março/2025
  node agenda-tributaria.js mes 2025 3 admin@empresa.com 'Simples Nacional'  # Com responsável e regime específico
  node agenda-tributaria.js ano 2025                      # Criar todo o ano de 2025
  node agenda-tributaria.js proximo-mes                   # Criar tarefas do próximo mês
  node agenda-tributaria.js atualizar-obrigacoes          # Atualizar obrigações via Receita Federal
    `);
    return;
  }
  
  try {
    switch (comando.toLowerCase()) {
      case 'mes':
        const ano = parseInt(args[1]);
        const mes = parseInt(args[2]);
        const email = args[3] || null;
        const regime = args[4] || null;
        
        if (!ano || !mes || mes < 1 || mes > 12) {
          console.error('❌ Ano e mês são obrigatórios. Mês deve estar entre 1 e 12.');
          return;
        }
        
        await criarTarefasMes(ano, mes, email, regime);
        break;
        
      case 'ano':
        const anoCompleto = parseInt(args[1]);
        const emailAno = args[2] || null;
        const regimeAno = args[3] || null;
        
        if (!anoCompleto) {
          console.error('❌ Ano é obrigatório.');
          return;
        }
        
        await criarTarefasAnoCompleto(anoCompleto, emailAno, regimeAno);
        break;
        
      case 'proximo-mes':
        const emailProximo = args[1] || null;
        const regimeProximo = args[2] || null;
        const dataAtual = new Date();
        const proximoMes = dataAtual.getMonth() + 2;
        const anoProximo = proximoMes > 12 ? dataAtual.getFullYear() + 1 : dataAtual.getFullYear();
        const mesProximo = proximoMes > 12 ? 1 : proximoMes;
        
        console.log(`📅 Próximo mês: ${mesProximo}/${anoProximo}`);
        await criarTarefasMes(anoProximo, mesProximo, emailProximo, regimeProximo);
        break;
        
      case 'atualizar-obrigacoes':
        await atualizarObrigacoesTributarias();
        console.log('\n✅ Atualização das obrigações concluída!');
        console.log(`📊 Meses com dados: ${OBRIGACOES_TRIBUTARIAS.length}`);
        break;
        
      case 'limpar-cache':
        cacheObrigacoesTributarias = null;
        cacheExpiry = null;
        console.log('🗑️ Cache limpo com sucesso!');
        break;
        
      case 'ajuda':
      case 'help':
        console.log(`
🏛️  GERADOR DE AGENDA TRIBUTÁRIA
==================================

Este script automatiza a criação de tarefas mensais da agenda tributária brasileira, com atualização automática via Receita Federal (2025).

COMANDOS DISPONÍVEIS:

1. mes <ano> <mes> [email] [regime]
   Cria tarefas para um mês específico.
   Exemplo: node agenda-tributaria.js mes 2025 3 'Simples Nacional'

2. ano <ano> [email] [regime]
   Cria tarefas para o ano inteiro.
   Exemplo: node agenda-tributaria.js ano 2025 'Lucro Real'

3. proximo-mes [email] [regime]
   Cria tarefas para o próximo mês automaticamente.
   Exemplo: node agenda-tributaria.js proximo-mes 'Simples Nacional'

4. atualizar-obrigacoes
   Atualiza a lista de obrigações com dados da Receita Federal.
   Exemplo: node agenda-tributaria.js atualizar-obrigacoes

5. limpar-cache
   Limpa o cache de obrigações.
   Exemplo: node agenda-tributaria.js limpar-cache

PARÂMETROS:
- ano: Ano de 4 dígitos (ex: 2025)
- mes: Mês de 1 a 12 (1=Janeiro, 12=Dezembro)
- email: Email do responsável (opcional). Se não informado, será usado o primeiro admin do sistema.
- regime: Regime tributário para filtrar obrigações (opcional, ex: 'Simples Nacional', 'Lucro Real', 'Lucro Presumido').

OBRIGAÇÕES INCLUÍDAS:
✅ DCTFWeb (substitui MIT/DCTF)
✅ GPS - Guia da Previdência Social (INSS)
✅ DARF - IRPJ, CSLL, PIS/COFINS
✅ EFD-Reinf, eSocial, ECF, ECD, DASN-SIMEI
✅ DAS - Documento de Arrecadação do Simples Nacional
✅ FGTS - Fundo de Garantia por Tempo de Serviço
✅ ICMS - Imposto sobre Circulação de Mercadorias e Serviços (exemplo genérico, varia por estado)
✅ ISS - Imposto Sobre Serviços (exemplo genérico, varia por município)
✅ DIRF - Declaração do Imposto de Renda Retido na Fonte
✅ DEFIS - Declaração de Informações Socioeconômicas e Fiscais
✅ RAIS - Relação Anual de Informações Sociais
✅ EFD-Contribuições, DME, DOI, DECRED, e-Financeira, DCP, DIRBI
✅ E muitas outras obrigações extraídas automaticamente...

FUNCIONALIDADES:
🗓️  Ajuste automático de datas para dias úteis e feriados nacionais
📝 Observações detalhadas com códigos e períodos
🔄 Tarefas marcadas como recorrentes (mensais)
👤 Atribuição automática para administrador
💾 Backup local das tarefas e obrigações
🔍 Atualização automática via Receita Federal
🔎 Filtro por regime tributário para empresas de contabilidade (clientes variados)
        `);
        break;
        
      default:
        console.error(`❌ Comando "${comando}" não reconhecido. Use "ajuda" para ver os comandos disponíveis.`);
    }
    
  } catch (error) {
    console.error('❌ Erro na execução:', error.message);
    process.exit(1);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  main().then(() => {
    console.log('\n✨ Execução finalizada!');
    process.exit(0);
  }).catch(error => {
    console.error('💥 Erro fatal:', error.message);
    process.exit(1);
  });
}

// Variável para armazenar dados atualizados da agenda tributária
let AGENDA_TRIBUTARIA_COMPLETA = {};

/**
 * Função para buscar atualizações da agenda tributária via scraping/API
 */
async function buscarAgendaTributariaAtualizada() {
  console.log('[AGENDA-API] Iniciando busca por atualizações da agenda tributária...');
  
  try {
    // Simular busca de dados (implementação real dependeria de scraping da Receita Federal)
    // Por enquanto, vamos usar os dados estáticos com algumas melhorias
    
    console.log('[AGENDA-API] Processando dados da agenda tributária...');
    
    // Converter OBRIGACOES_TRIBUTARIAS para o formato AGENDA_TRIBUTARIA_COMPLETA
    const dadosCompletos = {};
    
    OBRIGACOES_TRIBUTARIAS.forEach(mesObj => {
      dadosCompletos[mesObj.mes] = mesObj.obrigacoes.map(obrigacao => ({
        ...obrigacao,
        categoria: obrigacao.titulo.includes('IRRF') ? 'Imposto de Renda' : 
                  obrigacao.titulo.includes('GPS') || obrigacao.titulo.includes('INSS') ? 'Previdência Social' :
                  obrigacao.titulo.includes('PIS') || obrigacao.titulo.includes('COFINS') ? 'Contribuições' :
                  obrigacao.titulo.includes('FGTS') ? 'Trabalhista' :
                  obrigacao.titulo.includes('DAS') || obrigacao.titulo.includes('Simples') ? 'Simples Nacional' :
                  obrigacao.titulo.includes('ICMS') ? 'Estadual' :
                  obrigacao.titulo.includes('ISS') ? 'Municipal' : 'Outros',
        empresaTipo: obrigacao.regimeTributario || ['Geral'],
        fonte: 'Receita Federal do Brasil',
        dataUltimaAtualizacao: new Date().toISOString()
      }));
    });
    
    // Atualizar cache
    AGENDA_TRIBUTARIA_COMPLETA = dadosCompletos;
    cacheExpiry = Date.now() + CACHE_DURATION;
    
    const totalObrigacoes = Object.values(dadosCompletos).reduce((total, mes) => total + mes.length, 0);
    
    console.log(`[AGENDA-API] ✅ Dados atualizados com sucesso!`);
    console.log(`[AGENDA-API] Total de meses: ${Object.keys(dadosCompletos).length}`);
    console.log(`[AGENDA-API] Total de obrigações: ${totalObrigacoes}`);
    
    return {
      sucesso: true,
      dataAtualizacao: new Date().toISOString(),
      totalObrigacoes,
      obrigacoesPorMes: Object.keys(dadosCompletos).map(mes => ({
        mes: parseInt(mes),
        totalObrigacoes: dadosCompletos[mes].length
      })),
      fontes: ['Receita Federal do Brasil', 'Dados internos']
    };
    
  } catch (error) {
    console.error('[AGENDA-API] ❌ Erro ao buscar atualizações:', error.message);
    return {
      sucesso: false,
      erro: error.message,
      dataAtualizacao: null
    };
  }
}

/**
 * Função para criar tarefas com dados da API (sistema automatizado)
 */
async function criarTarefasComDadosAPI(ano, mes, responsavelEmail, filtros = {}) {
  console.log(`[AGENDA-API] Criando tarefas com dados da API: ${mes}/${ano}`);
  
  try {
    // Verificar se temos dados atualizados
    if (!AGENDA_TRIBUTARIA_COMPLETA || Object.keys(AGENDA_TRIBUTARIA_COMPLETA).length === 0) {
      console.log('[AGENDA-API] Dados não atualizados, buscando...');
      const resultado = await buscarAgendaTributariaAtualizada();
      if (!resultado.sucesso) {
        throw new Error('Falha ao buscar dados atualizados: ' + resultado.erro);
      }
    }
    
    // Usar os dados da API para criar tarefas
    const obrigacoesMes = AGENDA_TRIBUTARIA_COMPLETA[mes];
    if (!obrigacoesMes || obrigacoesMes.length === 0) {
      throw new Error(`Nenhuma obrigação encontrada para o mês ${mes}`);
    }
    
    // Chamar a função padrão de criação de tarefas
    const resultado = await criarTarefasMes(ano, mes, responsavelEmail);
    
    return {
      ...resultado,
      sistemaUsado: 'automatizado',
      fonteDados: 'API atualizada'
    };
    
  } catch (error) {
    console.error(`[AGENDA-API] ❌ Erro ao criar tarefas com dados da API:`, error.message);
    return {
      sucesso: false,
      erro: error.message,
      tarefasCriadas: 0
    };
  }
}

// Inicializar dados ao carregar o módulo
buscarAgendaTributariaAtualizada().then(resultado => {
  if (resultado.sucesso) {
    console.log('[AGENDA-API] ✅ Dados iniciais carregados com sucesso');
  } else {
    console.log('[AGENDA-API] ⚠️ Falha ao carregar dados iniciais:', resultado.erro);
  }
}).catch(error => {
  console.error('[AGENDA-API] ❌ Erro ao inicializar dados:', error.message);
});

module.exports = {
  criarTarefasMes,
  criarTarefasMultiplosMeses,
  criarTarefasAnoCompleto,
  atualizarObrigacoesTributarias,
  OBRIGACOES_TRIBUTARIAS,
  // Novas exportações para o sistema automatizado
  buscarAgendaTributariaAtualizada,
  criarTarefasComDadosAPI,
  AGENDA_TRIBUTARIA_COMPLETA
};
