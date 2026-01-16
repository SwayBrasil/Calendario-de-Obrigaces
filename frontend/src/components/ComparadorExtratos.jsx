import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import rpaService from '../services/rpaApi';
import '../styles/ComparadorExtratos.css';

function formatDate(dateStr) {
  if (!dateStr) return '';
  // Evita problema de timezone: formata diretamente da string ISO (YYYY-MM-DD)
  if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-');
    if (y && m && d) {
      return `${d}/${m}/${y}`;
    }
  }
  // Fallback para outros formatos
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('pt-BR');
}

function formatTipoDivergencia(tipo) {
  const tipos = {
    NAO_ENCONTRADO_DOMINIO: 'Não encontrado no Otimiza',
    NAO_ENCONTRADO_EXTRATO: 'Não encontrado no extrato bancário',
    VALOR_DIFERENTE: 'Valor diferente',
    SALDO_DIVERGENTE: 'Saldo divergente',
    CLASSIFICACAO_SUSPEITA: 'Classificação suspeita',
    MISSING_IN_TXT: 'Não encontrado no Otimiza',
    MISSING_IN_MPDS: 'Não encontrado no extrato bancário',
  };
  return tipos[tipo] || tipo;
}

const ComparadorExtratos = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [comparacoes, setComparacoes] = useState([]);
  const [loadingLista, setLoadingLista] = useState(false);

  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [otimizaTxtFiles, setOtimizaTxtFiles] = useState([]);
  const [mpdsPdfFile, setMpdsPdfFile] = useState(null);

  const [criando, setCriando] = useState(false);
  const [mensagem, setMensagem] = useState(null);
  const [erro, setErro] = useState(null);

  const [comparacaoSelecionada, setComparacaoSelecionada] = useState(null);
  const [loadingDetalhe, setLoadingDetalhe] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState('');

  async function carregarComparacoes() {
    setLoadingLista(true);
    setErro(null);
    try {
      const lista = await rpaService.listarComparacoes();
      setComparacoes(lista);
    } catch (e) {
      console.error('Erro ao carregar comparações:', e);
      const errorMessage = e?.response?.data?.detail || e?.message || 'Erro ao carregar comparações. Verifique se o backend está rodando.';
      setErro(errorMessage);
      if (comparacoes.length === 0) {
        setComparacoes([]);
      }
    } finally {
      setLoadingLista(false);
    }
  }

  useEffect(() => {
    carregarComparacoes();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setErro(null);
    setMensagem(null);

    if (!dataInicio || !dataFim) {
      setErro('Preencha data de início e fim.');
      return;
    }

    if (otimizaTxtFiles.length === 0) {
      setErro('Selecione pelo menos um arquivo TXT do Otimiza (PAGAR e/ou RECEBER).');
      return;
    }

    if (otimizaTxtFiles.length > 2) {
      setErro('É permitido enviar no máximo 2 arquivos TXT (PAGAR e RECEBER).');
      return;
    }

    if (!mpdsPdfFile) {
      setErro('Selecione o extrato bancário em PDF ou CSV (Nubank/Sicoob).');
      return;
    }
    
    // Valida extensão do arquivo
    const mpdsExt = mpdsPdfFile.name.toLowerCase();
    if (!mpdsExt.endsWith('.pdf') && !mpdsExt.endsWith('.csv')) {
      setErro('O extrato bancário deve ser um arquivo PDF ou CSV.');
      return;
    }

    setCriando(true);
    setMensagem('Enviando arquivos...');

    try {
      const nova = await rpaService.criarComparacao({
        data_inicio: dataInicio,
        data_fim: dataFim,
        otimiza_txt_files: otimizaTxtFiles,
        mpds_pdf: mpdsPdfFile,
      });

      setMensagem(`Processando comparação (ID ${nova.id})... Aguarde.`);
      
      setOtimizaTxtFiles([]);
      setMpdsPdfFile(null);
      
      await carregarComparacoes();

      try {
        const resultado = await rpaService.aguardarComparacao(nova.id, 2000, 180000);
        setMensagem(`Comparação ${nova.id} concluída! ${resultado.qtd_divergencias ?? 0} divergências encontradas.`);
        setComparacaoSelecionada(resultado);
      } catch (pollError) {
        setErro(pollError.message || 'Erro durante processamento');
      }
      
      await carregarComparacoes();
      
    } catch (e) {
      console.error(e);
      const detail = e?.response?.data?.detail || 'Erro ao criar comparação. Veja logs do backend.';
      setErro(detail);
    } finally {
      setCriando(false);
    }
  }

  async function handleSelecionarComparacao(id) {
    setComparacaoSelecionada(null);
    setLoadingDetalhe(true);
    setErro(null);
    try {
      const detalhe = await rpaService.obterComparacao(id);
      setComparacaoSelecionada(detalhe);
      setFiltroTipo('');
    } catch (e) {
      console.error(e);
      setErro('Erro ao carregar detalhes da comparação.');
    } finally {
      setLoadingDetalhe(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm(`Deseja realmente excluir a comparação ${id}?`)) return;
    setErro(null);
    try {
      await rpaService.deletarComparacao(id);
      if (comparacaoSelecionada?.id === id) {
        setComparacaoSelecionada(null);
      }
      await carregarComparacoes();
    } catch (e) {
      console.error(e);
      setErro('Erro ao deletar comparação.');
    }
  }

  const tiposDivergencia = Array.from(
    new Set((comparacaoSelecionada?.divergencias || []).map((d) => d.tipo))
  );

  const divergenciasFiltradas = (comparacaoSelecionada?.divergencias || []).filter((d) =>
    filtroTipo ? d.tipo === filtroTipo : true
  );

  return (
    <div className="comparador-extratos">
      <div className="comparador-header">
        <div>
          <h1>Comparador de Extratos</h1>
          <p>Conferência de Extrato Bancário vs Lançamentos Contábeis</p>
        </div>
        <button 
          className="btn-voltar"
          onClick={() => navigate('/home')}
        >
          ← Voltar
        </button>
      </div>

      <main className="comparador-main">
        <section className="card">
          <h2>Nova conferência</h2>
          <p className="hint">
            Envie o extrato bancário em PDF e o(s) arquivo(s) TXT do Otimiza (PAGAR e/ou RECEBER).
          </p>
          <form className="form" onSubmit={handleSubmit}>
            <div className="form-row">
              <label>
                Período - Data início *
                <input
                  type="date"
                  value={dataInicio}
                  onChange={(e) => setDataInicio(e.target.value)}
                  required
                />
              </label>
              <label>
                Período - Data fim *
                <input
                  type="date"
                  value={dataFim}
                  onChange={(e) => setDataFim(e.target.value)}
                  required
                />
              </label>
            </div>

            <div className="form-row">
              <label className="file-label">
                Extrato bancário (PDF ou CSV) *
                <input
                  type="file"
                  accept=".pdf,application/pdf,.csv,text/csv"
                  onChange={(e) => {
                    const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                    setMpdsPdfFile(file);
                  }}
                  required
                />
                <small className="file-hint">
                  Baixe o extrato do app/banco (Nubank ou Sicoob) em PDF ou CSV e envie aqui
                </small>
              </label>
              {mpdsPdfFile && (
                <span className="file-name">{mpdsPdfFile.name}</span>
              )}
            </div>

            <div className="form-row">
              <label className="file-label">
                TXT do Otimiza (PAGAR e/ou RECEBER) *
                <input
                  type="file"
                  accept=".txt,text/plain"
                  multiple
                  onChange={(e) => {
                    const files = e.target.files ? Array.from(e.target.files) : [];
                    if (files.length > 2) {
                      setErro('É permitido enviar no máximo 2 arquivos (PAGAR e RECEBER).');
                      return;
                    }
                    setOtimizaTxtFiles(files);
                    setErro(null);
                  }}
                  required
                />
                <small className="file-hint">
                  Exporte do Otimiza (PAGAR/RECEBER) e envie aqui. Você pode enviar 1 ou 2 arquivos.
                </small>
              </label>
              {otimizaTxtFiles.length > 0 && (
                <div className="file-names">
                  {otimizaTxtFiles.map((file, idx) => (
                    <span key={idx} className="file-name">
                      {file.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="form-note">
              <p className="note-info">
                ✅ O sistema compara os lançamentos contábeis (TXT Otimiza) com as movimentações bancárias (PDF).
                Você pode enviar 1 ou 2 arquivos TXT (PAGAR e/ou RECEBER).
              </p>
            </div>

            <button
              type="submit"
              className="btn-primary"
              disabled={criando}
            >
              {criando ? 'Processando conferência…' : 'Rodar conferência'}
            </button>
          </form>

          {mensagem && <div className="alert alert-info">{mensagem}</div>}
          {erro && <div className="alert alert-error">{erro}</div>}
        </section>

        <section className="card">
          <div className="card-header">
            <h2>Comparações realizadas</h2>
            <button
              className="btn-secondary"
              onClick={carregarComparacoes}
              disabled={loadingLista}
            >
              {loadingLista ? 'Atualizando…' : 'Recarregar'}
            </button>
          </div>

          {loadingLista && <p className="loading">Carregando comparações…</p>}

          {!loadingLista && comparacoes.length === 0 && (
            <p>Nenhuma comparação registrada ainda.</p>
          )}

          {!loadingLista && comparacoes.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Período</th>
                  <th>Status</th>
                  <th>Lançamentos</th>
                  <th>Divergências</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {comparacoes.map((c) => (
                  <tr
                    key={c.id}
                    className={comparacaoSelecionada?.id === c.id ? 'row-selected' : ''}
                  >
                    <td>{c.id}</td>
                    <td>
                      {formatDate(c.periodo_inicio)} → {formatDate(c.periodo_fim)}
                    </td>
                    <td>
                      <span className={`status-badge status-${c.status}`}>
                        {c.status}
                      </span>
                    </td>
                    <td>
                      {c.qtd_lancamentos_extrato ?? '–'} (Extrato) /{' '}
                      {c.qtd_lancamentos_razao ?? '–'} (Otimiza)
                    </td>
                    <td>{c.qtd_divergencias ?? '–'}</td>
                    <td className="actions">
                      <button
                        onClick={() => handleSelecionarComparacao(c.id)}
                        className="btn-small"
                      >
                        Ver
                      </button>
                      <button
                        onClick={() => handleDelete(c.id)}
                        className="btn-small btn-danger"
                      >
                        Excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <h2>Detalhes da comparação</h2>

          {loadingDetalhe && (
            <p className="loading">Carregando detalhes da comparação…</p>
          )}

          {!loadingDetalhe && !comparacaoSelecionada && (
            <p>Selecione uma comparação na tabela acima para ver as divergências.</p>
          )}

          {!loadingDetalhe && comparacaoSelecionada && (
            <>
              <div className="resumo">
                <p><strong>ID:</strong> {comparacaoSelecionada.id}</p>
                <p>
                  <strong>Período:</strong> {formatDate(comparacaoSelecionada.periodo_inicio)} →{' '}
                  {formatDate(comparacaoSelecionada.periodo_fim)}
                </p>
                <p><strong>Status:</strong> {comparacaoSelecionada.status}</p>
                <p>
                  <strong>Lançamentos:</strong> {comparacaoSelecionada.qtd_lancamentos_extrato ?? '–'}{' '}
                  (Extrato bancário) / {comparacaoSelecionada.qtd_lancamentos_razao ?? '–'} (Otimiza)
                </p>
                <p>
                  <strong>Divergências:</strong> {comparacaoSelecionada.qtd_divergencias ?? '–'}
                </p>
                {comparacaoSelecionada.account_validation_summary && (
                  <div className="validation-summary">
                    <p>
                      <strong>Validação de Contas:</strong>{' '}
                      <span className="status-badge status-ativa">Ativa</span>
                    </p>
                    <ul>
                      <li>✅ OK: {comparacaoSelecionada.account_validation_summary.ok}</li>
                      <li>❌ Inválidas: {comparacaoSelecionada.account_validation_summary.invalid}</li>
                      <li>⚠️ Sem regra: {comparacaoSelecionada.account_validation_summary.unknown}</li>
                    </ul>
                  </div>
                )}
              </div>

              {tiposDivergencia.length > 0 && (
                <div className="filter-row">
                  <label>
                    Filtrar por tipo de divergência:
                    <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
                      <option value="">Todas</option>
                      {tiposDivergencia.map((t) => (
                        <option key={t} value={t}>
                          {formatTipoDivergencia(t)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              {divergenciasFiltradas.length === 0 ? (
                <p>Nenhuma divergência para o filtro atual.</p>
              ) : (
                <table className="table divergencias-table">
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Descrição</th>
                      <th>Extrato bancário</th>
                      <th>Otimiza (TXT)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {divergenciasFiltradas.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <span className="tipo-badge">{formatTipoDivergencia(d.tipo)}</span>
                        </td>
                        <td>{d.descricao}</td>
                        <td>
                          <div className="cell-block">
                            {d.data_extrato && (
                              <div><strong>Data:</strong> {formatDate(d.data_extrato)}</div>
                            )}
                            {d.valor_extrato != null && (
                              <div>
                                <strong>Valor:</strong>{' '}
                                {d.valor_extrato.toLocaleString('pt-BR', {
                                  style: 'currency',
                                  currency: 'BRL',
                                })}
                              </div>
                            )}
                            {d.documento_extrato && (
                              <div><strong>Doc:</strong> {d.documento_extrato}</div>
                            )}
                            {d.descricao_extrato && <div>{d.descricao_extrato}</div>}
                          </div>
                        </td>
                        <td>
                          <div className="cell-block">
                            {d.data_dominio && (
                              <div><strong>Data:</strong> {formatDate(d.data_dominio)}</div>
                            )}
                            {d.valor_dominio != null && (
                              <div>
                                <strong>Valor:</strong>{' '}
                                {d.valor_dominio.toLocaleString('pt-BR', {
                                  style: 'currency',
                                  currency: 'BRL',
                                })}
                              </div>
                            )}
                            {d.documento_dominio && (
                              <div><strong>Doc:</strong> {d.documento_dominio}</div>
                            )}
                            {d.descricao_dominio && <div>{d.descricao_dominio}</div>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Seção de Lançamentos Conferidos */}
              <div style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '2px solid #e0e0e0' }}>
                <h3 style={{ marginBottom: '1rem' }}>
                  ✅ Lançamentos Conferidos ({comparacaoSelecionada?.conferidos?.length || 0})
                </h3>
                {(!comparacaoSelecionada?.conferidos || comparacaoSelecionada.conferidos.length === 0) ? (
                  <p>Nenhum lançamento conferido ainda.</p>
                ) : (
                  <table className="table divergencias-table">
                    <thead>
                      <tr>
                        <th>Extrato bancário</th>
                        <th>Otimiza (TXT)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparacaoSelecionada.conferidos.map((c) => (
                        <tr key={c.id} style={{ backgroundColor: '#f0f9ff' }}>
                          <td>
                            <div className="cell-block">
                              {c.data_extrato && (
                                <div><strong>Data:</strong> {formatDate(c.data_extrato)}</div>
                              )}
                              {c.valor_extrato != null && (
                                <div>
                                  <strong>Valor:</strong>{' '}
                                  {c.valor_extrato.toLocaleString('pt-BR', {
                                    style: 'currency',
                                    currency: 'BRL',
                                  })}
                                </div>
                              )}
                              {c.documento_extrato && (
                                <div><strong>Doc:</strong> {c.documento_extrato}</div>
                              )}
                              {c.descricao_extrato && <div>{c.descricao_extrato}</div>}
                            </div>
                          </td>
                          <td>
                            <div className="cell-block">
                              {c.data_dominio && (
                                <div><strong>Data:</strong> {formatDate(c.data_dominio)}</div>
                              )}
                              {c.valor_dominio != null && (
                                <div>
                                  <strong>Valor:</strong>{' '}
                                  {c.valor_dominio.toLocaleString('pt-BR', {
                                    style: 'currency',
                                    currency: 'BRL',
                                  })}
                                </div>
                              )}
                              {c.documento_dominio && (
                                <div><strong>Doc:</strong> {c.documento_dominio}</div>
                              )}
                              {c.descricao_dominio && <div>{c.descricao_dominio}</div>}
                              {c.conta_contabil_dominio && (
                                <div><strong>Conta:</strong> {c.conta_contabil_dominio}</div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
};

export default ComparadorExtratos;

