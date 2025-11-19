// frontend/src/components/GerenciarUsuarios.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import axiosInstance from '../utils/axiosConfig';
import { userService } from '../services/api';
import '../styles/GerenciarUsuarios.css';

const GerenciarUsuarios = () => {
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({ nome: '', tipo: 'usuario' });
  const [changingPassword, setChangingPassword] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();

  // Guarda de rota: somente admin
  useEffect(() => {
    if (!user) {
      navigate('/');
      return;
    }
    if (!isAdmin) {
      navigate('/home');
      return;
    }
    carregarUsuarios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAdmin]);

  const carregarUsuarios = async () => {
    try {
      setLoading(true);
      console.log('🔄 Carregando usuários...');
      const resp = await axiosInstance.get('/api/usuarios');
      setUsuarios(resp.data || []);
      setError('');
    } catch (err) {
      console.error('Erro ao carregar usuários:', err);
      setError('Erro ao carregar lista de usuários');
    } finally {
      setLoading(false);
    }
  };

  const iniciarEdicao = (usuario) => {
    setEditingUser(usuario.id);
    setEditForm({ nome: usuario.nome, tipo: usuario.tipo });
  };

  const cancelarEdicao = () => {
    setEditingUser(null);
    setEditForm({ nome: '', tipo: 'usuario' });
  };

  const salvarEdicao = async (usuarioId) => {
    try {
      await axiosInstance.put(`/api/usuarios/${usuarioId}`, editForm);
      await carregarUsuarios();
      cancelarEdicao();
    } catch (err) {
      console.error('Erro ao atualizar usuário:', err);
      setError('Erro ao atualizar usuário');
    }
  };

  const removerUsuario = async (usuarioId, nomeUsuario) => {
    if (!window.confirm(`Tem certeza que deseja remover o usuário "${nomeUsuario}"?`)) return;

    try {
      await axiosInstance.delete(`/api/usuarios/${usuarioId}`);
      await carregarUsuarios();
    } catch (err) {
      console.error('Erro ao remover usuário:', err);
      setError('Erro ao remover usuário');
    }
  };

  const iniciarAlteracaoSenha = (usuario) => {
    setChangingPassword(usuario.id);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
    setSuccessMessage('');
  };

  const cancelarAlteracaoSenha = () => {
    setChangingPassword(null);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
    setSuccessMessage('');
  };

  const salvarNovaSenha = async (usuarioId, nomeUsuario) => {
    setPasswordError('');
    setSuccessMessage('');

    // Validações
    if (!newPassword || newPassword.length < 6) {
      setPasswordError('A senha deve ter pelo menos 6 caracteres');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('As senhas não coincidem');
      return;
    }

    try {
      await userService.alterarSenha(usuarioId, newPassword);
      setSuccessMessage(`Senha do usuário "${nomeUsuario}" alterada com sucesso!`);
      cancelarAlteracaoSenha();
      // Limpar mensagem de sucesso após 3 segundos
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      console.error('Erro ao alterar senha:', err);
      setPasswordError(err.response?.data?.error || 'Erro ao alterar senha');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Carregando usuários...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-md">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold text-gray-900">Gerenciar Usuários</h1>
              <button onClick={() => navigate('/home')} className="btn-voltar-header">
                Voltar ao Início
              </button>
            </div>
          </div>

          <div className="p-6">
            {error && (
              <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
                {error}
              </div>
            )}

            {successMessage && (
              <div className="mb-4 p-4 bg-green-100 border border-green-400 text-green-700 rounded">
                {successMessage}
              </div>
            )}

            <div className="mb-4">
              <div className="flex items-center justify-between">
                <p className="text-gray-600">
                  Total de usuários cadastrados:{' '}
                  <span className="font-semibold">{usuarios.length}</span>
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Nome
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Tipo
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {usuarios.map((usuario) => (
                    <tr key={usuario.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        {editingUser === usuario.id ? (
                          <input
                            type="text"
                            value={editForm.nome}
                            onChange={(e) => setEditForm({ ...editForm, nome: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : (
                          <div className="text-sm font-medium text-gray-900">{usuario.nome}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {editingUser === usuario.id ? (
                          <select
                            value={editForm.tipo}
                            onChange={(e) => setEditForm({ ...editForm, tipo: e.target.value })}
                            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="usuario">Usuário</option>
                            <option value="admin">Administrador</option>
                          </select>
                        ) : (
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              usuario.tipo === 'admin'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-green-100 text-green-800'
                            }`}
                          >
                            {usuario.tipo === 'admin' ? 'Administrador' : 'Usuário'}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        {editingUser === usuario.id ? (
                          <div className="flex space-x-2">
                            <button
                              onClick={() => salvarEdicao(usuario.id)}
                              className="text-green-600 hover:text-green-900"
                            >
                              Salvar
                            </button>
                            <button
                              onClick={cancelarEdicao}
                              className="text-gray-600 hover:text-gray-900"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : changingPassword === usuario.id ? (
                          <div className="space-y-2">
                            <div className="flex flex-col space-y-2">
                              <input
                                type="password"
                                placeholder="Nova senha (mín. 6 caracteres)"
                                value={newPassword}
                                onChange={(e) => {
                                  setNewPassword(e.target.value);
                                  setPasswordError('');
                                }}
                                className="px-3 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                              <input
                                type="password"
                                placeholder="Confirmar senha"
                                value={confirmPassword}
                                onChange={(e) => {
                                  setConfirmPassword(e.target.value);
                                  setPasswordError('');
                                }}
                                className="px-3 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                              {passwordError && (
                                <span className="text-xs text-red-600">{passwordError}</span>
                              )}
                            </div>
                            <div className="flex space-x-2">
                              <button
                                onClick={() => salvarNovaSenha(usuario.id, usuario.nome)}
                                className="text-green-600 hover:text-green-900 text-xs"
                              >
                                Salvar Senha
                              </button>
                              <button
                                onClick={cancelarAlteracaoSenha}
                                className="text-gray-600 hover:text-gray-900 text-xs"
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex space-x-2">
                            <button
                              onClick={() => iniciarEdicao(usuario)}
                              className="text-blue-600 hover:text-blue-900"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => iniciarAlteracaoSenha(usuario)}
                              className="text-purple-600 hover:text-purple-900"
                              title="Alterar senha do usuário"
                            >
                              Alterar Senha
                            </button>
                            {usuario.id !== user?.uid && (
                              <button
                                onClick={() => removerUsuario(usuario.id, usuario.nome)}
                                className="text-red-600 hover:text-red-900"
                              >
                                Remover
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {usuarios.length === 0 && !loading && (
              <div className="text-center py-8">
                <p className="text-gray-500">Nenhum usuário encontrado.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GerenciarUsuarios;
