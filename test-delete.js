#!/usr/bin/env node

/**
 * Script para testar a funcionalidade de exclusão de tarefas
 * Uso: node test-delete.js [URL_DO_SERVIDOR]
 */

const axios = require('axios');

const BASE_URL = process.argv[2] || 'https://pcp-backend.onrender.com';

async function testDeleteTask() {
    try {
        console.log('🧪 Testando funcionalidade de exclusão de tarefas...');
        console.log('🌐 URL do servidor:', BASE_URL);

        // 1. Testar health check
        console.log('\n1️⃣ Testando health check...');
        const healthResponse = await axios.get(`${BASE_URL}/api/health`);
        console.log('✅ Health check OK:', healthResponse.data);

        // 2. Fazer login com usuário admin (assumindo que existe)
        console.log('\n2️⃣ Testando login...');
        const loginData = {
            email: 'admin@teste.com',
            password: 'senha123'
        };

        let token;
        try {
            const loginResponse = await axios.post(`${BASE_URL}/api/login`, loginData);
            token = loginResponse.data.token;
            console.log('✅ Login realizado com sucesso');
            console.log('👤 Usuário:', loginResponse.data.user.email);
            console.log('🔑 Token recebido:', token.substring(0, 20) + '...');
        } catch (error) {
            console.log('⚠️ Erro no login, pode ser que o usuário admin não exista ainda');
            console.log('📝 Você pode criar um usuário admin através do cadastro na interface');
            return;
        }

        // 3. Buscar tarefas existentes
        console.log('\n3️⃣ Buscando tarefas existentes...');
        const tasksResponse = await axios.get(`${BASE_URL}/api/tarefas`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log(`✅ Encontradas ${tasksResponse.data.length} tarefas`);
        
        if (tasksResponse.data.length === 0) {
            console.log('⚠️ Nenhuma tarefa encontrada para testar exclusão');
            console.log('💡 Crie algumas tarefas na interface primeiro');
            return;
        }

        // 4. Criar uma tarefa de teste
        console.log('\n4️⃣ Criando tarefa de teste...');
        const usuariosResponse = await axios.get(`${BASE_URL}/api/usuarios`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        if (usuariosResponse.data.length === 0) {
            console.log('❌ Nenhum usuário encontrado');
            return;
        }

        const primeiroUsuario = usuariosResponse.data[0];
        const novaTarefa = {
            titulo: 'Tarefa de Teste - DELETE',
            responsavelId: primeiroUsuario.id,
            dataVencimento: new Date().toISOString().split('T')[0],
            observacoes: 'Esta é uma tarefa criada para testar a funcionalidade de exclusão'
        };

        const createResponse = await axios.post(`${BASE_URL}/api/tarefas`, novaTarefa, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const tarefaCriada = createResponse.data;
        console.log('✅ Tarefa de teste criada:', tarefaCriada.titulo);
        console.log('🆔 ID da tarefa:', tarefaCriada.id);

        // 5. Tentar excluir a tarefa criada
        console.log('\n5️⃣ Testando exclusão da tarefa...');
        const deleteResponse = await axios.delete(`${BASE_URL}/api/tarefas/${tarefaCriada.id}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('✅ Tarefa excluída com sucesso!');
        console.log('📋 Resposta:', deleteResponse.data);

        // 6. Verificar se a tarefa foi realmente excluída
        console.log('\n6️⃣ Verificando se a tarefa foi excluída...');
        const tasksAfterDelete = await axios.get(`${BASE_URL}/api/tarefas`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        const tarefaEncontrada = tasksAfterDelete.data.find(t => t.id === tarefaCriada.id);
        if (!tarefaEncontrada) {
            console.log('✅ Confirmado: Tarefa foi excluída com sucesso!');
        } else {
            console.log('❌ Erro: Tarefa ainda existe após exclusão');
        }

        console.log('\n🎉 Teste concluído com sucesso!');

    } catch (error) {
        console.error('\n❌ Erro durante o teste:', error.message);
        
        if (error.response) {
            console.error('📊 Status:', error.response.status);
            console.error('💬 Resposta:', error.response.data);
            console.error('🔗 URL:', error.config?.url);
            console.error('🔧 Método:', error.config?.method?.toUpperCase());
        } else if (error.request) {
            console.error('🌐 Erro de conexão com o servidor');
            console.error('🔗 URL tentativa:', `${BASE_URL}`);
        } else {
            console.error('⚙️ Erro interno:', error.message);
        }
        
        console.error('\n🔧 Dicas de debug:');
        console.error('1. Verifique se o servidor está rodando');
        console.error('2. Verifique se existe um usuário admin cadastrado');
        console.error('3. Verifique os logs do servidor no Render');
        console.error('4. Teste manualmente pela interface web');
    }
}

// Executar o teste
testDeleteTask();