const { getAllTasks } = require('./database');

async function main() {
  try {
    const tasks = await getAllTasks();
    console.log('=== VERIFICAÇÃO DE TAREFAS ===');
    console.log('Total de tarefas no banco:', tasks.length);
    
    if (tasks.length > 0) {
      console.log('\nÚltimas 10 tarefas criadas:');
      const latest = tasks
        .sort((a, b) => new Date(b.data_criacao) - new Date(a.data_criacao))
        .slice(0, 10);
      
      latest.forEach((task, i) => {
        const dataFormatada = new Date(task.data_criacao).toLocaleString('pt-BR');
        console.log(`${i+1}. [${task.id.slice(0,8)}] ${task.titulo} - ${dataFormatada}`);
        console.log(`    Responsável: ${task.responsavel} (${task.responsavel_id})`);
        console.log(`    Vencimento: ${new Date(task.data_vencimento).toLocaleDateString('pt-BR')}`);
        console.log('    ---');
      });
      
      // Contar tarefas por responsável
      console.log('\nTarefas por responsável:');
      const tasksByUser = {};
      tasks.forEach(task => {
        const key = `${task.responsavel} (${task.responsavel_id})`;
        tasksByUser[key] = (tasksByUser[key] || 0) + 1;
      });
      
      Object.entries(tasksByUser).forEach(([user, count]) => {
        console.log(`  ${user}: ${count} tarefas`);
      });
      
      // Contar tarefas da agenda tributária
      const agendaTasks = tasks.filter(task => 
        task.titulo.includes('DCTF') || 
        task.titulo.includes('GPS') || 
        task.titulo.includes('DARF') ||
        task.titulo.includes('DIRF') ||
        task.titulo.includes('Tributária')
      );
      console.log(`\nTarefas da Agenda Tributária: ${agendaTasks.length}`);
      
      if (agendaTasks.length > 0) {
        console.log('Últimas tarefas da agenda tributária:');
        agendaTasks.slice(0, 5).forEach((task, i) => {
          console.log(`  ${i+1}. ${task.titulo} - ${new Date(task.data_criacao).toLocaleDateString('pt-BR')}`);
        });
      }
    } else {
      console.log('Nenhuma tarefa encontrada no banco de dados.');
    }
    
  } catch (error) {
    console.error('Erro ao verificar tarefas:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

main();
