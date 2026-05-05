const Database = require('better-sqlite3');
const db = new Database('reminder.db');

console.log('=== 数据库任务数据 ===');
const tasks = db.prepare('SELECT * FROM tasks ORDER BY id DESC').all();

if (tasks.length === 0) {
  console.log('数据库中没有任务');
} else {
  tasks.forEach((task, index) => {
    console.log(`\n任务 ${index + 1}:`);
    console.log(`  ID: ${task.id}`);
    console.log(`  标题: ${task.title}`);
    console.log(`  提醒时间(原始): ${task.remind_time}`);
    console.log(`  提醒时间(本地): ${new Date(task.remind_time).toLocaleString('zh-CN')}`);
    console.log(`  创建时间: ${task.created_at}`);
    console.log(`  状态: ${task.status}`);
    console.log(`  推送时间: ${task.pushed_at || '未推送'}`);
  });
}