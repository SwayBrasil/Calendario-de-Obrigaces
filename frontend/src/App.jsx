import React, { useContext } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, AuthContext } from './AuthContext';
import Login from './components/Login';
import Cadastro from './components/Cadastro';
import ForgotPassword from './components/ForgotPassword';
import Home from './components/Home';
import Calendario from './components/Calendario'; // Importa o novo Calendario.jsx
import GerenciarUsuarios from './components/GerenciarUsuarios';
import 'bootstrap/dist/css/bootstrap.min.css';

const ProtectedRoute = ({ children }) => {
  const { user } = useContext(AuthContext);
  console.log('ProtectedRoute: Estado do usuário:', user);
  if (!user) {
    console.log('Usuário não autenticado, redirecionando para /');
    return <Navigate to="/" replace />;
  }
  return children;
};

const App = () => {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/cadastro" element={<Cadastro />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/home" element={<ProtectedRoute><Home /></ProtectedRoute>} />
        <Route path="/calendario" element={<ProtectedRoute><Calendario /></ProtectedRoute>} />
        <Route path="/gerenciar-usuarios" element={<ProtectedRoute><GerenciarUsuarios /></ProtectedRoute>} />
      </Routes>
    </AuthProvider>
  );
};

export default App;

