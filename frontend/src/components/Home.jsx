// frontend/src/components/Home.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import '../styles/Home.css';

const Home = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const handleLogout = async () => {
    try {
      // Se no futuro você criar um endpoint de logout, pode chamar aqui com seu axiosInstance:
      // await axiosInstance.post('/logout');
    } catch (err) {
      console.warn('[Home] Logout remoto falhou/ignorado:', err?.message);
    } finally {
      logout();        // limpa token e user do storage/contexto
      navigate('/');   // volta pro login
    }
  };

  const isAdmin = user?.cargo === 'admin';
  console.log('[Home] Dados do usuário:', user);
  console.log('[Home] É admin?', isAdmin);

  return (
    <main className="home-wrapper" aria-label="Página inicial do sistema de bate-ponto">
      <div className="home-container">
        <h1 className="home-title">
          Bem-vindo, {user.nomeCompleto || user.email || 'Usuário'}!
          {isAdmin && <span style={{ color: '#007bff', marginLeft: 10 }}>(Administrador)</span>}
        </h1>

        <p className="home-description">
          {isAdmin
            ? 'Como administrador, você tem acesso a todas as funcionalidades do sistema.'
            : 'Utilize o botão abaixo para acessar o calendário.'}
        </p>

        <div className="squares-container">
          <div
            className="square"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && navigate('/calendario')}
          >
            <button
              className="home-button home-button-calendar"
              onClick={() => navigate('/calendario')}
              aria-label="Acessar calendário"
            >
              {isAdmin ? 'Gerenciar Calendário' : 'Acessar Calendário'}
            </button>
          </div>

          {isAdmin && (
            <div
              className="square"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigate('/gerenciar-usuarios')}
            >
              <button
                className="home-button"
                style={{ backgroundColor: '#28a745' }}
                onClick={() => navigate('/gerenciar-usuarios')}
                aria-label="Gerenciar usuários"
              >
                Gerenciar Usuários
              </button>
            </div>
          )}
        </div>

        <button
          className="home-button home-button-logout"
          onClick={handleLogout}
          aria-label="Sair do sistema"
          style={{ marginTop: 20, color: 'black' }}
        >
          Sair
        </button>
      </div>
    </main>
  );
};

export default Home;
